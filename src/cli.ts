#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { XcodeServer } from './XcodeServer.js';
import { Logger } from './utils/Logger.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load package.json to get version info
 */
async function loadPackageJson(): Promise<{ version: string }> {
  try {
    const packagePath = join(__dirname, '../package.json');
    const packageContent = await readFile(packagePath, 'utf-8');
    return JSON.parse(packageContent);
  } catch (error) {
    Logger.error('Failed to load package.json:', error);
    return { version: '0.0.0' };
  }
}

/**
 * Convert JSON schema property to commander option
 */
function schemaPropertyToOption(name: string, property: any): { flags: string; description: string; defaultValue?: any } {
  const flags = property.type === 'boolean' ? `--${name}` : `--${name} <value>`;
  const description = property.description || `${name} parameter`;
  
  const option = { flags, description };
  if (property.default !== undefined) {
    (option as any).defaultValue = property.default;
  }
  
  return option;
}

/**
 * Parse command line arguments into tool arguments
 */
function parseToolArgs(tool: ToolDefinition, cliArgs: Record<string, any>): Record<string, unknown> {
  const toolArgs: Record<string, unknown> = {};
  
  if (!tool.inputSchema?.properties) {
    return toolArgs;
  }
  
  for (const [propName, propSchema] of Object.entries(tool.inputSchema.properties)) {
    const propDef = propSchema as any;
    const cliValue = cliArgs[propName];
    
    if (cliValue !== undefined) {
      // Handle array types
      if (propDef.type === 'array') {
        if (Array.isArray(cliValue)) {
          toolArgs[propName] = cliValue;
        } else {
          // Split string by comma for array values
          toolArgs[propName] = cliValue.split(',').map((s: string) => s.trim());
        }
      } else if (propDef.type === 'number') {
        toolArgs[propName] = parseFloat(cliValue);
      } else if (propDef.type === 'boolean') {
        toolArgs[propName] = cliValue === true || cliValue === 'true';
      } else {
        toolArgs[propName] = cliValue;
      }
    }
  }
  
  return toolArgs;
}

/**
 * Format tool result for console output
 */
function formatResult(result: any, jsonOutput: boolean): string {
  if (jsonOutput) {
    return JSON.stringify(result, null, 2);
  }
  
  // Pretty format for console
  if (result?.content && Array.isArray(result.content)) {
    return result.content
      .map((item: any) => {
        if (item.type === 'text') {
          return item.text;
        } else if (item.type === 'image') {
          return `[Image: ${item.source?.data ? 'base64 data' : item.source?.url || 'unknown'}]`;
        } else {
          return `[${item.type}: ${JSON.stringify(item)}]`;
        }
      })
      .join('\n');
  }
  
  return JSON.stringify(result, null, 2);
}

// Note: handleSseEvent is defined but not used in CLI-first architecture
// Events are handled by the spawning process (MCP library)
// function handleSseEvent(event: SseEvent): void {
//   const eventData = `event:${event.type}\ndata:${JSON.stringify(event.data)}\n\n`;
//   process.stderr.write(eventData);
// }

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  try {
    const pkg = await loadPackageJson();
    const server = new XcodeServer();
    
    // Complete tool definitions (copied from XcodeServer.ts)
    const tools = [
      {
        name: 'xcode_open_project',
        description: 'Open an Xcode project or workspace',
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
        name: 'xcode_close_project',
        description: 'Close the currently active Xcode project or workspace (automatically stops any running actions first)',
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
            schemeName: {
              type: 'string',
              description: 'Name of the scheme to activate',
            },
          },
          required: ['xcodeproj', 'schemeName'],
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
            commandLineArguments: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional command line arguments',
            },
          },
          required: ['xcodeproj'],
        },
      },
      {
        name: 'xcode_run',
        description: 'Run a specific project with the specified scheme',
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
            commandLineArguments: {
              type: 'array',
              items: { type: 'string' },
              description: 'Additional command line arguments',
            },
          },
          required: ['xcodeproj', 'scheme'],
        },
      },
      {
        name: 'xcode_debug',
        description: 'Start debugging session for a specific project',
        inputSchema: {
          type: 'object',
          properties: {
            xcodeproj: {
              type: 'string',
              description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
            },
            scheme: {
              type: 'string',
              description: 'Scheme name (optional)',
            },
            skipBuilding: {
              type: 'boolean',
              description: 'Whether to skip building',
            },
          },
          required: ['xcodeproj'],
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
        name: 'find_xcresults',
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
            filePath: {
              type: 'string',
              description: 'Absolute path to the file to open',
            },
            lineNumber: {
              type: 'number',
              description: 'Optional line number to navigate to',
            },
          },
          required: ['filePath'],
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
        name: 'xcresult_browse',
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
        name: 'xcresult_browser_get_console',
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
        name: 'xcresult_summary',
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
        name: 'xcresult_get_screenshot',
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
        name: 'xcresult_get_ui_hierarchy',
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
        name: 'xcresult_get_ui_element',
        description: 'Get full details of a specific UI element by index from a previously exported UI hierarchy JSON file',
        inputSchema: {
          type: 'object',
          properties: {
            hierarchy_json_path: {
              type: 'string',
              description: 'Absolute path to the UI hierarchy JSON file (the full version saved by xcresult_get_ui_hierarchy)',
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
        name: 'xcresult_list_attachments',
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
        name: 'xcresult_export_attachment',
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
              description: 'Index number of the attachment to export (1-based, from xcresult_list_attachments)',
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
    
    const program = new Command('xcodecontrol')
      .version(pkg.version)
      .description('Command-line interface for Xcode automation and control')
      .option('--json', 'Output results in JSON format', false)
      .option('-v, --verbose', 'Enable verbose output (shows INFO logs)', false)
      .option('-q, --quiet', 'Suppress all logs except errors', false);
    
    // Add global help command
    program
      .command('help')
      .description('Show help information')
      .action(() => {
        program.help();
      });
    
    // Add list-tools command for compatibility
    program
      .command('list-tools')
      .description('List all available tools')
      .action(() => {
        console.log('Available tools:');
        console.log('');
        for (const tool of tools) {
          const commandName = tool.name.replace(/^xcode_/, '').replace(/_/g, '-');
          console.log(`  ${commandName.padEnd(30)} ${tool.description}`);
        }
      });
    
    // Dynamically create subcommands for each tool
    for (const tool of tools) {
      // Convert tool name: remove "xcode_" prefix and replace underscores with dashes
      const commandName = tool.name.replace(/^xcode_/, '').replace(/_/g, '-');
      const cmd = program
        .command(commandName)
        .description(tool.description);
      
      // Add options based on the tool's input schema
      if (tool.inputSchema?.properties) {
        for (const [propName, propSchema] of Object.entries(tool.inputSchema.properties)) {
          const propDef = propSchema as any;
          const option = schemaPropertyToOption(propName, propDef);
          
          if (option.defaultValue !== undefined) {
            cmd.option(option.flags, option.description, option.defaultValue);
          } else {
            cmd.option(option.flags, option.description);
          }
        }
      }
      
      // Handle JSON input option
      cmd.option('--json-input <json>', 'Provide arguments as JSON string');
      
      // Set up the action handler
      cmd.action(async (cliArgs: Record<string, any>) => {
        try {
          // Set log level based on CLI options
          const globalOpts = program.opts();
          if (globalOpts.quiet) {
            process.env.LOG_LEVEL = 'ERROR';
          } else if (globalOpts.verbose) {
            process.env.LOG_LEVEL = 'DEBUG';
          } else {
            process.env.LOG_LEVEL = 'WARN';  // Default: only show warnings and errors
          }
          
          let toolArgs: Record<string, unknown>;
          
          // Parse arguments from JSON input or CLI flags
          if (cliArgs.jsonInput) {
            try {
              toolArgs = JSON.parse(cliArgs.jsonInput);
            } catch (error) {
              console.error('❌ Invalid JSON input:', error);
              process.exit(1);
            }
          } else {
            toolArgs = parseToolArgs(tool, cliArgs);
          }
          
          // Validate required parameters
          if (tool.inputSchema?.required) {
            for (const required of tool.inputSchema.required) {
              if (toolArgs[required] === undefined) {
                console.error(`❌ Missing required parameter: ${required}`);
                process.exit(1);
              }
            }
          }
          
          // Call the tool directly on server
          const result = await server.callToolDirect(tool.name, toolArgs);
          
          // Check if the result indicates an error
          let hasError = false;
          if (result?.content && Array.isArray(result.content)) {
            for (const item of result.content) {
              if (item.type === 'text' && item.text) {
                const text = item.text;
                
                // Special case for health-check: don't treat degraded mode as error
                if (tool.name === 'xcode_health_check') {
                  // Only treat as error if there are critical failures
                  hasError = text.includes('⚠️  CRITICAL ERRORS DETECTED') || 
                            text.includes('❌ OS:') || 
                            text.includes('❌ OSASCRIPT:');
                } else {
                  // Check for common error patterns
                  if (text.includes('❌') || 
                      text.includes('does not exist') ||
                      text.includes('failed') ||
                      text.includes('error') ||
                      text.includes('Error') ||
                      text.includes('missing required parameter') ||
                      text.includes('cannot find') ||
                      text.includes('not found') ||
                      text.includes('invalid') ||
                      text.includes('Invalid')) {
                    hasError = true;
                    break;
                  }
                }
              }
            }
          }
          
          // Output the result
          const output = formatResult(result, program.opts().json);
          if (hasError) {
            console.error(output);
          } else {
            console.log(output);
          }
          
          // Exit with appropriate code
          process.exit(hasError ? 1 : 0);
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ ${tool.name} failed:`, errorMsg);
          process.exit(1);
        }
      });
    }
    
    
    // Parse command line arguments
    await program.parseAsync(process.argv);
    
  } catch (error) {
    Logger.error('CLI initialization failed:', error);
    console.error('❌ Failed to initialize CLI:', error);
    // Re-throw the error so it can be caught by tests
    throw error;
  }
}

// Run the CLI if this file is executed directly
// Don't run if we're in test mode and not executing the CLI directly
if (process.env.NODE_ENV !== 'test' || process.argv[1]?.includes('cli.js')) {
  main().catch((error) => {
    Logger.error('CLI execution failed:', error);
    console.error('❌ CLI execution failed:', error);
    process.exit(1);
  });
}

export { main };