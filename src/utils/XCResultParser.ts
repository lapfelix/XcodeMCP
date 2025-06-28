import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Logger } from './Logger.js';
import type { TestAttachment } from '../types/index.js';

// Data models based on XCResultExplorer
export interface TestResultsSummary {
  devicesAndConfigurations: DeviceConfiguration[];
  environmentDescription: string;
  expectedFailures: number;
  failedTests: number;
  finishTime: SafeDouble;
  passedTests: number;
  result: string;
  skippedTests: number;
  startTime: SafeDouble;
  testFailures: TestFailure[];
  title: string;
  totalTestCount: number;
}

export interface SafeDouble {
  value: number;
}

export interface DeviceConfiguration {
  device: Device;
  expectedFailures: number;
  failedTests: number;
  passedTests: number;
  skippedTests: number;
  testPlanConfiguration: TestPlanConfiguration;
}

export interface Device {
  architecture: string;
  deviceId: string;
  deviceName: string;
  modelName: string;
  osBuildNumber: string;
  osVersion: string;
  platform: string;
}

export interface TestPlanConfiguration {
  configurationId: string;
  configurationName: string;
}

export interface TestFailure {
  failureText: string;
  targetName: string;
  testIdentifier: number;
  testIdentifierString: string;
  testIdentifierURL: string;
  testName: string;
}

export interface TestResults {
  devices: Device[];
  testNodes: TestNode[];
  testPlanConfigurations: TestPlanConfiguration[];
}

export interface TestNode {
  children?: TestNode[];
  duration?: string;
  durationInSeconds?: SafeDouble;
  name: string;
  nodeIdentifier?: string;
  nodeIdentifierURL?: string;
  nodeType: string;
  result: string;
}

export interface XCResultAnalysis {
  summary: TestResultsSummary;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  passRate: number;
  duration: string;
}

export class XCResultParser {
  private xcresultPath: string;

  constructor(xcresultPath: string) {
    this.xcresultPath = xcresultPath;
  }

  /**
   * Check if xcresult file exists and is readable
   */
  public static isXCResultReadable(xcresultPath: string): boolean {
    if (!existsSync(xcresultPath)) {
      return false;
    }
    
    // Check if we can at least access the Info.plist which should be immediately available
    const infoPlistPath = `${xcresultPath}/Info.plist`;
    return existsSync(infoPlistPath);
  }

  /**
   * Wait for xcresult to be fully written and readable
   */
  public static async waitForXCResultReadiness(xcresultPath: string, timeoutMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (this.isXCResultReadable(xcresultPath)) {
        // Additional check: try to run a simple xcresulttool command
        try {
          await XCResultParser.runXCResultTool(['get', 'summary', '--path', xcresultPath, '--format', 'json'], 5000);
          Logger.info(`XCResult is ready: ${xcresultPath}`);
          return true;
        } catch (error) {
          // Not ready yet, continue waiting
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return false;
  }

  /**
   * Get test results summary
   */
  public async getTestResultsSummary(): Promise<TestResultsSummary> {
    const output = await XCResultParser.runXCResultTool([
      'get', 'test-results', 'summary',
      '--path', this.xcresultPath,
      '--format', 'json'
    ]);
    
    const cleanedOutput = this.cleanJSONFloats(output);
    return JSON.parse(cleanedOutput);
  }

  /**
   * Get detailed test results
   */
  public async getTestResults(): Promise<TestResults> {
    const output = await XCResultParser.runXCResultTool([
      'get', 'test-results', 'tests',
      '--path', this.xcresultPath,
      '--format', 'json'
    ]);
    
    const cleanedOutput = this.cleanJSONFloats(output);
    return JSON.parse(cleanedOutput);
  }

  /**
   * Analyze xcresult and provide comprehensive summary
   */
  public async analyzeXCResult(): Promise<XCResultAnalysis> {
    const summary = await this.getTestResultsSummary();
    
    const totalPassRate = summary.totalTestCount > 0 
      ? (summary.passedTests / summary.totalTestCount) * 100 
      : 0;

    const duration = this.formatDuration(summary.finishTime.value - summary.startTime.value);

    return {
      summary,
      totalTests: summary.totalTestCount,
      passedTests: summary.passedTests,
      failedTests: summary.failedTests,
      skippedTests: summary.skippedTests,
      passRate: totalPassRate,
      duration
    };
  }

  /**
   * Extract individual test details from test results
   */
  public async extractTestDetails(): Promise<{
    failed: Array<{ name: string; id: string }>;
    passed: Array<{ name: string; id: string }>;
    skipped: Array<{ name: string; id: string }>;
  }> {
    try {
      const testResults = await this.getTestResults();
      
      const failedTests: { name: string; id: string }[] = [];
      const passedTests: { name: string; id: string }[] = [];
      const skippedTests: { name: string; id: string }[] = [];
      
      const extractTests = (nodes: any[], depth = 0) => {
        for (const node of nodes) {
          // Only include actual test methods (not test classes/suites)
          if (node.nodeType === 'Test Case' && node.name && node.result) {
            const testInfo = {
              name: node.name,
              id: node.nodeIdentifier || 'unknown'
            };
            
            const result = node.result.toLowerCase();
            if (result === 'failed') {
              failedTests.push(testInfo);
            } else if (result === 'passed') {
              passedTests.push(testInfo);
            } else if (result === 'skipped') {
              skippedTests.push(testInfo);
            }
          }
          
          // Recursively process children
          if (node.children) {
            extractTests(node.children, depth + 1);
          }
        }
      };
      
      extractTests(testResults.testNodes || []);
      
      return {
        failed: failedTests,
        passed: passedTests,
        skipped: skippedTests
      };
    } catch (error) {
      Logger.warn(`Failed to extract test details: ${error}`);
      return {
        failed: [],
        passed: [],
        skipped: []
      };
    }
  }

  /**
   * Format test results summary with optional individual test details
   */
  public async formatTestResultsSummary(
    includeIndividualTests: boolean = false,
    maxPassedTests: number = 5
  ): Promise<string> {
    const analysis = await this.analyzeXCResult();
    
    let message = `📊 Test Results Summary:\n`;
    message += `Result: ${analysis.summary.result === 'Failed' ? '❌' : '✅'} ${analysis.summary.result}\n`;
    message += `Total: ${analysis.totalTests} | Passed: ${analysis.passedTests} ✅ | Failed: ${analysis.failedTests} ❌ | Skipped: ${analysis.skippedTests} ⏭️\n`;
    message += `Pass Rate: ${analysis.passRate.toFixed(1)}%\n`;
    message += `Duration: ${analysis.duration}\n`;
    
    if (includeIndividualTests) {
      const testDetails = await this.extractTestDetails();
      
      if (testDetails.failed.length > 0) {
        message += `\n❌ Failed Tests (${testDetails.failed.length}):\n`;
        testDetails.failed.forEach((test, index) => {
          message += `  ${index + 1}. ${test.name} (ID: ${test.id})\n`;
        });
      }
      
      if (testDetails.skipped.length > 0) {
        message += `\n⏭️ Skipped Tests (${testDetails.skipped.length}):\n`;
        testDetails.skipped.forEach((test, index) => {
          message += `  ${index + 1}. ${test.name} (ID: ${test.id})\n`;
        });
      }
      
      // Only show passed tests if there are failures (to keep output manageable)
      if (testDetails.failed.length > 0 && testDetails.passed.length > 0) {
        message += `\n✅ Passed Tests (${testDetails.passed.length}) - showing first ${maxPassedTests}:\n`;
        testDetails.passed.slice(0, maxPassedTests).forEach((test, index) => {
          message += `  ${index + 1}. ${test.name} (ID: ${test.id})\n`;
        });
        if (testDetails.passed.length > maxPassedTests) {
          message += `  ... and ${testDetails.passed.length - maxPassedTests} more passed tests\n`;
        }
      }
    }
    
    return message;
  }

  /**
   * Get console output for a specific test
   */
  public async getConsoleOutput(testId?: string): Promise<string> {
    try {
      const args = ['get', 'log', '--path', this.xcresultPath, '--type', 'console'];
      if (testId) {
        args.push('--test-id', testId);
      }
      
      const output = await XCResultParser.runXCResultTool(args, 30000);
      return output || 'No console output available';
    } catch (error) {
      return `Error retrieving console output: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Get test activities for a specific test
   */
  public async getTestActivities(testId: string): Promise<string> {
    try {
      const output = await XCResultParser.runXCResultTool([
        'get', 'test-results', 'activities',
        '--test-id', testId,
        '--path', this.xcresultPath,
        '--compact'
      ], 30000);
      
      return this.formatTestActivities(output);
    } catch (error) {
      return `Error retrieving test activities: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Get test attachments for a specific test from activities output
   */
  public async getTestAttachments(testId: string): Promise<TestAttachment[]> {
    try {
      Logger.info(`Attempting to get test attachments for test: ${testId}`);
      
      // Give xcresulttool plenty of time to process large files
      const output = await XCResultParser.runXCResultTool([
        'get', 'test-results', 'activities',
        '--test-id', testId,
        '--path', this.xcresultPath,
        '--format', 'json'
      ], 600000); // 10 minutes timeout

      Logger.info(`Successfully retrieved activities data for test: ${testId}`);
      
      const cleanedOutput = this.cleanJSONFloats(output);
      const json = JSON.parse(cleanedOutput);
      const attachments: TestAttachment[] = [];

      // Parse attachments from activities
      this.extractAttachmentsFromActivities(json, attachments);

      Logger.info(`Found ${attachments.length} attachments for test: ${testId}`);
      return attachments;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error(`Failed to get test attachments for ${testId}: ${errorMessage}`);
      
      // If it's a timeout, provide a more specific error
      if (errorMessage.includes('timed out')) {
        throw new Error(`xcresulttool timed out when trying to get attachments for test '${testId}'. This xcresult file may be corrupted, incomplete, or too large. Try with a different test or xcresult file.`);
      }
      
      throw error;
    }
  }

  /**
   * Export an attachment to a temporary directory
   */
  public async exportAttachment(attachmentId: string, filename?: string): Promise<string> {
    // Create temporary directory for attachments
    const tempDir = join(tmpdir(), 'xcode-mcp-attachments');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Generate output path
    const outputFilename = filename || `attachment_${attachmentId}`;
    const outputPath = join(tempDir, outputFilename);

    // Export attachment using xcresulttool
    await XCResultParser.runXCResultTool([
      'export', 'object',
      '--legacy',
      '--path', this.xcresultPath,
      '--id', attachmentId,
      '--type', 'file',
      '--output-path', outputPath
    ], 30000);

    return outputPath;
  }

  /**
   * Find a test node by ID or index
   */
  public async findTestNode(testIdOrIndex: string): Promise<TestNode | null> {
    const tests = await this.getTestResults();
    
    // Try to find by ID first
    const byId = this.searchTestNodeById(tests.testNodes, testIdOrIndex);
    if (byId) return byId;
    
    // Try to find by index
    const index = parseInt(testIdOrIndex);
    if (!isNaN(index)) {
      return this.findTestNodeByIndex(tests.testNodes, index);
    }
    
    return null;
  }

  /**
   * Format test list with indices
   */
  public async formatTestList(): Promise<string> {
    const analysis = await this.analyzeXCResult();
    const tests = await this.getTestResults();
    
    let output = `🔍 XCResult Analysis - ${this.xcresultPath}\n`;
    output += '='.repeat(80) + '\n\n';
    
    output += `📊 Test Summary\n`;
    output += `Result: ${analysis.summary.result === 'Failed' ? '❌' : '✅'} ${analysis.summary.result}\n`;
    output += `Total: ${analysis.totalTests} | Passed: ${analysis.passedTests} ✅ | Failed: ${analysis.failedTests} ❌ | Skipped: ${analysis.skippedTests} ⏭️\n`;
    output += `Pass Rate: ${analysis.passRate.toFixed(1)}%\n`;
    output += `Duration: ${analysis.duration}\n\n`;
    
    output += `📋 All Tests:\n`;
    output += '-'.repeat(80) + '\n';
    
    let testIndex = 1;
    for (const testNode of tests.testNodes) {
      output += this.formatTestHierarchy(testNode, '', testIndex);
      testIndex = this.countTestCases(testNode) + testIndex;
    }
    
    return output;
  }

  /**
   * Format detailed test information
   */
  public async formatTestDetails(testIdOrIndex: string, includeConsole: boolean = false): Promise<string> {
    const analysis = await this.analyzeXCResult();
    const testNode = await this.findTestNode(testIdOrIndex);
    
    if (!testNode) {
      return `❌ Test '${testIdOrIndex}' not found\n\nRun xcresult_browse without parameters to see all available tests`;
    }
    
    let output = `🔍 Test Details\n`;
    output += '='.repeat(80) + '\n';
    output += `Name: ${testNode.name}\n`;
    output += `ID: ${testNode.nodeIdentifier || 'unknown'}\n`;
    output += `Type: ${testNode.nodeType}\n`;
    output += `Result: ${this.getStatusIcon(testNode.result)} ${testNode.result}\n`;
    
    if (testNode.duration) {
      output += `Duration: ${testNode.duration}\n`;
    }
    output += '\n';
    
    // Show failure details if test failed
    if (testNode.result.toLowerCase().includes('fail')) {
      const failure = analysis.summary.testFailures.find(f => f.testIdentifierString === testNode.nodeIdentifier);
      if (failure) {
        output += `❌ Failure Details:\n`;
        output += `Target: ${failure.targetName}\n`;
        output += `Error: ${failure.failureText}\n\n`;
      }
      
      // Show detailed failure info from test node
      if (testNode.children) {
        output += `📍 Detailed Failure Information:\n`;
        for (const child of testNode.children) {
          if (child.nodeType === 'Failure Message') {
            const parts = child.name.split(': ');
            if (parts.length >= 2) {
              output += `Location: ${parts[0]}\n`;
              output += `Message: ${parts.slice(1).join(': ')}\n`;
            } else {
              output += `Details: ${child.name}\n`;
            }
            output += '\n';
          }
        }
      }
    }
    
    if (includeConsole && testNode.nodeIdentifier) {
      output += `📟 Console Output:\n`;
      const consoleOutput = await this.getConsoleOutput(testNode.nodeIdentifier);
      output += consoleOutput + '\n\n';
      
      output += `🔬 Test Activities:\n`;
      const activities = await this.getTestActivities(testNode.nodeIdentifier);
      output += activities + '\n';
    }
    
    return output;
  }

  private static async runXCResultTool(args: string[], timeoutMs: number = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('xcrun', ['xcresulttool', ...args], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      const timeout = setTimeout(() => {
        process.kill();
        reject(new Error(`xcresulttool command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      process.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`xcresulttool failed with code ${code}: ${stderr}`));
        }
      });
      
      process.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private cleanJSONFloats(json: string): string {
    // Replace extremely precise floating point numbers with rounded versions
    const pattern = /(\d+\.\d{10,})/g;
    return json.replace(pattern, (match) => {
      const number = parseFloat(match);
      return number.toFixed(6);
    });
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    } else {
      return `${remainingSeconds}s`;
    }
  }

  private formatTestActivities(jsonString: string): string {
    try {
      const json = JSON.parse(jsonString);
      const activities: string[] = [];
      let testStartTime: number | undefined;
      
      if (json.testRuns && Array.isArray(json.testRuns)) {
        for (const testRun of json.testRuns) {
          if (testRun.activities && Array.isArray(testRun.activities)) {
            // Find start time
            for (const activity of testRun.activities) {
              if (activity.title && activity.title.includes('Start Test at') && activity.startTime) {
                testStartTime = activity.startTime;
                break;
              }
            }
            
            // Format all activities
            for (const activity of testRun.activities) {
              this.formatActivity(activity, testStartTime, '', activities);
            }
          }
        }
      }
      
      return activities.length > 0 ? activities.join('\n') : 'No test activities found';
    } catch (error) {
      return `Error parsing test activities: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private formatActivity(activity: any, baseTime: number | undefined, indent: string, activities: string[]) {
    if (!activity.title) return;
    
    let formattedLine = indent;
    
    // Add timestamp if available
    if (activity.startTime && baseTime) {
      const relativeTime = activity.startTime - baseTime;
      formattedLine += `t = ${relativeTime.toFixed(2).padStart(8)}s `;
    } else {
      formattedLine += '           ';
    }
    
    // Add failure indicator
    if (activity.isAssociatedWithFailure) {
      formattedLine += '❌ ';
    } else {
      formattedLine += '   ';
    }
    
    formattedLine += activity.title;
    activities.push(formattedLine);
    
    // Recursively format child activities
    if (activity.childActivities && Array.isArray(activity.childActivities)) {
      for (const child of activity.childActivities) {
        this.formatActivity(child, baseTime, indent + '  ', activities);
      }
    }
  }

  private formatTestHierarchy(node: TestNode, prefix: string, startIndex: number): string {
    let output = '';
    let currentIndex = startIndex;
    
    const status = this.getStatusIcon(node.result);
    const duration = node.duration ? ` (${node.duration})` : '';
    const testId = node.nodeIdentifier || 'unknown';
    
    if (node.nodeType === 'Test Case') {
      output += `${prefix}[${currentIndex}] ${status} ${node.name}${duration}\n`;
      output += `${prefix}    ID: ${testId}\n`;
      currentIndex++;
    } else if (node.nodeType === 'Test Suite' || node.nodeType === 'Test Target') {
      const counts = this.calculateTestCounts(node);
      const passRate = counts.total > 0 ? (counts.passed / counts.total * 100) : 0;
      const passRateText = counts.total > 0 ? ` - ${passRate.toFixed(1)}% pass rate (${counts.passed}/${counts.total})` : '';
      output += `${prefix}📁 ${node.name}${passRateText}\n`;
    }
    
    if (node.children) {
      const newPrefix = prefix + (node.nodeType === 'Test Case' ? '  ' : '  ');
      for (const child of node.children) {
        output += this.formatTestHierarchy(child, newPrefix, currentIndex);
        if (child.nodeType === 'Test Case') {
          currentIndex++;
        } else {
          currentIndex += this.countTestCases(child);
        }
      }
    }
    
    return output;
  }

  private calculateTestCounts(node: TestNode): { passed: number; failed: number; total: number } {
    let passed = 0;
    let failed = 0;
    let total = 0;
    
    if (node.nodeType === 'Test Case') {
      total = 1;
      if (node.result.toLowerCase().includes('pass') || node.result.toLowerCase().includes('success')) {
        passed = 1;
      } else if (node.result.toLowerCase().includes('fail')) {
        failed = 1;
      }
    } else if (node.children) {
      for (const child of node.children) {
        const childCounts = this.calculateTestCounts(child);
        passed += childCounts.passed;
        failed += childCounts.failed;
        total += childCounts.total;
      }
    }
    
    return { passed, failed, total };
  }

  private countTestCases(node: TestNode): number {
    if (node.nodeType === 'Test Case') {
      return 1;
    }
    
    let count = 0;
    if (node.children) {
      for (const child of node.children) {
        count += this.countTestCases(child);
      }
    }
    
    return count;
  }

  private searchTestNodeById(nodes: TestNode[], id: string): TestNode | null {
    for (const node of nodes) {
      if (node.nodeIdentifier === id) {
        return node;
      }
      if (node.children) {
        const found = this.searchTestNodeById(node.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  private findTestNodeByIndex(nodes: TestNode[], targetIndex: number): TestNode | null {
    let currentIndex = 1;
    
    const search = (nodes: TestNode[]): TestNode | null => {
      for (const node of nodes) {
        if (node.nodeType === 'Test Case') {
          if (currentIndex === targetIndex) {
            return node;
          }
          currentIndex++;
        }
        
        if (node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    
    return search(nodes);
  }

  private getStatusIcon(result: string): string {
    const lowerResult = result.toLowerCase();
    if (lowerResult.includes('pass') || lowerResult.includes('success')) {
      return '✅';
    } else if (lowerResult.includes('fail')) {
      return '❌';
    } else if (lowerResult.includes('skip')) {
      return '⏭️';
    } else {
      return '❓';
    }
  }

  /**
   * Extract attachments from activities JSON recursively
   */
  private extractAttachmentsFromActivities(json: any, attachments: TestAttachment[], parentTimestamp?: number): void {
    if (!json) return;

    // Extract timestamp from current activity if available
    let currentTimestamp = parentTimestamp;
    if (json.timestamp && !isNaN(json.timestamp)) {
      currentTimestamp = json.timestamp;
    }

    // Check if current object has attachments
    if (json.attachments && Array.isArray(json.attachments)) {
      for (const attachment of json.attachments) {
        // Handle various property name variations
        const testAttachment: TestAttachment = {
          payloadId: attachment.payloadId || attachment.payload_uuid || attachment.payloadUUID,
          payload_uuid: attachment.payload_uuid || attachment.payloadId || attachment.payloadUUID,
          payloadUUID: attachment.payloadUUID || attachment.payloadId || attachment.payload_uuid,
          uniform_type_identifier: attachment.uniform_type_identifier || attachment.uniformTypeIdentifier,
          uniformTypeIdentifier: attachment.uniformTypeIdentifier || attachment.uniform_type_identifier,
          filename: attachment.filename || attachment.name,
          name: attachment.name || attachment.filename,
          payloadSize: attachment.payloadSize || attachment.payload_size,
          payload_size: attachment.payload_size || attachment.payloadSize
        };
        
        // Add timestamp if available
        if (currentTimestamp !== undefined) {
          testAttachment.timestamp = currentTimestamp;
        }
        
        attachments.push(testAttachment);
      }
    }

    // Recursively check testRuns
    if (json.testRuns && Array.isArray(json.testRuns)) {
      for (const testRun of json.testRuns) {
        this.extractAttachmentsFromActivities(testRun, attachments, currentTimestamp);
      }
    }

    // Recursively check activities
    if (json.activities && Array.isArray(json.activities)) {
      for (const activity of json.activities) {
        this.extractAttachmentsFromActivities(activity, attachments, currentTimestamp);
      }
    }

    // Recursively check childActivities
    if (json.childActivities && Array.isArray(json.childActivities)) {
      for (const childActivity of json.childActivities) {
        this.extractAttachmentsFromActivities(childActivity, attachments, currentTimestamp);
      }
    }
  }
}