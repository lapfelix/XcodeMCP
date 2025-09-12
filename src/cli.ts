#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { XcodeServer } from './XcodeServer.js';
import { Logger } from './utils/Logger.js';
import { getToolDefinitions } from './shared/toolDefinitions.js';

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
  // Convert underscores to dashes for CLI consistency
  const dashName = name.replace(/_/g, '-');
  const flags = property.type === 'boolean' ? `--${dashName}` : `--${dashName} <value>`;
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
    // Convert underscores to dashes, then to camelCase to match commander.js behavior
    const dashPropName = propName.replace(/_/g, '-');
    const camelPropName = dashPropName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const cliValue = cliArgs[camelPropName];
    
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
    
    // Check for --no-clean argument early to configure both server and tools
    const noCleanArg = process.argv.includes('--no-clean');
    const includeClean = !noCleanArg;
    
    const server = new XcodeServer({ includeClean });
    
    // Get tool definitions from shared source to ensure CLI is always in sync with MCP
    const tools = getToolDefinitions({ includeClean });
    const program = new Command('xcodecontrol')
      .version(pkg.version)
      .description(`Command-line interface for Xcode automation and control

📁 Command Categories:
  • Project Management  - Open/close projects, manage schemes and workspaces
  • Build & Run         - Build, clean, run, and debug your projects  
  • Testing            - Run tests and manage test targets
  • Test Results       - Analyze XCResult files and test artifacts
  • System             - Health checks and diagnostics

⏱️  Command Execution:
  • Commands have built-in timeouts and handle long-running operations
  • Build, test, and run operations can take minutes to hours depending on project size
  • The CLI will wait for completion - do not manually timeout or interrupt

💡 Use 'xcodecontrol list-tools' to see all commands organized by category
💡 Use 'xcodecontrol <command> --help' for detailed help on any command

🚫 Use 'xcodecontrol --no-clean' to disable the clean tool for safety`)
      .option('--json', 'Output results in JSON format', false)
      .option('-v, --verbose', 'Enable verbose output (shows INFO logs)', false)
      .option('-q, --quiet', 'Suppress all logs except errors', false)
      .option('--no-clean', 'Disable the clean tool', false);
    
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
        console.log('Available tools organized by category:');
        console.log('');
        
        // Define command categories
        const buildAndRunCommands = [
          'build', 'build-and-run', 'debug', 'stop', 
          'get-run-destinations'
        ];
        
        // Add clean only if not disabled
        if (includeClean) {
          buildAndRunCommands.splice(1, 0, 'clean'); // Insert clean after build
        }
        
        const categories = {
          'Project Management': [
            'open-project', 'close-project', 'refresh-project', 
            'get-schemes', 'set-active-scheme', 'get-projects', 
            'get-workspace-info', 'open-file'
          ],
          'Build & Run': buildAndRunCommands,
          'Testing': [
            'test', 'get-test-targets'
          ],
          'Test Results Analysis': [
            'find-xcresults', 'xcresult-browse', 'xcresult-summary',
            'xcresult-browser-get-console', 'xcresult-get-screenshot',
            'xcresult-get-ui-hierarchy', 'xcresult-get-ui-element',
            'xcresult-list-attachments', 'xcresult-export-attachment'
          ],
          'System & Diagnostics': [
            'health-check', 'list-tools', 'help'
          ]
        };
        
        // Create a map of command name to tool for quick lookup
        const toolMap = new Map();
        for (const tool of tools) {
          const commandName = tool.name.replace(/^xcode_/, '').replace(/_/g, '-');
          toolMap.set(commandName, tool);
        }
        
        // Add non-tool commands
        toolMap.set('help', { description: 'Show help information' });
        toolMap.set('list-tools', { description: 'List all available tools' });
        
        // Display categorized commands
        for (const [category, commands] of Object.entries(categories)) {
          console.log(`📁 ${category}:`);
          for (const cmdName of commands) {
            const tool = toolMap.get(cmdName);
            if (tool) {
              console.log(`  ${cmdName.padEnd(30)} ${tool.description}`);
            }
          }
          console.log('');
        }
        
        console.log('💡 Usage:');
        console.log('  xcodecontrol <command> --help    Show help for specific command');
        console.log('  xcodecontrol --help              Show general help');
        console.log('');
        console.log('⏱️  Note: Build, test, and run commands can take minutes to hours.');
        console.log('   The CLI handles long operations automatically - do not timeout.');
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
          
          
          // Resolve relative paths for xcodeproj parameter
          if (toolArgs.xcodeproj && typeof toolArgs.xcodeproj === 'string') {
            // Import PathValidator here to avoid circular dependencies
            const { PathValidator } = await import('./utils/PathValidator.js');
            const { resolvedPath, error } = PathValidator.resolveAndValidateProjectPath(toolArgs.xcodeproj, 'xcodeproj');
            
            if (error) {
              const output = formatResult(error, program.opts().json);
              console.error(output);
              process.exit(1);
            }
            
            toolArgs.xcodeproj = resolvedPath;
          }
          
          // Resolve relative paths for file_path parameter (used by xcode_open_file)
          if (toolArgs.file_path && typeof toolArgs.file_path === 'string') {
            const path = await import('path');
            if (!path.default.isAbsolute(toolArgs.file_path)) {
              toolArgs.file_path = path.default.resolve(process.cwd(), toolArgs.file_path);
            }
          }
          
          // Validate required parameters
          if (tool.inputSchema?.required) {
            const missingParams = tool.inputSchema.required.filter((param: string) => toolArgs[param] === undefined);
            if (missingParams.length > 0) {
              console.error(`❌ Missing required parameter${missingParams.length > 1 ? 's' : ''}: ${missingParams.join(', ')}\n`);
              cmd.help();
              return; // cmd.help() calls process.exit(), but adding return for clarity
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
                } else if (tool.name === 'xcode_test') {
                  // Special case for test results: check if tests actually failed
                  if (text.includes('✅ All tests passed!')) {
                    hasError = false;
                  } else {
                    // Look for actual test failures or build errors
                    hasError = text.includes('❌ TEST BUILD FAILED') ||
                              text.includes('❌ TESTS FAILED') ||
                              text.includes('⏹️ TEST BUILD INTERRUPTED') ||
                              (text.includes('Failed:') && !text.includes('Failed: 0'));
                  }
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