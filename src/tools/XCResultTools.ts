import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { XCResultParser } from '../utils/XCResultParser.js';
import { Logger } from '../utils/Logger.js';
import type { McpResult, TestAttachment } from '../types/index.js';

export class XCResultTools {
  /**
   * Browse xcresult file - list tests or show specific test details
   */
  public static async xcresultBrowse(
    xcresultPath: string,
    testId?: string,
    includeConsole: boolean = false
  ): Promise<McpResult> {
    // Validate xcresult path
    if (!existsSync(xcresultPath)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `XCResult file not found: ${xcresultPath}`
      );
    }

    if (!xcresultPath.endsWith('.xcresult')) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Path must be an .xcresult file: ${xcresultPath}`
      );
    }

    // Check if xcresult is readable
    if (!XCResultParser.isXCResultReadable(xcresultPath)) {
      throw new McpError(
        ErrorCode.InternalError,
        `XCResult file is not readable or incomplete: ${xcresultPath}`
      );
    }

    try {
      const parser = new XCResultParser(xcresultPath);

      if (testId) {
        // Show specific test details
        const details = await parser.formatTestDetails(testId, includeConsole);
        return { content: [{ type: 'text', text: details }] };
      } else {
        // List all tests
        const testList = await parser.formatTestList();
        
        let usage = '\n\n💡 Usage:\n';
        usage += '  View test details: xcresult_browse <path> <test-id-or-index>\n';
        usage += '  View with console: xcresult_browse <path> <test-id-or-index> true\n';
        usage += '  Get console only: xcresult_browser_get_console <path> <test-id-or-index>\n';
        usage += '  Examples:\n';
        usage += `    xcresult_browse "${xcresultPath}" 5\n`;
        usage += `    xcresult_browse "${xcresultPath}" "SomeTest/testMethod()" true\n`;
        
        return { content: [{ type: 'text', text: testList + usage }] };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('xcresulttool')) {
        throw new McpError(
          ErrorCode.InternalError,
          `XCResult parsing failed. Make sure Xcode Command Line Tools are installed: ${errorMessage}`
        );
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze XCResult: ${errorMessage}`
      );
    }
  }

  /**
   * Get console output for a specific test
   */
  public static async xcresultBrowserGetConsole(
    xcresultPath: string,
    testId: string
  ): Promise<McpResult> {
    // Validate xcresult path
    if (!existsSync(xcresultPath)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `XCResult file not found: ${xcresultPath}`
      );
    }

    if (!xcresultPath.endsWith('.xcresult')) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Path must be an .xcresult file: ${xcresultPath}`
      );
    }

    // Check if xcresult is readable
    if (!XCResultParser.isXCResultReadable(xcresultPath)) {
      throw new McpError(
        ErrorCode.InternalError,
        `XCResult file is not readable or incomplete: ${xcresultPath}`
      );
    }

    if (!testId || testId.trim() === '') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Test ID or index is required'
      );
    }

    try {
      const parser = new XCResultParser(xcresultPath);
      
      // First find the test node to get the actual test identifier
      const testNode = await parser.findTestNode(testId);
      if (!testNode) {
        return { 
          content: [{ 
            type: 'text', 
            text: `❌ Test '${testId}' not found\n\nRun xcresult_browse "${xcresultPath}" to see all available tests` 
          }] 
        };
      }

      let output = `📟 Console Output for: ${testNode.name}\n`;
      output += '='.repeat(80) + '\n\n';

      // Get console output
      const consoleOutput = await parser.getConsoleOutput(testNode.nodeIdentifier);
      output += `Console Log:\n${consoleOutput}\n\n`;

      // Get test activities
      if (testNode.nodeIdentifier) {
        output += `🔬 Test Activities:\n`;
        const activities = await parser.getTestActivities(testNode.nodeIdentifier);
        output += activities;
      }

      return { content: [{ type: 'text', text: output }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('xcresulttool')) {
        throw new McpError(
          ErrorCode.InternalError,
          `XCResult parsing failed. Make sure Xcode Command Line Tools are installed: ${errorMessage}`
        );
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get console output: ${errorMessage}`
      );
    }
  }

  /**
   * Get a quick summary of an xcresult file
   */
  public static async xcresultSummary(xcresultPath: string): Promise<McpResult> {
    // Validate xcresult path
    if (!existsSync(xcresultPath)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `XCResult file not found: ${xcresultPath}`
      );
    }

    if (!xcresultPath.endsWith('.xcresult')) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Path must be an .xcresult file: ${xcresultPath}`
      );
    }

    // Check if xcresult is readable
    if (!XCResultParser.isXCResultReadable(xcresultPath)) {
      throw new McpError(
        ErrorCode.InternalError,
        `XCResult file is not readable or incomplete: ${xcresultPath}`
      );
    }

    try {
      const parser = new XCResultParser(xcresultPath);
      const analysis = await parser.analyzeXCResult();

      let output = `📊 XCResult Summary - ${xcresultPath}\n`;
      output += '='.repeat(80) + '\n\n';
      output += `Result: ${analysis.summary.result === 'Failed' ? '❌' : '✅'} ${analysis.summary.result}\n`;
      output += `Total: ${analysis.totalTests} | Passed: ${analysis.passedTests} ✅ | Failed: ${analysis.failedTests} ❌ | Skipped: ${analysis.skippedTests} ⏭️\n`;
      output += `Pass Rate: ${analysis.passRate.toFixed(1)}%\n`;
      output += `Duration: ${analysis.duration}\n\n`;

      if (analysis.failedTests > 0) {
        output += `❌ Failed Tests:\n`;
        for (const failure of analysis.summary.testFailures.slice(0, 5)) {
          output += `  • ${failure.testName}: ${failure.failureText.substring(0, 100)}${failure.failureText.length > 100 ? '...' : ''}\n`;
        }
        if (analysis.summary.testFailures.length > 5) {
          output += `  ... and ${analysis.summary.testFailures.length - 5} more\n`;
        }
        output += '\n';
      }

      output += `💡 Use 'xcresult_browse "${xcresultPath}"' to explore detailed results.`;

      return { content: [{ type: 'text', text: output }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('xcresulttool')) {
        throw new McpError(
          ErrorCode.InternalError,
          `XCResult parsing failed. Make sure Xcode Command Line Tools are installed: ${errorMessage}`
        );
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to analyze XCResult: ${errorMessage}`
      );
    }
  }

  /**
   * Get screenshot from failed test - returns direct screenshot or extracts from video
   */
  public static async xcresultGetScreenshot(
    xcresultPath: string,
    testId: string,
    timestamp: number
  ): Promise<McpResult> {
    // Validate xcresult path
    if (!existsSync(xcresultPath)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `XCResult file not found: ${xcresultPath}`
      );
    }

    if (!xcresultPath.endsWith('.xcresult')) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Path must be an .xcresult file: ${xcresultPath}`
      );
    }

    // Check if xcresult is readable
    if (!XCResultParser.isXCResultReadable(xcresultPath)) {
      throw new McpError(
        ErrorCode.InternalError,
        `XCResult file is not readable or incomplete: ${xcresultPath}`
      );
    }

    if (!testId || testId.trim() === '') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Test ID or index is required'
      );
    }

    try {
      const parser = new XCResultParser(xcresultPath);
      
      // First find the test node to get the actual test identifier
      const testNode = await parser.findTestNode(testId);
      if (!testNode) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Test '${testId}' not found. Run xcresult_browse "${xcresultPath}" to see all available tests`
        );
      }

      if (!testNode.nodeIdentifier) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Test '${testId}' does not have a valid identifier for attachment retrieval`
        );
      }

      // Get test attachments
      const attachments = await parser.getTestAttachments(testNode.nodeIdentifier);
      
      if (attachments.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `No attachments found for test '${testNode.name}'. This test may not have failed or may not have generated screenshots/videos.`
        );
      }

      Logger.info(`Found ${attachments.length} attachments for test ${testNode.name}`);

      // Look for video attachment first (gives us actual PNG images)
      const videoAttachment = this.findVideoAttachment(attachments);
      if (videoAttachment) {
        const screenshotPath = await this.extractScreenshotFromVideo(parser, videoAttachment, testNode.name, timestamp);
        return { 
          content: [{ 
            type: 'text', 
            text: `Screenshot extracted from video for test '${testNode.name}' at ${timestamp}s: ${screenshotPath}` 
          }] 
        };
      }

      // Look for direct PNG screenshot attachment as fallback
      const pngAttachment = this.findPNGAttachment(attachments);
      if (pngAttachment) {
        const screenshotPath = await this.exportScreenshotAttachment(parser, pngAttachment);
        return { 
          content: [{ 
            type: 'text', 
            text: `Screenshot exported for test '${testNode.name}': ${screenshotPath}` 
          }] 
        };
      }

      // No suitable attachments found
      const attachmentTypes = attachments.map(a => a.uniform_type_identifier || a.uniformTypeIdentifier || 'unknown').join(', ');
      throw new McpError(
        ErrorCode.InvalidParams,
        `No screenshot or video attachments found for test '${testNode.name}'. Available attachment types: ${attachmentTypes}`
      );

    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('xcresulttool')) {
        throw new McpError(
          ErrorCode.InternalError,
          `XCResult parsing failed. Make sure Xcode Command Line Tools are installed: ${errorMessage}`
        );
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get screenshot: ${errorMessage}`
      );
    }
  }

  /**
   * Find PNG screenshot attachment (actual image files only)
   */
  private static findPNGAttachment(attachments: TestAttachment[]): TestAttachment | undefined {
    return attachments.find(attachment => {
      const typeId = attachment.uniform_type_identifier || attachment.uniformTypeIdentifier || '';
      const filename = attachment.filename || attachment.name || '';
      
      // Check for PNG type identifier or .png extension (actual image files)
      return typeId.includes('png') || 
             typeId === 'public.png' || 
             filename.toLowerCase().endsWith('.png');
    });
  }

  /**
   * Find video attachment by type identifier and filename extension
   */
  private static findVideoAttachment(attachments: TestAttachment[]): TestAttachment | undefined {
    return attachments.find(attachment => {
      const typeId = attachment.uniform_type_identifier || attachment.uniformTypeIdentifier || '';
      const filename = attachment.filename || attachment.name || '';
      
      // Check for video type identifiers or video extensions
      return typeId.includes('mp4') || 
             typeId.includes('quicktime') || 
             typeId === 'public.mpeg-4' ||
             typeId === 'com.apple.quicktime-movie' ||
             filename.toLowerCase().endsWith('.mp4') ||
             filename.toLowerCase().endsWith('.mov');
    });
  }

  /**
   * Export screenshot attachment to temporary directory
   */
  private static async exportScreenshotAttachment(parser: XCResultParser, attachment: TestAttachment): Promise<string> {
    const attachmentId = attachment.payloadId || attachment.payload_uuid || attachment.payloadUUID;
    if (!attachmentId) {
      throw new Error('Attachment does not have a valid ID for export');
    }

    const filename = attachment.filename || attachment.name || `screenshot_${attachmentId}.png`;
    return await parser.exportAttachment(attachmentId, filename);
  }

  /**
   * Extract screenshot from video attachment using ffmpeg at specific timestamp
   */
  private static async extractScreenshotFromVideo(parser: XCResultParser, attachment: TestAttachment, testName: string, timestamp: number): Promise<string> {
    const attachmentId = attachment.payloadId || attachment.payload_uuid || attachment.payloadUUID;
    if (!attachmentId) {
      throw new Error('Video attachment does not have a valid ID for export');
    }

    // Export video to temporary directory
    const videoFilename = attachment.filename || attachment.name || `video_${attachmentId}.mp4`;
    const videoPath = await parser.exportAttachment(attachmentId, videoFilename);
    
    Logger.info(`Exported video to: ${videoPath}`);

    // Generate screenshot path
    const tempDir = join(tmpdir(), 'xcode-mcp-attachments');
    const screenshotFilename = `screenshot_${testName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.png`;
    const screenshotPath = join(tempDir, screenshotFilename);

    // Extract screenshot using ffmpeg at specific timestamp
    await this.runFFmpeg(videoPath, screenshotPath, timestamp);

    // Verify screenshot was created
    if (!existsSync(screenshotPath)) {
      throw new Error(`Failed to create screenshot at ${screenshotPath}`);
    }

    Logger.info(`Screenshot extracted to: ${screenshotPath}`);
    return screenshotPath;
  }

  /**
   * Run ffmpeg to extract a frame from video as PNG at specific timestamp
   */
  private static async runFFmpeg(videoPath: string, outputPath: string, timestamp: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try common ffmpeg paths
      const ffmpegPaths = [
        '/opt/homebrew/bin/ffmpeg',  // Homebrew on Apple Silicon
        '/usr/local/bin/ffmpeg',     // Homebrew on Intel
        'ffmpeg'                     // System PATH
      ];

      let ffmpegPath = 'ffmpeg';
      for (const path of ffmpegPaths) {
        if (existsSync(path)) {
          ffmpegPath = path;
          break;
        }
      }

      Logger.info(`Using ffmpeg at: ${ffmpegPath}`);
      Logger.info(`Extracting frame from: ${videoPath} at ${timestamp}s`);
      Logger.info(`Output path: ${outputPath}`);

      // Extract a frame at the specific timestamp as PNG
      const process = spawn(ffmpegPath, [
        '-i', videoPath,           // Input video
        '-ss', timestamp.toString(), // Seek to specific timestamp
        '-frames:v', '1',          // Extract only 1 frame
        '-q:v', '2',               // High quality
        '-y',                      // Overwrite output file
        outputPath                 // Output PNG file
      ], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stderr = '';
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          Logger.info(`ffmpeg completed successfully`);
          
          // Add a small delay to ensure file is written
          setTimeout(() => {
            if (existsSync(outputPath)) {
              resolve();
            } else {
              reject(new Error(`Screenshot file not found after ffmpeg completion: ${outputPath}`));
            }
          }, 100);
        } else {
          Logger.error(`ffmpeg failed with code ${code}`);
          Logger.error(`ffmpeg stderr: ${stderr}`);
          reject(new Error(`ffmpeg failed with code ${code}: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        Logger.error(`ffmpeg execution error: ${error.message}`);
        reject(new Error(`Failed to run ffmpeg: ${error.message}. Make sure ffmpeg is installed (brew install ffmpeg)`));
      });
    });
  }
}