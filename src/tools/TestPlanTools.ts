import { promises as fs } from 'fs';
import { dirname, join, basename } from 'path';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { McpResult } from '../types/index.js';
import Logger from '../utils/Logger.js';

interface TestTarget {
  containerPath: string;
  identifier: string;
  name: string;
}

interface TestTargetConfig {
  target: TestTarget;
  selectedTests?: string[];
  skippedTests?: string[];
}

interface XCTestPlan {
  configurations: Array<{
    id: string;
    name: string;
    options: Record<string, any>;
  }>;
  defaultOptions: {
    testTimeoutsEnabled?: boolean;
    [key: string]: any;
  };
  testTargets: Array<{
    target: {
      containerPath: string;
      identifier: string;
      name: string;
    };
    selectedTests?: string[];
    skippedTests?: string[];
  }>;
  version: number;
}

export class TestPlanTools {
  /**
   * Update an .xctestplan file to run specific tests
   */
  public static async updateTestPlan(
    testPlanPath: string,
    testTargets: TestTargetConfig[]
  ): Promise<McpResult> {
    try {
      Logger.info(`Updating test plan: ${testPlanPath}`);
      
      // Read existing test plan
      let testPlan: XCTestPlan;
      try {
        const content = await fs.readFile(testPlanPath, 'utf8');
        testPlan = JSON.parse(content);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Failed to read test plan file: ${testPlanPath}. Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const splitIdentifier = (
        identifier: string,
        targetName: string | undefined
      ): { classQualified: string; targetQualified: string } => {
        const safeIdentifier = typeof identifier === 'string' ? identifier : '';
        const fallback: { classQualified: string; targetQualified: string } = {
          classQualified: String(safeIdentifier),
          targetQualified: String(safeIdentifier)
        };
        if (!safeIdentifier) return fallback;
        const trimmed = safeIdentifier.trim();
        if (!trimmed) return fallback;

        const parts = trimmed.split('/').filter(Boolean);
        if (parts.length >= 2) {
          const rawMethodName = parts[parts.length - 1] ?? '';
          const methodName = rawMethodName.replace(/\(\)$/,'');
          const className = parts[parts.length - 2] ?? '';
          const classQualified = className && methodName ? `${className}/${methodName}` : trimmed;
          const targetPart = parts.length === 3 ? parts[0] : targetName;
          const targetQualified = targetPart ? `${targetPart}/${classQualified}` : classQualified;
          return {
            classQualified: String(classQualified),
            targetQualified: String(targetQualified)
          };
        }

        if (parts.length === 1) {
          const classQualified = parts[0];
          const targetQualified = targetName ? `${targetName}/${classQualified}` : classQualified;
          return {
            classQualified: String(classQualified),
            targetQualified: String(targetQualified)
          };
        }

        return fallback;
      };

      const normalizedTargets = testTargets.map(config => {
        const targetName = config.target?.name;
        const normalizedSelected = (config.selectedTests || []).map(identifier => 
          splitIdentifier(identifier, targetName)
        );
        const normalizedSkipped = (config.skippedTests || []).map(identifier => 
          splitIdentifier(identifier, targetName)
        );
        return {
          config,
          normalizedSelected,
          normalizedSkipped
        };
      });

      // Update test targets
      testPlan.testTargets = normalizedTargets.map(({ config, normalizedSelected, normalizedSkipped }) => {
        const selectedClassQualified = normalizedSelected
          .map(item => item.classQualified)
          .filter((value): value is string => typeof value === 'string' && value.length > 0);
        const skippedClassQualified = normalizedSkipped
          .map(item => item.classQualified)
          .filter((value): value is string => typeof value === 'string' && value.length > 0);

        const targetConfig: any = {
          target: {
            containerPath: config.target.containerPath,
            identifier: config.target.identifier,
            name: config.target.name
          },
          isEnabled: true
        };

        if (selectedClassQualified.length > 0) {
          targetConfig.selectedTests = selectedClassQualified;
          targetConfig.enabledTests = selectedClassQualified;
          targetConfig.onlyTestIdentifiers = selectedClassQualified;
          targetConfig.testSelectionMode = 'selectTests';
        }

        if (skippedClassQualified.length > 0) {
          targetConfig.skippedTests = skippedClassQualified;
        }

        return targetConfig;
      });

      // If we have explicit selected tests, propagate them to onlyTestIdentifiers
      const combinedEnabledTests = normalizedTargets
        .flatMap(target => target.normalizedSelected.map(item => item.targetQualified))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .filter((value, index, self) => self.indexOf(value) === index);
      const combinedOnlyTestIdentifiers = normalizedTargets
        .flatMap(target => target.normalizedSelected.map(item => item.targetQualified))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .filter((value, index, self) => self.indexOf(value) === index);

      if (!testPlan.defaultOptions) {
        testPlan.defaultOptions = {};
      }

      testPlan.defaultOptions.automaticallyIncludeNewTests = combinedOnlyTestIdentifiers.length === 0;
      if (combinedOnlyTestIdentifiers.length > 0) {
        testPlan.defaultOptions.onlyTestIdentifiers = combinedOnlyTestIdentifiers;
        testPlan.defaultOptions.enabledTests = combinedEnabledTests;
        testPlan.defaultOptions.testSelectionMode = 'selectTests';
      } else {
        delete testPlan.defaultOptions.onlyTestIdentifiers;
        delete testPlan.defaultOptions.enabledTests;
        delete testPlan.defaultOptions.testSelectionMode;
      }

      if (Array.isArray(testPlan.configurations)) {
        testPlan.configurations = testPlan.configurations.map(configuration => {
          const options = configuration.options || {};
          options.automaticallyIncludeNewTests = combinedOnlyTestIdentifiers.length === 0;
          if (combinedOnlyTestIdentifiers.length > 0) {
            options.onlyTestIdentifiers = combinedOnlyTestIdentifiers;
            options.enabledTests = combinedEnabledTests;
            options.testSelectionMode = 'selectTests';
          } else {
            delete options.onlyTestIdentifiers;
            delete options.enabledTests;
            delete options.testSelectionMode;
          }
          return {
            ...configuration,
            options
          };
        });
      }

      // Ensure version is set
      if (!testPlan.version) {
        testPlan.version = 1;
      }

      // Write updated test plan
      try {
        await fs.writeFile(testPlanPath, JSON.stringify(testPlan, null, 2), 'utf8');
        Logger.debug(`Test plan '${testPlanPath}' updated with ${combinedEnabledTests.length} selected test identifiers: ${combinedEnabledTests.join(', ')}`);
        if ((process.env.LOG_LEVEL || '').toUpperCase() === 'DEBUG') {
          const serializedPlan = JSON.stringify(testPlan, null, 2);
          await fs.writeFile(`${testPlanPath}.mcp-debug.json`, serializedPlan, 'utf8');
          await fs.writeFile(`${testPlanPath}.mcp-last.json`, serializedPlan, 'utf8');
          try {
            const snapshotPath = join(dirname(testPlanPath), `${basename(testPlanPath, '.xctestplan')}.mcp-snapshot.json`);
            await fs.writeFile(snapshotPath, serializedPlan, 'utf8');
          } catch (snapshotError) {
            Logger.debug(`Failed to write snapshot debug plan: ${snapshotError}`);
          }
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to write test plan file: ${testPlanPath}. Error: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const selectedTestCount = testTargets.reduce((count, target) => 
        count + (target.selectedTests?.length || 0), 0);
      
      const message = selectedTestCount > 0 
        ? `Test plan updated with ${selectedTestCount} selected tests across ${testTargets.length} target(s)`
        : `Test plan updated to run all tests in ${testTargets.length} target(s)`;

      Logger.info(message);

      return {
        content: [{
          type: 'text',
          text: message
        }]
      };

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`Error updating test plan: ${errorMessage}`);
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update test plan: ${errorMessage}`
      );
    }
  }

  /**
   * Update test plan and automatically trigger lightweight reload
   */
  public static async updateTestPlanAndReload(
    testPlanPath: string,
    projectPath: string,
    testTargets: TestTargetConfig[]
  ): Promise<McpResult> {
    try {
      // First update the test plan
      await this.updateTestPlan(testPlanPath, testTargets);
      
      // Then trigger lightweight reload
      const reloadResult = await this.triggerTestPlanReload(testPlanPath, projectPath);
      
      const selectedTestCount = testTargets.reduce((count, target) => 
        count + (target.selectedTests?.length || 0), 0);
      
      const message = selectedTestCount > 0 
        ? `Test plan updated with ${selectedTestCount} selected tests and reload triggered`
        : `Test plan updated to run all tests in ${testTargets.length} target(s) and reload triggered`;

      return {
        content: [{
          type: 'text',
          text: `${message}\n\n${reloadResult.content?.[0]?.type === 'text' ? reloadResult.content[0].text : 'Reload completed'}`
        }]
      };
      
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`Error updating test plan and reloading: ${errorMessage}`);
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update test plan and reload: ${errorMessage}`
      );
    }
  }

  /**
   * Attempt to trigger Xcode to reload test plan without closing project
   */
  public static async triggerTestPlanReload(
    testPlanPath: string,
    projectPath: string
  ): Promise<McpResult> {
    try {
      Logger.info(`Attempting to trigger test plan reload for: ${testPlanPath}`);
      
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const results: string[] = [];
      
      // Method 1: Touch the test plan file to update its timestamp
      try {
        await execAsync(`touch "${testPlanPath}"`);
        results.push('✓ Updated test plan file timestamp');
        Logger.info('Updated test plan file timestamp');
      } catch (error) {
        results.push(`✗ Failed to touch test plan file: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Method 2: Touch the project directory
      try {
        await execAsync(`touch "${projectPath}"`);
        results.push('✓ Updated project directory timestamp');
        Logger.info('Updated project directory timestamp');
      } catch (error) {
        results.push(`✗ Failed to touch project directory: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Method 3: Brief delay to allow file system events to propagate
      await new Promise(resolve => setTimeout(resolve, 500));
      results.push('✓ Waited for file system events to propagate');
      
      return {
        content: [{
          type: 'text',
          text: `Test plan reload triggered:\n${results.join('\n')}\n\nNote: If Xcode doesn't reload the test plan automatically, close and reopen the project manually in Xcode.`
        }]
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`Error triggering test plan reload: ${errorMessage}`);
      
      return {
        content: [{
          type: 'text',
          text: `Failed to trigger test plan reload: ${errorMessage}\n\nRecommendation: Close and reopen the project manually to ensure test plan changes are loaded.`
        }]
      };
    }
  }

  /**
   * Scan project for all available test classes and methods
   */
  public static async scanAvailableTests(
    projectPath: string,
    testPlanPath?: string
  ): Promise<McpResult> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      Logger.info(`Scanning for available tests in: ${projectPath}`);
      
      let testClasses: string[] = [];
      let testMethods: string[] = [];
      
      try {
        // Use xcodebuild to list tests (this gives us the most accurate info)
        const { stdout } = await execAsync(`xcodebuild test -project "${projectPath}" -scheme TestApp -destination "platform=iOS Simulator,name=iPhone 15" -dry-run 2>/dev/null | grep -E "Test.*:\\s*$" || true`);
        
        const lines = stdout.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.includes('Test Suite')) {
            // Extract test class name
            const match = trimmed.match(/Test Suite '([^']+)'/);
            if (match && match[1] && !match[1].includes('.xctest')) {
              testClasses.push(match[1]);
            }
          } else if (trimmed.includes('Test Case')) {
            // Extract test method name
            const match = trimmed.match(/Test Case '([^']+)'/);
            if (match && match[1]) {
              testMethods.push(match[1]);
            }
          }
        }
      } catch (xcodebuildError) {
        Logger.warn(`xcodebuild scan failed: ${xcodebuildError}, falling back to file scanning`);
        
        // Fallback: scan Swift test files for test methods
        try {
          const { stdout: findResult } = await execAsync(`find "${projectPath}/.." -name "*Test*.swift" -type f 2>/dev/null || true`);
          const testFiles = findResult.split('\n').filter(line => line.trim());
          
          for (const file of testFiles) {
            if (!file.trim()) continue;
            
            try {
              const { stdout: grepResult } = await execAsync(`grep -n "func test\\|class.*Test" "${file}" 2>/dev/null || true`);
              const lines = grepResult.split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                if (line.includes('class') && line.includes('Test')) {
                  const match = line.match(/class\s+(\w+Test\w*)/);
                  if (match && match[1]) {
                    testClasses.push(match[1]);
                  }
                } else if (line.includes('func test')) {
                  const match = line.match(/func\s+(test\w+)/);
                  if (match && match[1]) {
                    testMethods.push(match[1]);
                  }
                }
              }
            } catch (fileError) {
              Logger.warn(`Failed to scan file ${file}: ${fileError}`);
            }
          }
        } catch (findError) {
          Logger.warn(`File scanning failed: ${findError}`);
        }
      }
      
      // Remove duplicates and sort
      testClasses = [...new Set(testClasses)].sort();
      testMethods = [...new Set(testMethods)].sort();
      
      let message = `📋 AVAILABLE TESTS\n\n`;
      
      if (testClasses.length > 0) {
        message += `🏷️ Test Classes (${testClasses.length}):\n`;
        testClasses.forEach(cls => {
          message += `  • ${cls}\n`;
        });
        message += '\n';
      }
      
      if (testMethods.length > 0) {
        message += `🧪 Test Methods (${testMethods.length}):\n`;
        testMethods.forEach(method => {
          message += `  • ${method}\n`;
        });
        message += '\n';
      }
      
      if (testClasses.length === 0 && testMethods.length === 0) {
        message += `⚠️ No test classes or methods found.\n\n`;
        message += `This could mean:\n`;
        message += `  • No test targets in the project\n`;
        message += `  • Tests are not properly configured\n`;
        message += `  • Project build is required first\n`;
      } else {
        message += `💡 Usage Examples:\n`;
        message += `  • Run specific XCTest method: --selected-tests '["TestAppUITests/testExample"]' (no parentheses)\n`;
        message += `  • Run specific Swift Testing test: --selected-tests '["TestAppTests/example"]'\n`;
        message += `  • Run entire test class: --selected-test-classes '["TestAppTests"]' (all tests in class)\n`;
        message += `  • Run multiple classes: --selected-test-classes '["TestAppTests", "TestAppUITests"]'\n`;
        message += `  • Combine both: --selected-tests '["TestAppTests/example"]' --selected-test-classes '["TestAppUITests"]'\n`;
      }
      
      if (testPlanPath) {
        try {
          const { promises: fs } = await import('fs');
          const testPlanContent = await fs.readFile(testPlanPath, 'utf8');
          const testPlan = JSON.parse(testPlanContent);
          
          message += `\n📄 Current Test Plan: ${testPlanPath}\n`;
          if (testPlan.testTargets && testPlan.testTargets.length > 0) {
            message += `  • Configured targets: ${testPlan.testTargets.length}\n`;
            testPlan.testTargets.forEach((target: any, index: number) => {
              message += `  • Target ${index + 1}: ${target.target?.name || 'Unknown'}\n`;
              if (target.selectedTests && target.selectedTests.length > 0) {
                message += `    - Selected tests: ${target.selectedTests.length}\n`;
                target.selectedTests.slice(0, 3).forEach((test: string) => {
                  message += `      • ${test}\n`;
                });
                if (target.selectedTests.length > 3) {
                  message += `      • ... and ${target.selectedTests.length - 3} more\n`;
                }
              } else {
                message += `    - Running all tests in target\n`;
              }
            });
          } else {
            message += `  • No test targets configured\n`;
          }
        } catch (planError) {
          message += `\n⚠️ Could not read test plan: ${planError instanceof Error ? planError.message : String(planError)}\n`;
        }
      }
      
      return {
        content: [{
          type: 'text',
          text: message
        }]
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`Error scanning available tests: ${errorMessage}`);
      
      return {
        content: [{
          type: 'text',
          text: `Failed to scan available tests: ${errorMessage}`
        }]
      };
    }
  }
}
