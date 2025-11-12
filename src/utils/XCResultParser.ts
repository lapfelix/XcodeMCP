import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import Logger from './Logger.js';
import type { TestAttachment } from '../types/index.js';

// Data models based on XCResultExplorer
export interface TestResultsSummary {
  devicesAndConfigurations: DeviceConfiguration[];
  environmentDescription: string;
  expectedFailures: number;
  failedTests: number;
  finishTime: number;  // Changed from SafeDouble to number
  passedTests: number;
  result: string;
  skippedTests: number;
  startTime: number;   // Changed from SafeDouble to number
  testFailures: TestFailure[];
  title: string;
  totalTestCount: number;
  statistics: any[];   // Added missing field
  topInsights: any[];  // Added missing field
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
  durationInSeconds?: number;
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
   * Wait for xcresult to be fully written and readable with robust checks
   * Uses proportional timeouts based on test duration - longer tests need more patience
   */
  public static async waitForXCResultReadiness(xcresultPath: string, testDurationMs: number = 1200000): Promise<boolean> {
    // Use test duration as the timeout - longer tests likely produce larger XCResults that need more time
    const timeoutMs = Math.max(testDurationMs, 300000); // Minimum 5 minutes, but scale with test duration
    const startTime = Date.now();
    Logger.info(`Starting robust XCResult readiness check for: ${xcresultPath}`);
    Logger.info(`Total timeout: ${timeoutMs/60000} minutes`);
    
    // Phase 1: Wait for staging folder to disappear - this is CRITICAL 
    // We must not try to read the file while Xcode is still writing to it
    // Based on user insight: we contribute to corruption by reading too early
    Logger.info('Phase 1: Waiting for staging folder to disappear (this indicates Xcode is done writing)...');
    const stagingPath = `${xcresultPath}/Staging`;
    // Use 90% of timeout for staging folder wait since this is the most critical phase
    const stagingTimeout = Math.min(timeoutMs * 0.9, 300000); // 90% of total, max 5 minutes for staging
    
    Logger.info(`Will wait up to ${stagingTimeout/60000} minutes for staging folder to disappear`);
    let lastLogTime = Date.now();
    
    while (Date.now() - startTime < stagingTimeout) {
      if (!existsSync(stagingPath)) {
        Logger.info('Staging folder has disappeared - Xcode finished writing XCResult');
        break;
      }
      
      // Log every 30 seconds to show progress
      if (Date.now() - lastLogTime >= 30000) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        Logger.info(`Staging folder still exists after ${elapsed}s - Xcode is still writing XCResult...`);
        lastLogTime = Date.now();
      }
      
      await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds for less CPU usage
    }
    
    if (existsSync(stagingPath)) {
      const elapsed = Math.round((Date.now() - startTime) / 60000);
      Logger.warn(`Staging folder still exists after ${elapsed} minutes - Xcode may still be writing`);
      Logger.warn('This might indicate an Xcode issue or very large test results');
      Logger.warn('Proceeding anyway but file may not be complete');
    } else {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      Logger.info(`Staging folder disappeared after ${elapsed} seconds - ready to proceed`);
    }
    
    // Phase 2: Wait patiently for essential files to appear 
    // Based on user insight: we must not touch xcresulttool until files are completely ready
    Logger.info('Phase 2: Waiting patiently for essential XCResult files to appear...');
    const infoPlistPath = `${xcresultPath}/Info.plist`;
    const databasePath = `${xcresultPath}/database.sqlite3`;
    const dataPath = `${xcresultPath}/Data`;
    
    let lastProgressTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const hasInfoPlist = existsSync(infoPlistPath);
      const hasDatabase = existsSync(databasePath);
      const hasData = existsSync(dataPath);

      // Xcode 16+ no longer writes database.sqlite3 for lightweight xcresult bundles.
      const essentialFilesReady = hasInfoPlist && hasData;
      
      if (essentialFilesReady) {
        if (!hasDatabase) {
          Logger.info('database.sqlite3 not present – continuing (new XCResult format)');
        } else {
          Logger.info('database.sqlite3 detected');
        }
        Logger.info('All essential XCResult files are present - ready for stabilization check');
        
        // Fast-path for small XCResult files - skip extensive waiting for files < 5MB
        const xcresultStats = await stat(xcresultPath);
        const xcresultSizeMB = xcresultStats.size / (1024 * 1024);
        
        if (xcresultSizeMB < 5) {
          Logger.info(`Fast-path: XCResult is small (${xcresultSizeMB.toFixed(1)}MB) - minimal waiting required`);
          // Quick stability check for small files
          await new Promise(resolve => setTimeout(resolve, 2000)); // Just 2 seconds
          return true;
        }
        
        break;
      }
      
      // Log progress every 30 seconds
      if (Date.now() - lastProgressTime >= 30000) {
        Logger.info(`Still waiting for XCResult files - Info.plist: ${hasInfoPlist ? '✓' : '✗'}, Data: ${hasData ? '✓' : '✗'}, database.sqlite3: ${hasDatabase ? '✓' : 'optional'}`);
        lastProgressTime = Date.now();
      }
      
      await new Promise(resolve => setTimeout(resolve, 3000)); // Check every 3 seconds
    }
    
    const hasInfoPlistFinal = existsSync(infoPlistPath);
    const hasDataFinal = existsSync(dataPath);
    const hasDatabaseFinal = existsSync(databasePath);

    if (!hasInfoPlistFinal || !hasDataFinal) {
      const elapsed = Math.round((Date.now() - startTime) / 60000);
      Logger.error(`Essential XCResult files did not appear after ${elapsed} minutes`);
      Logger.error(`This suggests Xcode encountered a serious issue writing the XCResult`);
      return false;
    }

    if (!hasDatabaseFinal) {
      Logger.info('Proceeding without database.sqlite3 (not present in this XCResult bundle)');
    }
    
    // Phase 3: Critical stabilization check - wait until sizes haven't changed for N seconds
    // This implements user insight: "wait until its size hasnt changed for 10 seconds before trying to read it"
    // But scale the wait time based on XCResult size for faster completion on small test results
    
    // Calculate dynamic stability requirement based on XCResult size
    const xcresultStats = await stat(xcresultPath);
    const xcresultSizeMB = xcresultStats.size / (1024 * 1024);
    
    // Scale stability time: 2s for small files (<10MB), up to 12s for large files (>100MB)
    const requiredStabilitySeconds = Math.min(12, Math.max(2, Math.ceil(xcresultSizeMB / 10)));
    
    Logger.info(`Phase 3: Waiting for file sizes to stabilize (${requiredStabilitySeconds}+ seconds unchanged)...`);
    Logger.info(`XCResult size: ${xcresultSizeMB.toFixed(1)}MB - using ${requiredStabilitySeconds}s stability requirement`);
    Logger.info('This is critical - we must not touch xcresulttool until files are completely stable');
    
    let previousSizes: Record<string, number> = {};
    let stableStartTime: number | null = null;
    const includeDatabase = existsSync(databasePath);
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const infoPlistStats = await stat(infoPlistPath);
        const dataStats = await stat(dataPath);
        let databaseSize = 0;
        if (includeDatabase) {
          try {
            const databaseStats = await stat(databasePath);
            databaseSize = databaseStats.size;
          } catch (dbError) {
            Logger.debug(`Error checking database size: ${dbError}`);
            // Treat missing/locked database as instability
            stableStartTime = null;
            previousSizes = {};
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        }
        
        const currentSizes = {
          infoPlist: infoPlistStats.size,
          data: dataStats.size,
          ...(includeDatabase ? { database: databaseSize } : {})
        };
        
        const sizesMatch = (
          previousSizes.infoPlist === currentSizes.infoPlist &&
          previousSizes.data === currentSizes.data &&
          (!includeDatabase || previousSizes.database === currentSizes.database)
        );
        
        if (sizesMatch && Object.keys(previousSizes).length > 0) {
          // Sizes are stable
          if (stableStartTime === null) {
            stableStartTime = Date.now();
            Logger.info(`File sizes stabilized - starting ${requiredStabilitySeconds}s countdown`);
          }
          
          const stableForSeconds = (Date.now() - stableStartTime) / 1000;
          if (stableForSeconds >= requiredStabilitySeconds) {
            Logger.info(`File sizes have been stable for ${Math.round(stableForSeconds)} seconds - ready for xcresulttool`);
            break;
          } else {
            Logger.debug(`File sizes stable for ${Math.round(stableForSeconds)}/${requiredStabilitySeconds} seconds`);
          }
        } else {
          // Sizes changed - reset stability timer
          if (stableStartTime !== null) {
            Logger.info(`File sizes changed - restarting stability check`);
            const databaseLog = includeDatabase ? `, database: ${currentSizes.database}` : '';
            Logger.debug(`New sizes - Info.plist: ${currentSizes.infoPlist}${databaseLog}, Data: ${currentSizes.data}`);
          }
          stableStartTime = null;
        }
        
        previousSizes = currentSizes;
        await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
      } catch (error) {
        Logger.debug(`Error checking file sizes: ${error}`);
        stableStartTime = null; // Reset on error
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    if (stableStartTime === null || (Date.now() - stableStartTime) / 1000 < requiredStabilitySeconds) {
      const elapsed = Math.round((Date.now() - startTime) / 60000);
      Logger.error(`File sizes did not stabilize within ${elapsed} minutes`);
      Logger.error(`This suggests Xcode is still writing to the XCResult file`);
      return false;
    }
    
    // Add safety delay scaled to file size
    const safetyDelayMs = Math.min(5000, Math.max(1000, xcresultSizeMB * 500)); // 1-5s based on size
    Logger.info(`Adding ${safetyDelayMs/1000}s safety delay before touching xcresulttool...`);
    await new Promise(resolve => setTimeout(resolve, safetyDelayMs));
    
    // Phase 4: Attempt to read with retries  
    Logger.info('Phase 4: Attempting to read XCResult with retries...');
    const maxRetries = 14; // Up to 14 retries (total 15 attempts)
    // Scale retry delay: 3s for small files, up to 15s for large files
    const retryDelay = Math.min(15000, Math.max(3000, xcresultSizeMB * 1500));
    
    for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
      try {
        Logger.info(`Reading attempt ${attempt + 1}/${maxRetries + 1}...`);
        const output = await XCResultParser.runXCResultTool(['get', 'test-results', 'summary', '--path', xcresultPath, '--compact'], 20000);
        // Verify we got actual JSON data, not just empty output
        if (output.trim().length < 10) {
          throw new Error('xcresulttool returned insufficient data');
        }
        // Try to parse the JSON to make sure it's valid
        const parsed = JSON.parse(output);
        if (!parsed.totalTestCount && parsed.totalTestCount !== 0) {
          throw new Error('XCResult data is incomplete - missing totalTestCount');
        }
        Logger.info(`XCResult is ready after ${attempt + 1} attempts: ${xcresultPath}`);
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        Logger.warn(`Reading attempt ${attempt + 1} failed: ${errorMessage}`);
        
        if (attempt < maxRetries) {
          const timeRemaining = timeoutMs - (Date.now() - startTime);
          if (timeRemaining < retryDelay + 5000) { // Need 5 extra seconds for the actual command
            Logger.warn('Not enough time remaining for another retry');
            break;
          }
          Logger.info(`Waiting ${retryDelay / 1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    const totalTimeSeconds = (Date.now() - startTime) / 1000;
    Logger.error(`XCResult file failed to become readable after ${maxRetries + 1} attempts over ${totalTimeSeconds} seconds`);
    Logger.error(`This is likely a genuine Xcode bug where the XCResult file remains corrupt after ${Math.round(totalTimeSeconds/60)} minutes of waiting`);
    Logger.error(`XCResult path: ${xcresultPath}`);
    return false;
  }

  /**
   * Get test results summary
   */
  public async getTestResultsSummary(): Promise<TestResultsSummary> {
    Logger.debug(`getTestResultsSummary called for path: ${this.xcresultPath}`);
    Logger.debug(`File exists check: ${existsSync(this.xcresultPath)}`);
    try {
      Logger.debug('About to call runXCResultTool...');
      const output = await XCResultParser.runXCResultTool([
        'get', 'test-results', 'summary',
        '--path', this.xcresultPath,
        '--compact'
      ]);
      
      Logger.debug(`xcresulttool output length: ${output.length} characters`);
      Logger.debug(`xcresulttool output first 200 chars: ${output.substring(0, 200)}`);
      
      const cleanedOutput = this.cleanJSONFloats(output);
      const parsed = JSON.parse(cleanedOutput);
      Logger.debug(`Successfully parsed JSON with keys: ${Object.keys(parsed).join(', ')}`);
      return parsed;
    } catch (error) {
      Logger.error(`Failed to get test results summary from ${this.xcresultPath}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Cannot read XCResult test summary: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get detailed test results
   */
  public async getTestResults(): Promise<TestResults> {
    try {
      const output = await XCResultParser.runXCResultTool([
        'get', 'test-results', 'tests',
        '--path', this.xcresultPath,
        '--compact'
      ]);
      
      const cleanedOutput = this.cleanJSONFloats(output);
      return JSON.parse(cleanedOutput);
    } catch (error) {
      Logger.error(`Failed to get detailed test results from ${this.xcresultPath}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Cannot read XCResult test details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Analyze xcresult and provide comprehensive summary
   */
  public async analyzeXCResult(): Promise<XCResultAnalysis> {
    try {
      const summary = await this.getTestResultsSummary();
      
      const totalPassRate = summary.totalTestCount > 0 
        ? (summary.passedTests / summary.totalTestCount) * 100 
        : 0;

      const duration = this.formatDuration(summary.finishTime - summary.startTime);

      return {
        summary,
        totalTests: summary.totalTestCount,
        passedTests: summary.passedTests,
        failedTests: summary.failedTests,
        skippedTests: summary.skippedTests,
        passRate: totalPassRate,
        duration
      };
    } catch (error) {
      Logger.error(`Failed to analyze XCResult: ${error instanceof Error ? error.message : String(error)}`);
      // Return a safe fallback analysis
      throw new Error(`XCResult analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
          const normalizedResult = this.normalizeResult(node.result);
          if (node.nodeType === 'Test Case' && node.name && normalizedResult) {
            const testInfo = {
              name: node.name,
              id: node.nodeIdentifier || 'unknown'
            };

            const result = normalizedResult.toLowerCase();
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
        const showingText = testDetails.passed.length > maxPassedTests ? ` - showing first ${maxPassedTests}` : '';
        message += `\n✅ Passed Tests (${testDetails.passed.length})${showingText}:\n`;
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
        '--compact'
      ], 600000); // 10 minutes timeout

      Logger.info(`Successfully retrieved activities data for test: ${testId}`);
      
      const cleanedOutput = this.cleanJSONFloats(output);
      const json = JSON.parse(cleanedOutput);
      const attachments: TestAttachment[] = [];

      // Find test start time for relative timestamp conversion
      const testStartTime = this.findTestStartTime(json);
      
      // Parse attachments from activities
      this.extractAttachmentsFromActivities(json, attachments, undefined, testStartTime);

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
    const testResultDisplay = this.normalizeResult(testNode.result) || 'Unknown';
    output += `Result: ${this.getStatusIcon(testNode.result)} ${testResultDisplay}\n`;
    
    if (testNode.duration) {
      output += `Duration: ${testNode.duration}\n`;
    }
    output += '\n';
    
    // Show failure details if test failed
    if (this.normalizeResult(testNode.result).toLowerCase().includes('fail')) {
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
      // Get console output and activities
      const consoleOutput = await this.getConsoleOutput(testNode.nodeIdentifier);
      const activities = await this.getTestActivities(testNode.nodeIdentifier);
      
      let consoleSection = `📟 Console Output:\n${consoleOutput}\n\n🔬 Test Activities:\n${activities}\n`;
      
      // Check if console output is very long and should be saved to a file
      const lineCount = consoleSection.split('\n').length;
      const charCount = consoleSection.length;
      
      // If output is longer than 20 lines or 2KB, save to file
      if (lineCount > 20 || charCount > 2000) {
        const { writeFile } = await import('fs/promises');
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        
        // Create a unique filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safeTestName = testNode.name.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `console_output_${safeTestName}_${timestamp}.txt`;
        const filePath = join(tmpdir(), filename);
        
        await writeFile(filePath, consoleSection, 'utf-8');
        
        const fileSizeKB = Math.round(charCount / 1024);
        
        output += `📟 Console Output:\n`;
        output += `📄 Output saved to file (${lineCount} lines, ${fileSizeKB} KB): ${filePath}\n\n`;
        output += `💡 The console output was too large to display directly. `;
        output += `You can read the file to access the complete console log and test activities.\n`;
      } else {
        output += consoleSection;
      }
    }
    
    return output;
  }

  private static async runXCResultTool(args: string[], timeoutMs: number = 15000): Promise<string> {
    Logger.debug(`Running xcresulttool with args: ${JSON.stringify(['xcresulttool', ...args])}`);
    Logger.debug(`Process environment PATH: ${process.env.PATH?.substring(0, 200)}...`);
    return new Promise((resolve, reject) => {
      let isResolved = false;
      let timeoutHandle: NodeJS.Timeout | null = null;
      
      const childProcess = spawn('xcrun', ['xcresulttool', ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false, // Ensure process is killed with parent
        env: {
          ...process.env,
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode-16.4.0.app/Contents/Developer/usr/bin:' + (process.env.PATH || '')
        }
      });
      
      let stdout = '';
      let stderr = '';
      
      // Helper function to safely resolve/reject only once
      const safeResolve = (value: string) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        resolve(value);
      };
      
      const safeReject = (error: Error) => {
        if (isResolved) return;
        isResolved = true;
        cleanup();
        reject(error);
      };
      
      // Helper function to cleanup resources
      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        
        // Forcefully kill the process if it's still running
        if (!childProcess.killed) {
          try {
            // Try graceful termination first
            childProcess.kill('SIGTERM');
            
            // Force kill after 2 seconds if still running
            setTimeout(() => {
              if (!childProcess.killed) {
                try {
                  childProcess.kill('SIGKILL');
                } catch (killError) {
                  Logger.warn('Failed to force kill xcresulttool process:', killError);
                }
              }
            }, 2000);
          } catch (killError) {
            Logger.warn('Failed to kill xcresulttool process:', killError);
          }
        }
        
        // Remove all listeners to prevent memory leaks
        try {
          childProcess.removeAllListeners();
          if (childProcess.stdout) childProcess.stdout.removeAllListeners();
          if (childProcess.stderr) childProcess.stderr.removeAllListeners();
        } catch (listenerError) {
          Logger.warn('Failed to remove process listeners:', listenerError);
        }
      };
      
      // Set up data collection
      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      // Set up timeout with proper cleanup
      timeoutHandle = setTimeout(() => {
        safeReject(new Error(`xcresulttool command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Handle process completion
      childProcess.on('close', (code, signal) => {
        Logger.debug(`Process closed: code=${code}, signal=${signal}, stdout.length=${stdout.length}, stderr.length=${stderr.length}`);
        if (code === 0) {
          if (stdout.trim() === '') {
            Logger.warn(`xcresulttool succeeded but returned empty output. stderr: ${stderr}`);
            safeReject(new Error(`xcresulttool exited with code 0 but returned no output. stderr: ${stderr}`));
          } else {
            Logger.debug(`Process succeeded with ${stdout.length} chars of output`);
            safeResolve(stdout);
          }
        } else {
          const errorMsg = signal 
            ? `xcresulttool was killed with signal ${signal}: ${stderr}`
            : `xcresulttool failed with code ${code}: ${stderr}`;
          safeReject(new Error(errorMsg));
        }
      });
      
      // Handle process errors
      childProcess.on('error', (error) => {
        safeReject(new Error(`xcresulttool process error: ${error.message}`));
      });
      
      // Note: Removed exit handler as it fires before close handler and prevents proper output processing
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
      const lowerResult = this.normalizeResult(node.result).toLowerCase();
      if (lowerResult.includes('pass') || lowerResult.includes('success')) {
        passed = 1;
      } else if (lowerResult.includes('fail')) {
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

  private normalizeResult(result: string | null | undefined): string {
    if (typeof result === 'string') {
      return result;
    }
    return '';
  }

  private getStatusIcon(result?: string | null): string {
    const lowerResult = this.normalizeResult(result).toLowerCase();
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
  private extractAttachmentsFromActivities(json: any, attachments: TestAttachment[], parentTimestamp?: number, testStartTime?: number): void {
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
        
        // Add timestamp if available - prefer attachment's own timestamp, fallback to current activity timestamp
        if (attachment.timestamp !== undefined && !isNaN(attachment.timestamp)) {
          // Convert absolute timestamp to relative timestamp from test start
          if (testStartTime !== undefined) {
            testAttachment.timestamp = attachment.timestamp - testStartTime;
          } else {
            testAttachment.timestamp = attachment.timestamp;
          }
        } else if (currentTimestamp !== undefined) {
          testAttachment.timestamp = currentTimestamp;
        }
        
        attachments.push(testAttachment);
      }
    }

    // Recursively check testRuns
    if (json.testRuns && Array.isArray(json.testRuns)) {
      for (const testRun of json.testRuns) {
        this.extractAttachmentsFromActivities(testRun, attachments, currentTimestamp, testStartTime);
      }
    }

    // Recursively check activities
    if (json.activities && Array.isArray(json.activities)) {
      for (const activity of json.activities) {
        this.extractAttachmentsFromActivities(activity, attachments, currentTimestamp, testStartTime);
      }
    }

    // Recursively check childActivities
    if (json.childActivities && Array.isArray(json.childActivities)) {
      for (const childActivity of json.childActivities) {
        this.extractAttachmentsFromActivities(childActivity, attachments, currentTimestamp, testStartTime);
      }
    }
  }

  /**
   * Find the test start time from the activities JSON to enable relative timestamp calculation
   */
  private findTestStartTime(json: any): number | undefined {
    // Look for the earliest startTime in the test activities
    let earliestStartTime: number | undefined;

    const findEarliestTime = (obj: any): void => {
      if (!obj) return;
      
      // Check current object for startTime
      if (obj.startTime !== undefined && !isNaN(obj.startTime)) {
        if (earliestStartTime === undefined || obj.startTime < earliestStartTime) {
          earliestStartTime = obj.startTime;
        }
      }
      
      // Recursively check nested structures
      if (obj.testRuns && Array.isArray(obj.testRuns)) {
        obj.testRuns.forEach(findEarliestTime);
      }
      if (obj.activities && Array.isArray(obj.activities)) {
        obj.activities.forEach(findEarliestTime);
      }
      if (obj.childActivities && Array.isArray(obj.childActivities)) {
        obj.childActivities.forEach(findEarliestTime);
      }
    };

    findEarliestTime(json);
    return earliestStartTime;
  }
}
