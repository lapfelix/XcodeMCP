import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { XCResultParser } from '../utils/XCResultParser.js';
import Logger from '../utils/Logger.js';
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
        usage += '  View test details: xcresult-browse --xcresult-path <path> --test-id <test-id-or-index>\n';
        usage += '  View with console: xcresult-browse --xcresult-path <path> --test-id <test-id-or-index> --include-console\n';
        usage += '  Get console only: xcresult-browser-get-console --xcresult-path <path> --test-id <test-id-or-index>\n';
        usage += '  Get UI hierarchy: xcresult-get-ui-hierarchy --xcresult-path <path> --test-id <test-id-or-index> --timestamp [timestamp]\n';
        usage += '  Get screenshot: xcresult-get-screenshot --xcresult-path <path> --test-id <test-id-or-index> --timestamp <timestamp>\n';
        usage += '  Examples:\n';
        usage += `    xcresult-browse --xcresult-path "${xcresultPath}" --test-id 5\n`;
        usage += `    xcresult-browse --xcresult-path "${xcresultPath}" --test-id "SomeTest/testMethod()" --include-console\n`;
        usage += `    xcresult-get-ui-hierarchy --xcresult-path "${xcresultPath}" --test-id 5 --timestamp 120.5\n`;
        usage += `    xcresult-get-screenshot --xcresult-path "${xcresultPath}" --test-id 5 --timestamp 120.5\n`;
        
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

      // Check if output is very long and should be saved to a file
      const lineCount = output.split('\n').length;
      const charCount = output.length;
      
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
        
        await writeFile(filePath, output, 'utf-8');
        
        const fileSizeKB = Math.round(charCount / 1024);
        
        return { 
          content: [{ 
            type: 'text', 
            text: `📟 Console Output for: ${testNode.name}\n` +
                  `📄 Output saved to file (${lineCount} lines, ${fileSizeKB} KB): ${filePath}\n\n` +
                  `💡 The console output was too large to display directly. ` +
                  `You can read the file to access the complete console log and test activities.`
          }] 
        };
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
   * List all attachments for a test
   */
  public static async xcresultListAttachments(
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
      
      let output = `📎 Attachments for test: ${testNode.name}\n`;
      output += `Found ${attachments.length} attachments\n`;
      output += '='.repeat(80) + '\n\n';
      
      if (attachments.length === 0) {
        output += 'No attachments found for this test.\n';
      } else {
        attachments.forEach((att, index) => {
          const rawFilename = att.name ?? att.filename ?? 'unnamed';
          const filename = typeof rawFilename === 'string' ? rawFilename : String(rawFilename);
          output += `[${index + 1}] ${filename}\n`;
          
          // Determine type from identifier or filename
          let type = att.uniform_type_identifier || att.uniformTypeIdentifier || '';
          if (!type || type === 'unknown') {
            // Infer type from filename extension or special patterns
            const lowered = filename.toLowerCase();
            const ext = lowered.split('.').pop();
            if (ext === 'jpeg' || ext === 'jpg') type = 'public.jpeg';
            else if (ext === 'png') type = 'public.png';
            else if (ext === 'mp4') type = 'public.mpeg-4';
            else if (ext === 'mov') type = 'com.apple.quicktime-movie';
            else if (ext === 'txt') type = 'public.plain-text';
            else if (lowered.includes('app ui hierarchy')) type = 'ui-hierarchy';
            else if (lowered.includes('ui snapshot')) type = 'ui-snapshot';
            else if (lowered.includes('synthesized event')) type = 'synthesized-event';
            else type = 'unknown';
          }
          
          output += `    Type: ${type}\n`;
          if (att.payloadSize || att.payload_size) {
            output += `    Size: ${att.payloadSize || att.payload_size} bytes\n`;
          }
          output += '\n';
        });
        
        output += '\n💡 To export a specific attachment, use xcresult_export_attachment with the attachment index.\n';
      }
      
      return { content: [{ type: 'text', text: output }] };

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
        `Failed to list attachments: ${errorMessage}`
      );
    }
  }


  /**
   * Export a specific attachment by index
   */
  public static async xcresultExportAttachment(
    xcresultPath: string,
    testId: string,
    attachmentIndex: number,
    convertToJson: boolean = false
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

    if (attachmentIndex < 1) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Attachment index must be 1 or greater'
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
          `No attachments found for test '${testNode.name}'.`
        );
      }

      if (attachmentIndex > attachments.length) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid attachment index ${attachmentIndex}. Test has ${attachments.length} attachments.`
        );
      }

      const attachment = attachments[attachmentIndex - 1];
      if (!attachment) {
        throw new McpError(
          ErrorCode.InternalError,
          `Attachment at index ${attachmentIndex} not found`
        );
      }

      const attachmentId = attachment.payloadId || attachment.payload_uuid || attachment.payloadUUID;
      if (!attachmentId) {
        throw new McpError(
          ErrorCode.InternalError,
          'Attachment does not have a valid ID for export'
        );
      }

      const rawFilename = attachment.filename ?? attachment.name ?? `attachment_${attachmentIndex}`;
      const filename = typeof rawFilename === 'string' ? rawFilename : String(rawFilename);
      
      // Determine type from identifier or filename first
      let type = attachment.uniform_type_identifier || attachment.uniformTypeIdentifier || '';
      if (!type || type === 'unknown') {
        // Infer type from filename extension or special patterns
        const lowered = filename.toLowerCase();
        const ext = lowered.split('.').pop();
        if (ext === 'jpeg' || ext === 'jpg') type = 'public.jpeg';
        else if (ext === 'png') type = 'public.png';
        else if (ext === 'mp4') type = 'public.mpeg-4';
        else if (ext === 'mov') type = 'com.apple.quicktime-movie';
        else if (ext === 'txt') type = 'public.plain-text';
        else if (lowered.includes('app ui hierarchy')) type = 'ui-hierarchy';
        else if (lowered.includes('ui snapshot')) type = 'ui-snapshot';
        else if (lowered.includes('synthesized event')) type = 'synthesized-event';
        else type = 'unknown';
      }

      const exportedPath = await parser.exportAttachment(attachmentId, filename);
      
      // Handle UI hierarchy files specially  
      if (type === 'ui-hierarchy') {
        if (convertToJson) {
          const hierarchyJson = await this.convertUIHierarchyToJSON(exportedPath);
          return { 
            content: [{ 
              type: 'text', 
              text: JSON.stringify(hierarchyJson)
            }] 
          };
        }
        
        // Return the raw UI hierarchy content (it's already AI-friendly)
        const { readFile } = await import('fs/promises');
        const hierarchyContent = await readFile(exportedPath, 'utf-8');
        return { 
          content: [{ 
            type: 'text', 
            text: `UI Hierarchy for: ${filename}\nType: ${type}\n\n${hierarchyContent}`
          }] 
        };
      }

      return { 
        content: [{ 
          type: 'text', 
          text: `Attachment exported to: ${exportedPath}\nFilename: ${filename}\nType: ${type}`
        }] 
      };

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
        `Failed to export attachment: ${errorMessage}`
      );
    }
  }

  /**
   * Get UI hierarchy attachment from test as JSON (slim AI-readable version by default)
   */
  public static async xcresultGetUIHierarchy(
    xcresultPath: string,
    testId: string,
    timestamp?: number,
    fullHierarchy: boolean = false,
    rawFormat: boolean = false
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
          `No attachments found for test '${testNode.name}'. This test may not have UI snapshots.`
        );
      }

      Logger.info(`Found ${attachments.length} attachments for test ${testNode.name}`);
      
      // Log all attachment details for debugging
      Logger.info('All attachments:');
      attachments.forEach((att, index) => {
        Logger.info(`  ${index + 1}. Name: ${att.name || att.filename || 'unnamed'}, Type: ${att.uniform_type_identifier || att.uniformTypeIdentifier || 'unknown'}`);
      });

      // Look for App UI hierarchy attachments (text-based)
      const uiHierarchyAttachments = this.findAppUIHierarchyAttachments(attachments);
      if (uiHierarchyAttachments.length === 0) {
        const attachmentNames = attachments.map(a => a.name || a.filename || 'unnamed').join(', ');
        throw new McpError(
          ErrorCode.InvalidParams,
          `No App UI hierarchy attachments found for test '${testNode.name}'. Available attachments: ${attachmentNames}`
        );
      }

      // If timestamp is provided, find the closest UI hierarchy attachment
      let selectedAttachment = uiHierarchyAttachments[0];
      if (timestamp !== undefined && uiHierarchyAttachments.length > 1) {
        Logger.info(`Looking for UI hierarchy closest to timestamp ${timestamp}s`);
        const closestAttachment = this.findClosestUISnapshot(uiHierarchyAttachments, timestamp);
        if (closestAttachment) {
          selectedAttachment = closestAttachment;
        }
      } else if (uiHierarchyAttachments.length > 1) {
        Logger.info(`Multiple UI hierarchy attachments found (${uiHierarchyAttachments.length}). Using the first one. Specify a timestamp to select a specific one.`);
      }

      if (!selectedAttachment) {
        throw new McpError(
          ErrorCode.InternalError,
          `No valid UI hierarchy found for test '${testNode.name}'`
        );
      }

      // If raw format is requested, return the original accessibility tree text
      if (rawFormat) {
        const attachmentId = selectedAttachment.payloadId || selectedAttachment.payload_uuid || selectedAttachment.payloadUUID;
        if (!attachmentId) {
          throw new McpError(
            ErrorCode.InternalError,
            'UI hierarchy attachment does not have a valid ID for export'
          );
        }

        const filename = selectedAttachment.filename || selectedAttachment.name || 'ui-hierarchy';
        const exportedPath = await parser.exportAttachment(attachmentId, filename);
        
        const { readFile } = await import('fs/promises');
        const hierarchyContent = await readFile(exportedPath, 'utf-8');
        
        const timestampInfo = timestamp !== undefined && selectedAttachment.timestamp !== undefined
          ? ` (closest to ${timestamp}s, actual: ${selectedAttachment.timestamp}s)`
          : '';

        return { 
          content: [{ 
            type: 'text', 
            text: `🌲 Raw UI Hierarchy for test '${testNode.name}'${timestampInfo}:\n\n${hierarchyContent}`
          }] 
        };
      }

      // Export and convert text-based UI hierarchy to JSON
      const hierarchyData = await this.exportTextUIHierarchyAsJSON(parser, selectedAttachment, testNode.name);
      
      if (fullHierarchy) {
        // Save full JSON to file with warning
        const jsonFilename = `ui_hierarchy_full_${testNode.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
        const jsonPath = await this.saveUIHierarchyJSON(hierarchyData, jsonFilename);
        
        const fileSizeKB = Math.round(JSON.stringify(hierarchyData).length / 1024);
        
        return { 
          content: [{ 
            type: 'text', 
            text: `⚠️  LARGE FILE WARNING: Full UI hierarchy exported (${fileSizeKB} KB)\n\n` +
                  `📄 Full hierarchy: ${jsonPath}\n\n` +
                  `💡 For AI analysis, consider using the slim version instead:\n` +
                  `   xcresult_get_ui_hierarchy "${xcresultPath}" "${testId}" ${timestamp || ''} false`
          }] 
        };
      } else {
        // Default: Create and save slim AI-readable version
        const slimData = this.createSlimUIHierarchy(hierarchyData);
        const slimFilename = `ui_hierarchy_${testNode.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
        const slimPath = await this.saveUIHierarchyJSON(slimData, slimFilename);
        
        // Also save full data for element lookup
        const fullFilename = `ui_hierarchy_full_${testNode.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.json`;
        const fullPath = await this.saveUIHierarchyJSON(hierarchyData, fullFilename);
        
        // Try to find a screenshot at the specified timestamp
        let screenshotInfo = '';
        const screenshotTimestamp = timestamp || selectedAttachment.timestamp;
        if (screenshotTimestamp !== undefined) {
          try {
            const screenshotResult = await this.xcresultGetScreenshot(
              xcresultPath, 
              testId, 
              screenshotTimestamp
            );
            if (screenshotResult && screenshotResult.content?.[0] && 'text' in screenshotResult.content[0]) {
              const textContent = screenshotResult.content[0];
              if (textContent.type === 'text' && typeof textContent.text === 'string') {
                // Extract the screenshot path from the result text
                const pathMatch = textContent.text.match(/Screenshot extracted .+: (.+)/);
                if (pathMatch && pathMatch[1]) {
                  screenshotInfo = `\n📸 Screenshot at timestamp ${screenshotTimestamp}s: ${pathMatch[1]}`;
                }
              }
            }
          } catch (error) {
            // Screenshot extraction failed, continue without it
            Logger.info(`Could not extract screenshot at timestamp ${screenshotTimestamp}s: ${error}`);
          }
        }
        
        return { 
          content: [{ 
            type: 'text', 
            text: `🤖 AI-readable UI hierarchy: ${slimPath}\n\n` +
                  `💡 Slim version properties:\n` +
                  `  • t = type (element type like Button, StaticText, etc.)\n` +
                  `  • l = label (visible text/accessibility label)\n` +
                  `  • c = children (array of child elements)\n` +
                  `  • j = index (reference to full element in original JSON)\n\n` +
                  `🔍 Use xcresult_get_ui_element "${fullPath}" <index> to get full details of any element.\n` +
                  `⚠️  To get the full hierarchy (several MB), use: full_hierarchy=true${screenshotInfo}`
          }] 
        };
      }

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
        `Failed to get UI hierarchy: ${errorMessage}`
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

      // Look for direct image attachment (PNG or JPEG) as fallback
      const closestImageResult = this.findClosestImageAttachment(attachments, timestamp);
      if (closestImageResult) {
        const screenshotPath = await this.exportScreenshotAttachment(parser, closestImageResult.attachment);
        const timeDiff = closestImageResult.timeDifference;
        const timeDiffText = timeDiff === 0 
          ? 'at exact timestamp' 
          : timeDiff > 0 
            ? `${timeDiff.toFixed(2)}s after requested time` 
            : `${Math.abs(timeDiff).toFixed(2)}s before requested time`;
            
        return { 
          content: [{ 
            type: 'text', 
            text: `Screenshot exported for test '${testNode.name}' (${timeDiffText}): ${screenshotPath}` 
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
   * Find App UI hierarchy attachments (text-based)
   */
  private static findAppUIHierarchyAttachments(attachments: TestAttachment[]): TestAttachment[] {
    return attachments.filter(attachment => {
      const name = attachment.name || attachment.filename || '';
      return name.includes('App UI hierarchy');
    });
  }

  /**
   * Find UI Snapshot attachments (legacy method)
   */
  // private static findUISnapshotAttachments(attachments: TestAttachment[]): TestAttachment[] {
  //   return attachments.filter(attachment => {
  //     const name = attachment.name || attachment.filename || '';
  //     // Look for both "UI Snapshot" and "App UI hierarchy" attachments
  //     return name.includes('UI Snapshot') || name.includes('App UI hierarchy');
  //   });
  // }

  /**
   * Find the UI snapshot closest to a given timestamp
   */
  private static findClosestUISnapshot(attachments: TestAttachment[], timestamp: number): TestAttachment | undefined {
    if (attachments.length === 0) {
      return undefined;
    }
    
    // If only one attachment, return it
    if (attachments.length === 1) {
      return attachments[0];
    }
    
    let closest = attachments[0];
    let minDifference = Infinity;
    let attachmentsWithTimestamps = 0;
    
    // Log available attachments and their timestamps for debugging
    Logger.info(`Finding closest attachment to timestamp ${timestamp}s among ${attachments.length} attachments`);
    
    for (const attachment of attachments) {
      // Use timestamp if available, otherwise try to extract from name
      let attachmentTime = attachment.timestamp;
      
      // If no direct timestamp, try alternative approaches
      if (attachmentTime === undefined || isNaN(attachmentTime)) {
        // Try to extract timestamp from attachment name if it contains time info
        if (attachment.name) {
          const timeMatch = attachment.name.match(/t\s*=\s*([\d.]+)s/);
          if (timeMatch && timeMatch[1]) {
            attachmentTime = parseFloat(timeMatch[1]);
          }
        }
      }
      
      // Log attachment details for debugging
      Logger.info(`  Attachment "${attachment.name}" - timestamp: ${attachmentTime}, type: ${attachment.uniform_type_identifier || attachment.uniformTypeIdentifier || 'unknown'}`);
      
      if (attachmentTime !== undefined && !isNaN(attachmentTime)) {
        attachmentsWithTimestamps++;
        // Both timestamps should be in seconds
        const difference = Math.abs(attachmentTime - timestamp);
        Logger.info(`    Time difference: ${difference}s`);
        
        if (difference < minDifference) {
          minDifference = difference;
          closest = attachment;
        }
      }
    }
    
    // If no attachments have timestamps, use a different strategy
    if (attachmentsWithTimestamps === 0) {
      Logger.info(`No timestamp information found for UI hierarchy attachments. Using attachment order heuristic.`);
      
      // For UI hierarchy attachments without timestamps, prefer the later one
      // when the requested timestamp is > 60s (indicating late in test execution)
      if (timestamp > 60 && attachments.length >= 2) {
        const lastAttachment = attachments[attachments.length - 1];
        if (lastAttachment) {
          closest = lastAttachment; // Use last attachment
          Logger.info(`Selected last attachment "${closest.name || 'unnamed'}" based on late timestamp heuristic (${timestamp}s > 60s)`);
        }
      } else {
        const firstAttachment = attachments[0];
        if (firstAttachment) {
          closest = firstAttachment; // Use first attachment for early timestamps
          Logger.info(`Selected first attachment "${closest.name || 'unnamed'}" based on early timestamp heuristic (${timestamp}s <= 60s)`);
        }
      }
    } else if (closest) {
      Logger.info(`Selected attachment "${closest.name}" with minimum time difference of ${minDifference}s (found timestamps on ${attachmentsWithTimestamps}/${attachments.length} attachments)`);
    }
    
    return closest;
  }

  /**
   * Export UI hierarchy attachment and convert to JSON (legacy plist method)
   */
  // private static async exportUIHierarchyAsJSON(parser: XCResultParser, attachment: TestAttachment, testName: string): Promise<any> {
  //   const attachmentId = attachment.payloadId || attachment.payload_uuid || attachment.payloadUUID;
  //   if (!attachmentId) {
  //     throw new Error('UI Snapshot attachment does not have a valid ID for export');
  //   }

  //   // Export the UI snapshot to a temporary file
  //   const filename = `ui_hierarchy_${testName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.plist`;
  //   const plistPath = await parser.exportAttachment(attachmentId, filename);
    
  //   Logger.info(`Exported UI hierarchy to: ${plistPath}`);

  //   // Convert the plist to JSON using a more robust approach
  //   return await this.convertUIHierarchyToJSON(plistPath);
  // }

  /**
   * Convert UI hierarchy plist to JSON using plutil -p (readable format)
   */
  private static async convertUIHierarchyToJSON(plistPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Use plutil -p to get a readable format, then parse it
      const process = spawn('plutil', ['-p', plistPath], {
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

      process.on('close', (code) => {
        if (code === 0) {
          // Parse the plutil -p output
          this.parsePlutilOutput(stdout)
            .then(resolve)
            .catch(reject);
        } else {
          Logger.error(`plutil failed with code ${code}: ${stderr}`);
          reject(new Error(`Failed to read plist: ${stderr}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Failed to run plutil: ${error.message}`));
      });
    });
  }

  /**
   * Parse plutil -p output to extract UI hierarchy information
   */
  private static async parsePlutilOutput(plutilOutput: string): Promise<any> {
    return new Promise((resolve) => {
      try {
        // Extract meaningful UI hierarchy data from plutil output
        const lines = plutilOutput.split('\n');
        
        // Look for the main UI element structure
        const uiElement: any = {
          parseMethod: 'plutil_readable',
          rawPlistSize: lines.length,
        };

        // Extract key information
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]?.trim();
          if (!line) continue;
          
          // Look for elementType
          if (line.includes('"elementType"')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && nextLine.includes('value =')) {
              const valueMatch = nextLine.match(/value = (\d+)/);
              if (valueMatch && valueMatch[1]) {
                const elementType = parseInt(valueMatch[1]);
                uiElement.elementType = elementType;
                
                // Add description  
                const descriptions: { [key: number]: string } = {
                  1: 'Application', 2: 'Group', 3: 'Window', 8: 'Button',
                  20: 'NavigationBar', 21: 'TabBar', 22: 'TabGroup', 23: 'Toolbar', 25: 'Table', 
                  31: 'CollectionView', 36: 'SegmentedControl', 45: 'ScrollView', 47: 'StaticText', 48: 'TextField'
                };
                if (descriptions[elementType]) {
                  uiElement.elementTypeDescription = descriptions[elementType];
                }
              }
            }
          }
          
          // Look for label
          if (line.includes('"label"')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && nextLine.includes('value =')) {
              const valueMatch = nextLine.match(/value = (\d+)/);
              if (valueMatch && valueMatch[1]) {
                const labelIndex = parseInt(valueMatch[1]);
                // Find the actual label value by looking for index references
                for (let j = 0; j < lines.length; j++) {
                  const currentLine = lines[j];
                  if (currentLine && currentLine.includes(`${labelIndex} =>`)) {
                    const labelLine = lines[j + 1]?.trim();
                    if (labelLine && labelLine.startsWith('"') && labelLine.endsWith('"')) {
                      uiElement.label = labelLine.slice(1, -1); // Remove quotes
                    }
                    break;
                  }
                }
              }
            }
          }
          
          // Look for identifier
          if (line.includes('"identifier"')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && nextLine.includes('value =')) {
              const valueMatch = nextLine.match(/value = (\d+)/);
              if (valueMatch && valueMatch[1]) {
                const idIndex = parseInt(valueMatch[1]);
                // Find the actual identifier value
                for (let j = 0; j < lines.length; j++) {
                  const currentLine = lines[j];
                  if (currentLine && currentLine.includes(`${idIndex} =>`)) {
                    const idLine = lines[j + 1]?.trim();
                    if (idLine && idLine.startsWith('"')) {
                      uiElement.identifier = idLine.slice(1, -1); // Remove quotes
                    }
                    break;
                  }
                }
              }
            }
          }
          
          // Look for enabled
          if (line.includes('"enabled"')) {
            const nextLine = lines[i + 1]?.trim();
            if (nextLine && nextLine.includes('value =')) {
              const valueMatch = nextLine.match(/value = (\d+)/);
              if (valueMatch && valueMatch[1]) {
                const enabledIndex = parseInt(valueMatch[1]);
                // Find the actual enabled value
                for (let j = 0; j < lines.length; j++) {
                  const currentLine = lines[j];
                  if (currentLine && currentLine.includes(`${enabledIndex} =>`)) {
                    const enabledLine = lines[j + 1]?.trim();
                    if (enabledLine === '1' || enabledLine === '0') {
                      uiElement.enabled = enabledLine === '1';
                    }
                    break;
                  }
                }
              }
            }
          }
        }

        // Extract some statistics
        const objectCount = plutilOutput.match(/\d+ =>/g)?.length || 0;
        uiElement.totalObjectsInPlist = objectCount;
        
        // Look for Transit app information and other string values
        if (plutilOutput.includes('Transit')) {
          const transitMatches = plutilOutput.match(/"[^"]*Transit[^"]*"/g) || [];
          uiElement.transitAppReferences = transitMatches;
        }
        
        // Try to extract the label directly from known patterns
        if (plutilOutput.includes('19 => "Transit χ"')) {
          uiElement.label = 'Transit χ';
        }
        
        // Extract all string values for debugging
        const allStrings = plutilOutput.match(/"[^"]+"/g) || [];
        uiElement.allStringsFound = allStrings.slice(0, 10); // First 10 strings

        resolve(uiElement);
      } catch (error) {
        resolve({
          parseMethod: 'plutil_readable',
          error: `Failed to parse plutil output: ${error instanceof Error ? error.message : String(error)}`,
          rawOutputPreview: plutilOutput.slice(0, 500)
        });
      }
    });
  }

  /**
   * Export text-based UI hierarchy attachment and convert to JSON
   */
  private static async exportTextUIHierarchyAsJSON(parser: XCResultParser, attachment: TestAttachment, testName: string): Promise<any> {
    const attachmentId = attachment.payloadId || attachment.payload_uuid || attachment.payloadUUID;
    if (!attachmentId) {
      throw new Error('App UI hierarchy attachment does not have a valid ID for export');
    }

    // Export the UI hierarchy to a temporary file
    const filename = `ui_hierarchy_${testName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.txt`;
    const textPath = await parser.exportAttachment(attachmentId, filename);
    
    Logger.info(`Exported UI hierarchy to: ${textPath}`);

    // Convert the indented text format to JSON
    return await this.convertIndentedUIHierarchyToJSON(textPath);
  }

  /**
   * Convert indented text-based UI hierarchy to structured JSON
   */
  private static async convertIndentedUIHierarchyToJSON(textPath: string): Promise<any> {
    const fs = await import('fs');
    
    try {
      const content = fs.readFileSync(textPath, 'utf8');
      const lines = content.split('\n');
      
      const result = {
        parseMethod: 'indented_text',
        totalLines: lines.length,
        rootElement: null as any,
        flatElements: [] as any[]
      };

      let elementStack: any[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.trim()) continue;
        
        // Calculate indentation level
        const indentLevel = line.search(/\S/);
        const trimmedLine = line.trim();
        
        // Parse element information
        const element = this.parseUIElementLine(trimmedLine, indentLevel);
        
        if (element) {
          // Handle hierarchy based on indentation
          while (elementStack.length > 0 && elementStack[elementStack.length - 1].indentLevel >= indentLevel) {
            elementStack.pop();
          }
          
          element.indentLevel = indentLevel;
          element.children = [];
          
          if (elementStack.length === 0) {
            // Root element
            result.rootElement = element;
          } else {
            // Child element
            const parent = elementStack[elementStack.length - 1];
            parent.children.push(element);
            element.parent = parent.type || 'unknown';
          }
          
          elementStack.push(element);
          result.flatElements.push(element);
        }
      }
      
      return result;
    } catch (error) {
      return {
        parseMethod: 'indented_text',
        error: `Failed to parse indented UI hierarchy: ${error instanceof Error ? error.message : String(error)}`,
        rawContentPreview: ''
      };
    }
  }

  /**
   * Parse a single line of UI element information
   */
  private static parseUIElementLine(line: string, indentLevel: number): any | null {
    // Common patterns in UI hierarchy text format:
    // Application, pid: 12345
    // Window (Main)
    // Button "Submit"
    // StaticText "Hello World"
    // TextField (secure) "password"
    
    if (!line || line.trim() === '') return null;
    
    const element: any = {
      raw: line,
      indentLevel,
      type: 'unknown',
      label: '',
      attributes: {},
      children: []
    };
    
    // Extract element type (first word usually)
    const typeMatch = line.match(/^(\w+)/);
    if (typeMatch) {
      element.type = typeMatch[1];
    }
    
    // Extract quoted text (labels)
    const quotedTextMatch = line.match(/"([^"]*)"/);
    if (quotedTextMatch) {
      element.label = quotedTextMatch[1];
    }
    
    // Extract parenthesized attributes
    const parenthesesMatch = line.match(/\(([^)]*)\)/);
    if (parenthesesMatch) {
      element.attributes.details = parenthesesMatch[1];
    }
    
    // Extract specific patterns
    if (line.includes('pid:')) {
      const pidMatch = line.match(/pid:\s*(\d+)/);
      if (pidMatch && pidMatch[1]) {
        element.attributes.processId = parseInt(pidMatch[1]);
      }
    }
    
    // Extract coordinates/bounds if present
    const boundsMatch = line.match(/\{\{([\d.-]+),\s*([\d.-]+)\},\s*\{([\d.-]+),\s*([\d.-]+)\}\}/);
    if (boundsMatch && boundsMatch[1] && boundsMatch[2] && boundsMatch[3] && boundsMatch[4]) {
      element.attributes.frame = {
        x: parseFloat(boundsMatch[1]),
        y: parseFloat(boundsMatch[2]),
        width: parseFloat(boundsMatch[3]),
        height: parseFloat(boundsMatch[4])
      };
    }
    
    // Extract accessibility identifiers
    if (line.includes('identifier:')) {
      const idMatch = line.match(/identifier:\s*"([^"]*)"/);
      if (idMatch) {
        element.attributes.identifier = idMatch[1];
      }
    }
    
    return element;
  }

  /**
   * Save UI hierarchy data to a JSON file
   */
  private static async saveUIHierarchyJSON(hierarchyData: any, filename: string): Promise<string> {
    const fs = await import('fs');
    const path = await import('path');
    
    // Use same temp directory as other attachments
    const tempDir = path.join(tmpdir(), 'xcode-mcp-attachments');
    
    // Ensure directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const jsonPath = path.join(tempDir, filename);
    
    // Write compact JSON
    fs.writeFileSync(jsonPath, JSON.stringify(hierarchyData), 'utf8');
    
    Logger.info(`Saved UI hierarchy JSON to: ${jsonPath}`);
    return jsonPath;
  }

  /**
   * Create slim AI-readable UI hierarchy with index mapping
   */
  private static createSlimUIHierarchy(hierarchyData: any): any {
    const flatElements = hierarchyData.flatElements || [];
    let globalIndex = 0;
    
    // Create index mapping for quick lookup
    const indexMap = new Map();
    flatElements.forEach((element: any, index: number) => {
      indexMap.set(element, index);
    });

    function slim(node: any): any {
      if (node == null || typeof node !== 'object') return node;

      const currentIndex = indexMap.get(node) ?? globalIndex++;
      
      // Extract label from raw field (pattern: label: 'text') or use existing label
      const labelMatch = node.raw?.match(/label: '([^']+)'/);
      const extractedLabel = labelMatch ? labelMatch[1] : undefined;
      
      const slimmed: any = {
        t: node.type,
        l: extractedLabel || node.label || undefined,
        j: currentIndex  // Index reference to full element
      };

      // Frame removed to reduce noise

      // Recurse if children present
      if (Array.isArray(node.children) && node.children.length) {
        slimmed.c = node.children.map(slim);
      }

      // Drop undefined keys to save bytes
      Object.keys(slimmed).forEach(k => slimmed[k] === undefined && delete slimmed[k]);
      return slimmed;
    }

    const slimRoot = slim(hierarchyData.rootElement || hierarchyData);
    
    return {
      parseMethod: 'slim_ui_tree',
      originalElementCount: flatElements.length,
      rootElement: slimRoot
    };
  }

  /**
   * Get UI element details by index from previously exported hierarchy
   */
  public static async xcresultGetUIElement(
    hierarchyJsonPath: string,
    elementIndex: number,
    includeChildren: boolean = false
  ): Promise<McpResult> {
    const fs = await import('fs');
    
    if (!fs.existsSync(hierarchyJsonPath)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `UI hierarchy JSON file not found: ${hierarchyJsonPath}`
      );
    }

    try {
      const hierarchyData = JSON.parse(fs.readFileSync(hierarchyJsonPath, 'utf8'));
      const flatElements = hierarchyData.flatElements || [];
      
      if (elementIndex < 0 || elementIndex >= flatElements.length) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Element index ${elementIndex} out of range. Available indices: 0-${flatElements.length - 1}`
        );
      }

      const element = flatElements[elementIndex];
      
      // Create result with full element details
      const result: any = {
        index: elementIndex,
        type: element.type,
        label: element.label,
        raw: element.raw,
        indentLevel: element.indentLevel,
        attributes: element.attributes || {}
      };

      if (includeChildren && element.children) {
        result.children = element.children;
      } else if (element.children) {
        result.childrenCount = element.children.length;
        result.hasChildren = true;
      }

      if (element.parent) {
        result.parent = element.parent;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to read UI element: ${errorMessage}`
      );
    }
  }


  /**
   * Find the closest image attachment to a specific timestamp
   */
  private static findClosestImageAttachment(attachments: TestAttachment[], targetTimestamp: number): { attachment: TestAttachment; timeDifference: number } | undefined {
    // Filter to only image attachments
    const imageAttachments = attachments.filter(attachment => {
      const typeId = attachment.uniform_type_identifier || attachment.uniformTypeIdentifier || '';
      const rawFilename = attachment.filename ?? attachment.name ?? '';
      const filename = typeof rawFilename === 'string' ? rawFilename : String(rawFilename);
      
      return typeId.includes('png') || 
             typeId === 'public.png' || 
             typeId.includes('jpeg') ||
             typeId.includes('jpg') ||
             typeId === 'public.jpeg' ||
             filename.toLowerCase().endsWith('.png') ||
             filename.toLowerCase().endsWith('.jpg') ||
             filename.toLowerCase().endsWith('.jpeg');
    });

    if (imageAttachments.length === 0) {
      return undefined;
    }

    // Find the attachment with the smallest time difference
    let closest: { attachment: TestAttachment; timeDifference: number } | undefined;
    let smallestDiff = Infinity;

    for (const attachment of imageAttachments) {
      if (attachment.timestamp !== undefined) {
        const timeDiff = attachment.timestamp - targetTimestamp;
        const absDiff = Math.abs(timeDiff);
        
        if (absDiff < smallestDiff) {
          smallestDiff = absDiff;
          closest = { attachment, timeDifference: timeDiff };
        }
      }
    }

    // If no attachment has a timestamp, return the first image attachment
    if (!closest && imageAttachments.length > 0) {
      const firstImage = imageAttachments[0];
      if (firstImage) {
        return { attachment: firstImage, timeDifference: 0 };
      }
    }
    
    return closest;
  }


  /**
   * Find video attachment by type identifier and filename extension
   */
  private static findVideoAttachment(attachments: TestAttachment[]): TestAttachment | undefined {
    return attachments.find(attachment => {
      const typeId = attachment.uniform_type_identifier || attachment.uniformTypeIdentifier || '';
      const rawFilename = attachment.filename ?? attachment.name ?? '';
      const filename = typeof rawFilename === 'string' ? rawFilename : String(rawFilename);
      
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

export default XCResultTools;
