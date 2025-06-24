import { stat } from 'fs/promises';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { JXAExecutor } from '../utils/JXAExecutor.js';
import { BuildLogParser } from '../utils/BuildLogParser.js';
import { PathValidator } from '../utils/PathValidator.js';
import { ErrorHelper } from '../utils/ErrorHelper.js';
import { ParameterNormalizer } from '../utils/ParameterNormalizer.js';
import { Logger } from '../utils/Logger.js';
import { XCResultParser } from '../utils/XCResultParser.js';
import type { McpResult, OpenProjectCallback } from '../types/index.js';

export class BuildTools {
  public static async build(
    projectPath: string, 
    schemeName: string, 
    destination: string | null = null, 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Normalize the scheme name for better matching
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);
    
    const setSchemeScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const schemes = workspace.schemes();
          const schemeNames = schemes.map(scheme => scheme.name());
          
          // Try exact match first
          let targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(normalizedSchemeName)});
          
          // If not found, try original name
          if (!targetScheme) {
            targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
          }
          
          if (!targetScheme) {
            throw new Error('Scheme not found. Available: ' + JSON.stringify(schemeNames));
          }
          
          workspace.activeScheme = targetScheme;
          return 'Scheme set to ' + targetScheme.name();
        })()
      `;
      
      try {
        await JXAExecutor.execute(setSchemeScript);
      } catch (error) {
        const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('not found')) {
          try {
            // Get available schemes
            const availableSchemes = await this._getAvailableSchemes();
              
            // Try to find a close match with fuzzy matching
            const bestMatch = ParameterNormalizer.findBestMatch(schemeName, availableSchemes);
            let message = `❌ Scheme '${schemeName}' not found\n\nAvailable schemes:\n`;
            
            availableSchemes.forEach(scheme => {
              if (scheme === bestMatch) {
                message += `  • ${scheme} ← Did you mean this?\n`;
              } else {
                message += `  • ${scheme}\n`;
              }
            });
            
            return { content: [{ type: 'text', text: message }] };
          } catch {
            return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Scheme '${schemeName}' not found`, ErrorHelper.getSchemeNotFoundGuidance(schemeName)) }] };
          }
        }
        
        return { content: [{ type: 'text', text: `Failed to set scheme '${schemeName}': ${errorMessage}` }] };
      }

    if (destination) {
      // Normalize the destination name for better matching
      const normalizedDestination = ParameterNormalizer.normalizeDestinationName(destination);
      
      const setDestinationScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const destinations = workspace.runDestinations();
          const destinationNames = destinations.map(dest => dest.name());
          
          // Try exact match first
          let targetDestination = destinations.find(dest => dest.name() === ${JSON.stringify(normalizedDestination)});
          
          // If not found, try original name
          if (!targetDestination) {
            targetDestination = destinations.find(dest => dest.name() === ${JSON.stringify(destination)});
          }
          
          if (!targetDestination) {
            throw new Error('Destination not found. Available: ' + JSON.stringify(destinationNames));
          }
          
          workspace.activeRunDestination = targetDestination;
          return 'Destination set to ' + targetDestination.name();
        })()
      `;
      
      try {
        await JXAExecutor.execute(setDestinationScript);
      } catch (error) {
        const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('not found')) {
          try {
            // Extract available destinations from error message if present
            let availableDestinations: string[] = [];
            if (errorMessage.includes('Available:')) {
              const availablePart = errorMessage.split('Available: ')[1];
              // Find the JSON array part
              const jsonMatch = availablePart?.match(/\[.*?\]/);
              if (jsonMatch) {
                try {
                  availableDestinations = JSON.parse(jsonMatch[0]);
                } catch {
                  availableDestinations = await this._getAvailableDestinations();
                }
              }
            } else {
              availableDestinations = await this._getAvailableDestinations();
            }
              
            // Try to find a close match with fuzzy matching
            const bestMatch = ParameterNormalizer.findBestMatch(destination, availableDestinations);
            let guidance = ErrorHelper.getDestinationNotFoundGuidance(destination, availableDestinations);
            
            if (bestMatch && bestMatch !== destination) {
              guidance += `\n• Did you mean '${bestMatch}'?`;
            }
            
            return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Destination '${destination}' not found`, guidance) }] };
          } catch {
            return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Destination '${destination}' not found`, ErrorHelper.getDestinationNotFoundGuidance(destination)) }] };
          }
        }
        
        return { content: [{ type: 'text', text: `Failed to set destination '${destination}': ${errorMessage}` }] };
      }
    }

    const buildScript = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        workspace.build();
        
        return 'Build started';
      })()
    `;
    
    const buildStartTime = Date.now();
    
    try {
      await JXAExecutor.execute(buildScript);
    } catch (error) {
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Failed to start build: ${errorMessage}` }] };
    }

    Logger.info('Waiting for new build log to appear after build start...');
    
    let attempts = 0;
    let newLog = null;
    const initialWaitAttempts = 1800;

    while (attempts < initialWaitAttempts) {
      const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
      
      if (currentLog) {
        const logTime = currentLog.mtime.getTime();
        const buildTime = buildStartTime;
        Logger.debug(`Checking log: ${currentLog.path}, log time: ${logTime}, build time: ${buildTime}, diff: ${logTime - buildTime}ms`);
        
        if (logTime > buildTime) {
          newLog = currentLog;
          Logger.info(`Found new build log created after build start: ${newLog.path}`);
          break;
        }
      } else {
        Logger.debug(`No build log found yet, attempt ${attempts + 1}/${initialWaitAttempts}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Build started but no new build log appeared within ${initialWaitAttempts} seconds`, ErrorHelper.getBuildLogNotFoundGuidance()) }] };
    }

    Logger.info(`Monitoring build completion for log: ${newLog.path}`);
    
    attempts = 0;
    const maxAttempts = 1200;
    let lastLogSize = 0;
    let stableCount = 0;

    while (attempts < maxAttempts) {
      try {
        const logStats = await stat(newLog.path);
        const currentLogSize = logStats.size;
        
        if (currentLogSize === lastLogSize) {
          stableCount++;
          if (stableCount >= 1) {
            Logger.debug(`Log stable for ${stableCount}s, trying to parse...`);
            const results = await BuildLogParser.parseBuildLog(newLog.path);
            Logger.debug(`Parse result has ${results.errors.length} errors, ${results.warnings.length} warnings`);
            const isParseFailure = results.errors.some(error => 
              typeof error === 'string' && error.includes('XCLogParser failed to parse the build log.')
            );
            if (results && !isParseFailure) {
              Logger.info(`Build completed, log parsed successfully: ${newLog.path}`);
              break;
            }
          }
        } else {
          lastLogSize = currentLogSize;
          stableCount = 0;
        }
      } catch (error) {
        const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
        if (currentLog && currentLog.path !== newLog.path && currentLog.mtime.getTime() > buildStartTime) {
          Logger.debug(`Build log changed to: ${currentLog.path}`);
          newLog = currentLog;
          lastLogSize = 0;
          stableCount = 0;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return { content: [{ type: 'text', text: `Build timed out after ${maxAttempts} seconds` }] };
    }
    
    const results = await BuildLogParser.parseBuildLog(newLog.path);
    
    let message = '';
    const schemeInfo = schemeName ? ` for scheme '${schemeName}'` : '';
    const destInfo = destination ? ` and destination '${destination}'` : '';
    
    Logger.info(`Build completed${schemeInfo}${destInfo} - ${results.errors.length} errors, ${results.warnings.length} warnings`);
    
    if (results.errors.length > 0) {
      message = `❌ BUILD FAILED${schemeInfo}${destInfo} (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
        Logger.error('Build error:', error);
      });
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message = `⚠️ BUILD COMPLETED WITH WARNINGS${schemeInfo}${destInfo} (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
        Logger.warn('Build warning:', warning);
      });
    } else {
      message = `✅ BUILD SUCCESSFUL${schemeInfo}${destInfo}`;
    }

    return { content: [{ type: 'text', text: message }] };
  }

  public static async clean(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const actionResult = workspace.clean();
        
        while (true) {
          if (actionResult.completed()) {
            break;
          }
          delay(0.5);
        }
        
        return \`Clean completed. Result ID: \${actionResult.id()}\`;
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  public static async test(
    projectPath: string, 
    commandLineArguments: string[] = [], 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Get initial xcresult files to detect new ones
    const initialXCResults = await this._findXCResultFiles(projectPath);
    const testStartTime = Date.now();

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const actionResult = workspace.test({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const actionResult = workspace.test();`
        }
        
        // Wait for the test action to complete
        while (true) {
          if (actionResult.completed()) {
            break;
          }
          delay(0.5);
        }
        
        const status = actionResult.status();
        const errorMessage = actionResult.errorMessage();
        
        if (status === 'failed' && errorMessage) {
          return JSON.stringify({ status: 'failed', error: errorMessage });
        }
        
        return JSON.stringify({ status: status || 'completed' });
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      const testResult = JSON.parse(result);
      
      // Find the new xcresult file
      Logger.info('Looking for new xcresult file...');
      const newXCResult = await this._findNewXCResultFile(projectPath, initialXCResults, testStartTime);
      
      if (newXCResult) {
        Logger.info(`Found xcresult: ${newXCResult}`);
        
        // Wait for xcresult to be fully written and readable
        Logger.info('Waiting for xcresult to be readable...');
        const isReady = await XCResultParser.waitForXCResultReadiness(newXCResult, 60000);
        
        if (isReady) {
          try {
            // Analyze the xcresult
            const parser = new XCResultParser(newXCResult);
            const analysis = await parser.analyzeXCResult();
            
            let message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\n`;
            message += `📊 Test Results Summary:\n`;
            message += `XCResult Path: ${newXCResult}\n`;
            message += `Result: ${analysis.summary.result === 'Failed' ? '❌' : '✅'} ${analysis.summary.result}\n`;
            message += `Total: ${analysis.totalTests} | Passed: ${analysis.passedTests} ✅ | Failed: ${analysis.failedTests} ❌ | Skipped: ${analysis.skippedTests} ⏭️\n`;
            message += `Pass Rate: ${analysis.passRate.toFixed(1)}%\n`;
            message += `Duration: ${analysis.duration}\n\n`;
            
            if (analysis.failedTests > 0) {
              message += `❌ Some tests failed. Use 'xcresult_browse "${newXCResult}"' to explore detailed results.\n`;
              message += `For console output: 'xcresult_browser_get_console "${newXCResult}" <test-id>'`;
            } else {
              message += `✅ All tests passed! Use 'xcresult_browse "${newXCResult}"' to explore detailed results.`;
            }
            
            return { content: [{ type: 'text', text: message }] };
          } catch (parseError) {
            Logger.warn(`Failed to parse xcresult: ${parseError}`);
            // Fall back to basic result
            let message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\n`;
            message += `XCResult Path: ${newXCResult}\n`;
            message += `Status: ${testResult.status}\n\n`;
            message += `Note: XCResult parsing failed, but test file is available for manual inspection.\n`;
            message += `Use 'xcresult_browse "${newXCResult}"' to explore results.`;
            
            return { content: [{ type: 'text', text: message }] };
          }
        } else {
          // XCResult not ready in time
          let message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\n`;
          message += `XCResult Path: ${newXCResult}\n`;
          message += `Status: ${testResult.status}\n\n`;
          message += `⚠️ XCResult file found but not ready for parsing within timeout.\n`;
          message += `Use 'xcresult_browse "${newXCResult}"' to explore results once file is ready.`;
          
          return { content: [{ type: 'text', text: message }] };
        }
      } else {
        // No xcresult found - fall back to basic result
        if (testResult.status === 'failed') {
          return { content: [{ type: 'text', text: `❌ TEST FAILED\n\n${testResult.error || 'Test execution failed'}\n\nNote: No XCResult file found for detailed analysis.` }] };
        }
        
        const message = `🧪 TESTS COMPLETED${hasArgs ? ` with arguments ${JSON.stringify(commandLineArguments)}` : ''}\n\nStatus: ${testResult.status}\n\nNote: No XCResult file found for detailed analysis.`;
        return { content: [{ type: 'text', text: message }] };
      }
    } catch (error) {
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Failed to run tests: ${errorMessage}` }] };
    }
  }

  public static async run(
    projectPath: string, 
    schemeName: string,
    commandLineArguments: string[] = [], 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Set the scheme
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);
    
    const setSchemeScript = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const schemeNames = schemes.map(scheme => scheme.name());
        
        // Try exact match first
        let targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(normalizedSchemeName)});
        
        // If not found, try original name
        if (!targetScheme) {
          targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
        }
        
        if (!targetScheme) {
          throw new Error('Scheme not found. Available: ' + JSON.stringify(schemeNames));
        }
        
        workspace.activeScheme = targetScheme;
        return 'Scheme set to ' + targetScheme.name();
      })()
    `;
    
    try {
      await JXAExecutor.execute(setSchemeScript);
    } catch (error) {
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found')) {
        try {
          // Get available schemes
          const availableSchemes = await this._getAvailableSchemes();
            
          // Try to find a close match with fuzzy matching
          const bestMatch = ParameterNormalizer.findBestMatch(schemeName, availableSchemes);
          let message = `❌ Scheme '${schemeName}' not found\n\nAvailable schemes:\n`;
          
          availableSchemes.forEach(scheme => {
            if (scheme === bestMatch) {
              message += `  • ${scheme} ← Did you mean this?\n`;
            } else {
              message += `  • ${scheme}\n`;
            }
          });
          
          return { content: [{ type: 'text', text: message }] };
        } catch {
          return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Scheme '${schemeName}' not found`, ErrorHelper.getSchemeNotFoundGuidance(schemeName)) }] };
        }
      }
      
      return { content: [{ type: 'text', text: `Failed to set scheme '${schemeName}': ${errorMessage}` }] };
    }

    const initialLog = await BuildLogParser.getLatestBuildLog(projectPath);
    const initialTime = Date.now();

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const result = workspace.run({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const result = workspace.run();`
        }
        return \`Run started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const runResult = await JXAExecutor.execute(script);

    let newLog = null;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      newLog = await BuildLogParser.getLatestBuildLog(projectPath);
      
      if (newLog && (!initialLog || newLog.path !== initialLog.path || 
                     newLog.mtime.getTime() > initialTime)) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: `${runResult}\n\nNote: Run triggered but no build log found (app may have launched without building)` }] };
    }

    let lastModified = 0;
    let stableCount = 0;
    attempts = 0;
    const buildMaxAttempts = 600;

    while (attempts < buildMaxAttempts) {
      const currentLog = await BuildLogParser.getLatestBuildLog(projectPath);
      if (currentLog) {
        const currentModified = currentLog.mtime.getTime();
        if (currentModified === lastModified) {
          stableCount++;
          if (stableCount >= 6) {
            break;
          }
        } else {
          lastModified = currentModified;
          stableCount = 0;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    const results = await BuildLogParser.parseBuildLog(newLog.path);
    
    let message = `${runResult}\n\n`;
    Logger.info(`Run build completed - ${results.errors.length} errors, ${results.warnings.length} warnings`);
    
    if (results.errors.length > 0) {
      message += `❌ BUILD FAILED (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
        Logger.error('Run build error:', error);
      });
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message += `⚠️ BUILD COMPLETED WITH WARNINGS (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
        Logger.warn('Run build warning:', warning);
      });
    } else {
      message += '✅ BUILD SUCCESSFUL - App should be launching';
    }

    return { content: [{ type: 'text', text: message }] };
  }

  public static async debug(
    projectPath: string, 
    scheme?: string, 
    skipBuilding = false, 
    openProject?: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    if (openProject) {
      await openProject(projectPath);
    }

    const hasParams = scheme || skipBuilding;
    let paramsObj: { scheme?: string; skipBuilding?: boolean } = {};
    if (scheme) paramsObj.scheme = scheme;
    if (skipBuilding) paramsObj.skipBuilding = skipBuilding;
    
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasParams 
          ? `const result = workspace.debug(${JSON.stringify(paramsObj)});`
          : `const result = workspace.debug();`
        }
        return \`Debug started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  public static async stop(): Promise<McpResult> {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        workspace.stop();
        return 'Stop command sent';
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  private static async _getAvailableSchemes(): Promise<string[]> {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) return JSON.stringify([]);
        
        const schemes = workspace.schemes();
        const schemeNames = schemes.map(scheme => scheme.name());
        return JSON.stringify(schemeNames);
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  private static async _getAvailableDestinations(): Promise<string[]> {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) return [];
        
        const destinations = workspace.runDestinations();
        return destinations.map(dest => dest.name());
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  private static async _findXCResultFiles(projectPath: string): Promise<{ path: string; mtime: number }[]> {
    const xcresultFiles: { path: string; mtime: number }[] = [];
    
    try {
      // Use existing BuildLogParser logic to find the correct DerivedData directory
      const derivedData = await BuildLogParser.findProjectDerivedData(projectPath);
      
      if (derivedData) {
        // Look for xcresult files in the Test logs directory
        const testLogsDir = join(derivedData, 'Logs', 'Test');
        try {
          const files = await readdir(testLogsDir);
          const xcresultDirs = files.filter(file => file.endsWith('.xcresult'));
          
          for (const xcresultDir of xcresultDirs) {
            const fullPath = join(testLogsDir, xcresultDir);
            try {
              const stats = await stat(fullPath);
              xcresultFiles.push({
                path: fullPath,
                mtime: stats.mtime.getTime()
              });
            } catch {
              // Ignore files we can't stat
            }
          }
        } catch (error) {
          Logger.debug(`Could not read test logs directory: ${error}`);
        }
      }
    } catch (error) {
      Logger.warn(`Error finding xcresult files: ${error}`);
    }
    
    return xcresultFiles.sort((a, b) => b.mtime - a.mtime);
  }


  private static async _findNewXCResultFile(
    projectPath: string, 
    initialFiles: { path: string; mtime: number }[], 
    testStartTime: number
  ): Promise<string | null> {
    const maxAttempts = 30; // 30 seconds
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      const currentFiles = await this._findXCResultFiles(projectPath);
      
      // Look for new files created after test start
      for (const file of currentFiles) {
        const wasInitialFile = initialFiles.some(initial => 
          initial.path === file.path && initial.mtime === file.mtime
        );
        
        if (!wasInitialFile && file.mtime >= testStartTime - 5000) { // 5s buffer
          Logger.info(`Found new xcresult file: ${file.path}`);
          return file.path;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    
    // If no new file found, use the most recent one
    const allFiles = await this._findXCResultFiles(projectPath);
    if (allFiles.length > 0) {
      const mostRecent = allFiles[0];
      
      // Check if it's reasonably recent (within last hour)
      if (mostRecent && Date.now() - mostRecent.mtime < 3600000) {
        Logger.warn(`Using most recent xcresult file: ${mostRecent.path}`);
        return mostRecent.path;
      }
    }
    
    return null;
  }
}