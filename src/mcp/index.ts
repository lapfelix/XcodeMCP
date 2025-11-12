import { spawn } from 'child_process';
import Logger from '../utils/Logger.js';
import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SseEvent {
  type: string;
  data: any;
}

export interface CallToolOptions {
  onEvent?: (event: SseEvent) => void;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

export class McpLibrary extends EventEmitter {
  private initialized = false;
  private cliPath: string;

  constructor() {
    super();
    // Path to the CLI executable
    this.cliPath = join(__dirname, '../cli.js');
  }

  /**
   * Initialize the MCP library if not already initialized
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Test CLI is available by calling help
      await this.spawnCli(['--help']);
      this.initialized = true;
      Logger.debug('MCP library initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize MCP library:', error);
      throw error;
    }
  }

  /**
   * Get all available tools with their schemas
   */
  public async getTools(): Promise<ToolDefinition[]> {
    await this.initialize();
    
    try {
      // Get tools from CLI subprocess
      const result = await this.spawnCli(['--json', 'list-tools']);
      
      if (result.exitCode !== 0) {
        throw new Error(`Failed to get tools: ${result.stderr || result.stdout}`);
      }
      
      // Parse and return tool definitions
      const toolsData = JSON.parse(result.stdout);
      if (Array.isArray(toolsData)) {
        return toolsData.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        }));
      }
      
      // Fallback to hardcoded tools if CLI doesn't return expected format
      Logger.warn('CLI returned unexpected format, using fallback tool definitions');
    } catch (error) {
      Logger.error('Failed to get tools from CLI, using fallback:', error);
    }
    
    // Fallback to hardcoded tool definitions
    return [
      {
        name: 'xcode_build',
        description: 'Build a specific Xcode project or workspace with the specified scheme. If destination is not provided, uses the currently active destination.',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file to build (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
            scheme: {
              type: 'string',
              description: 'Name of the scheme to build',
            },
            destination: {
              type: 'string',
              description: 'Build destination (optional - uses active destination if not provided)',
            },
          },
          required: ['xcodeproj', 'scheme'],
        },
      },
      {
        name: 'xcode_get_schemes',
        description: 'Get list of available schemes for a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_set_active_scheme',
        description: 'Set the active scheme for a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
            scheme_name: {
              type: 'string',
              description: 'Name of the scheme to activate',
            },
          },
          required: ['xcodeproj', 'scheme_name'],
        },
      },
      {
        name: 'xcode_clean',
        description: 'Clean the build directory for a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_test',
        description: 'Run tests for a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
            command_line_arguments: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional command line arguments',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_build_and_run',
        description: 'Build and run a specific project with the specified scheme',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
            scheme: {
              type: 'string',
              description: 'Name of the scheme to run',
            },
            command_line_arguments: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional command line arguments',
            },
          },
          required: ['xcodeproj', 'scheme'],
        },
      },
      {
        name: 'xcode_stop',
        description: 'Stop the current scheme action',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'xcode_find_xcresults',
        description: 'Find all XCResult files for a specific project with timestamps and file information',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_get_run_destinations',
        description: 'Get list of available run destinations for a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_get_workspace_info',
        description: 'Get information about a specific workspace',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_get_projects',
        description: 'Get list of projects in a specific workspace',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_open_file',
        description: 'Open a file in Xcode',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Absolute path to the file to open',
            },
            line_number: {
              type: 'number',
              description: 'Optional line number to navigate to',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'xcode_health_check',
        description: 'Perform a comprehensive health check of the XcodeMCP environment and configuration',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'xcode_xcresult_browse',
        description: 'Browse XCResult files - list all tests or show details for a specific test. Returns comprehensive test results including pass/fail status, failure details, and browsing instructions. Large console output (>20 lines or >2KB) is automatically saved to a temporary file.',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
            test_id: {
              type: 'string',
              description: 'Optional test ID or index number to show details for a specific test',
            },
            include_console: {
              type: 'boolean',
              description: 'Whether to include console output and test activities (only used with test_id)',
              default: false,
            },
          },
          required: ['xcresult_path'],
        },
      },
      {
        name: 'xcode_xcresult_browser_get_console',
        description: 'Get console output and test activities for a specific test in an XCResult file. Large output (>20 lines or >2KB) is automatically saved to a temporary file.',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
            test_id: {
              type: 'string',
              description: 'Test ID or index number to get console output for',
            },
          },
          required: ['xcresult_path', 'test_id'],
        },
      },
      {
        name: 'xcode_xcresult_summary',
        description: 'Get a quick summary of test results from an XCResult file',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
          },
          required: ['xcresult_path'],
        },
      },
      {
        name: 'xcode_xcresult_get_screenshot',
        description: 'Get screenshot from a failed test at specific timestamp - extracts frame from video attachment using ffmpeg',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
            test_id: {
              type: 'string',
              description: 'Test ID or index number to get screenshot for',
            },
            timestamp: {
              type: 'number',
              description: 'Timestamp in seconds when to extract the screenshot. WARNING: Use a timestamp BEFORE the failure (e.g., if failure is at 30.71s, use 30.69s) as failure timestamps often show the home screen after the app has crashed or reset.',
            },
          },
          required: ['xcresult_path', 'test_id', 'timestamp'],
        },
      },
      {
        name: 'xcode_xcresult_get_ui_hierarchy',
        description: 'Get UI hierarchy attachment from test. Returns raw accessibility tree (best for AI), slim AI-readable JSON (default), or full JSON.',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
            test_id: {
              type: 'string',
              description: 'Test ID or index number to get UI hierarchy for',
            },
            timestamp: {
              type: 'number',
              description: 'Optional timestamp in seconds to find the closest UI snapshot. If not provided, uses the first available UI snapshot.',
            },
            full_hierarchy: {
              type: 'boolean',
              description: 'Set to true to get the full hierarchy (several MB). Default is false for AI-readable slim version.',
            },
            raw_format: {
              type: 'boolean',
              description: 'Set to true to get the raw accessibility tree text (most AI-friendly). Default is false for JSON format.',
            },
          },
          required: ['xcresult_path', 'test_id'],
        },
      },
      {
        name: 'xcode_xcresult_get_ui_element',
        description: 'Get full details of a specific UI element by index from a previously exported UI hierarchy JSON file',
        inputSchema: {
          type: 'object',
          properties: {
            hierarchy_json_path: {
              type: 'string',
              description: 'Absolute path to the UI hierarchy JSON file (the full version saved by xcresult-get-ui-hierarchy)',
            },
            element_index: {
              type: 'number',
              description: 'Index of the element to get details for (the "j" value from the slim hierarchy)',
            },
            include_children: {
              type: 'boolean',
              description: 'Whether to include children in the response. Defaults to false.',
            },
          },
          required: ['hierarchy_json_path', 'element_index'],
        },
      },
      {
        name: 'xcode_xcresult_list_attachments',
        description: 'List all attachments for a specific test - shows attachment names, types, and indices for export',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
            test_id: {
              type: 'string',
              description: 'Test ID or index number to list attachments for',
            },
          },
          required: ['xcresult_path', 'test_id'],
        },
      },
      {
        name: 'xcode_xcresult_export_attachment',
        description: 'Export a specific attachment by index - can convert App UI hierarchy attachments to JSON',
        inputSchema: {
          type: 'object',
          properties: {
            xcresult_path: {
              type: 'string',
              description: 'Absolute path to the .xcresult file',
            },
            test_id: {
              type: 'string',
              description: 'Test ID or index number that contains the attachment',
            },
            attachment_index: {
              type: 'number',
              description: 'Index number of the attachment to export (1-based, from xcresult-list-attachments)',
            },
            convert_to_json: {
              type: 'boolean',
              description: 'If true and attachment is an App UI hierarchy, convert to JSON format',
            },
          },
          required: ['xcresult_path', 'test_id', 'attachment_index'],
        },
      },
    ];
  }

  /**
   * Spawn CLI subprocess and execute command
   */
  private async spawnCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [this.cliPath, ...args], {
        stdio: ['inherit', 'pipe', 'pipe'],
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code || 0 });
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Call a tool with the given name and arguments
   * This spawns the CLI subprocess to execute the tool
   */
  public async callTool(
    name: string,
    args: Record<string, unknown> = {},
    options: CallToolOptions = {}
  ): Promise<CallToolResult> {
    await this.initialize();

    try {
      Logger.debug(`Calling tool: ${name} with args:`, args);

      // Convert tool name to CLI command name
      const commandName = name.replace(/^xcode_/, '').replace(/_/g, '-');
      
      // Build CLI arguments
      const cliArgs = ['--json', commandName, '--json-input', JSON.stringify(args)];
      
      // Execute CLI subprocess
      const result = await this.spawnCli(cliArgs);
      
      // Parse events from stderr if callback provided
      if (options.onEvent && result.stderr) {
        const lines = result.stderr.split('\n');
        for (const line of lines) {
          if (line.startsWith('event:')) {
            const eventType = line.replace('event:', '');
            const nextLine = lines[lines.indexOf(line) + 1];
            if (nextLine?.startsWith('data:')) {
              try {
                const eventData = JSON.parse(nextLine.replace('data:', ''));
                options.onEvent({ type: eventType, data: eventData });
              } catch (parseError) {
                Logger.debug('Failed to parse SSE event:', parseError);
              }
            }
          }
        }
      }

      // Handle CLI exit code
      if (result.exitCode !== 0) {
        throw new Error(`CLI command failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
      }

      // Parse JSON output from CLI
      try {
        const parsedResult = JSON.parse(result.stdout);
        Logger.debug(`Tool ${name} completed successfully`);
        return parsedResult;
      } catch (parseError) {
        // If JSON parsing fails, wrap stdout in text content
        Logger.debug(`Tool ${name} completed with non-JSON output`);
        return { content: [{ type: 'text', text: result.stdout }] };
      }
    } catch (error) {
      Logger.error(`Tool ${name} failed:`, error);
      throw error;
    }
  }

  /**
   * Get CLI path (for advanced use cases)
   */
  public getCliPath(): string {
    return this.cliPath;
  }
}

// Export convenience functions for direct usage
let defaultLibrary: McpLibrary | null = null;

/**
 * Get or create the default MCP library instance
 */
export function getDefaultLibrary(): McpLibrary {
  if (!defaultLibrary) {
    defaultLibrary = new McpLibrary();
  }
  return defaultLibrary;
}

/**
 * Call a tool using the default library instance
 */
export async function callTool(
  name: string,
  args: Record<string, unknown> = {},
  options: CallToolOptions = {}
): Promise<CallToolResult> {
  const library = getDefaultLibrary();
  return library.callTool(name, args, options);
}

/**
 * Get all available tools using the default library instance
 */
export async function getTools(): Promise<ToolDefinition[]> {
  const library = getDefaultLibrary();
  return library.getTools();
}
