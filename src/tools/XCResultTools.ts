import { existsSync } from 'fs';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { XCResultParser } from '../utils/XCResultParser.js';
import type { McpResult } from '../types/index.js';

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
}