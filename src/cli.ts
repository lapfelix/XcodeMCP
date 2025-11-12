#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { XcodeServer } from './XcodeServer.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import Logger from './utils/Logger.js';
import { getToolDefinitions, type ToolDefinition } from './shared/toolDefinitions.js';
import LockManager from './utils/LockManager.js';

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

function getArgValue(flag: string): string | undefined {
  const equalsMatch = process.argv.find(arg => arg.startsWith(`${flag}=`));
  if (equalsMatch) {
    const [, value = ''] = equalsMatch.split('=');
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv.length > index + 1) {
    const next = process.argv[index + 1];
    if (next && !next.startsWith('-')) {
      const trimmed = next.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
  }
  return undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function detectError(toolName: string, result: CallToolResult | undefined): boolean {
  if (!result) return false;
  if (result.isError) return true;

  if (!result.content || !Array.isArray(result.content)) {
    return false;
  }

  for (const item of result.content) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      const text = item.text;

      if (toolName === 'xcode_health_check') {
        if (text.includes('⚠️  CRITICAL ERRORS DETECTED') || text.includes('❌ OS:') || text.includes('❌ OSASCRIPT:')) {
          return true;
        }
        continue;
      }

      if (toolName === 'xcode_test') {
        if (text.includes('✅ All tests passed!')) {
          continue;
        }
        if (
          text.includes('❌ TEST BUILD FAILED') ||
          text.includes('❌ TESTS FAILED') ||
          text.includes('⏹️ TEST BUILD INTERRUPTED') ||
          (/Failed:\s*(?!0)/.test(text) && !text.includes('Failed: 0'))
        ) {
          return true;
        }
        continue;
      }

      if (
        text.includes('❌') ||
        text.includes('does not exist') ||
        text.includes('failed') ||
        text.includes('error') ||
        text.includes('Error') ||
        text.includes('missing required parameter') ||
        text.includes('cannot find') ||
        text.includes('not found') ||
        text.includes('invalid') ||
        text.includes('Invalid')
      ) {
        return true;
      }
    }
  }

  return false;
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
    
    let description = `Command-line interface for Xcode automation and control

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

🚫 Use 'xcodecontrol --no-clean' to disable the clean tool for safety`;
    
    const program = new Command('xcodecontrol')
      .version(pkg.version)
      .description(description)
      .option('--json', 'Output results in JSON format', false)
      .option('-v, --verbose', 'Enable verbose output (shows INFO logs)', false)
      .option('-q, --quiet', 'Suppress all logs except errors', false)
      .option('--no-clean', 'Disable the clean tool', false)
      .option('--preferred-scheme <scheme>', 'Set a preferred scheme to use as default')
      .option('--preferred-xcodeproj <path>', 'Set a preferred xcodeproj/xcworkspace to use as default');

    let includeClean = true;
    let cliPreferredScheme: string | undefined;
    let cliPreferredXcodeproj: string | undefined;

    if (typeof (program as any).parseOptions === 'function') {
      program.parseOptions(process.argv);
      const globalOptions = program.opts();
      includeClean = globalOptions.clean !== false;
      if (typeof globalOptions.preferredScheme === 'string') {
        const trimmed = globalOptions.preferredScheme.trim();
        cliPreferredScheme = trimmed.length > 0 ? trimmed : undefined;
      }
      if (typeof globalOptions.preferredXcodeproj === 'string') {
        const trimmed = globalOptions.preferredXcodeproj.trim();
        cliPreferredXcodeproj = trimmed.length > 0 ? trimmed : undefined;
      }
    } else {
      includeClean = !hasFlag('--no-clean');
      cliPreferredScheme = getArgValue('--preferred-scheme');
      cliPreferredXcodeproj = getArgValue('--preferred-xcodeproj');
    }

    const envPreferredScheme = process.env.XCODE_MCP_PREFERRED_SCHEME?.trim();
    const envPreferredXcodeproj = process.env.XCODE_MCP_PREFERRED_XCODEPROJ?.trim();

    const preferredScheme = cliPreferredScheme || envPreferredScheme;
    const preferredXcodeproj = cliPreferredXcodeproj || envPreferredXcodeproj;

    if (preferredScheme || preferredXcodeproj) {
      description += '\n\n📌 Preferred Values:';
      if (preferredScheme) {
        description += `\n  • Scheme: ${preferredScheme}`;
      }
      if (preferredXcodeproj) {
        description += `\n  • Project: ${preferredXcodeproj}`;
      }
      program.description(description);
    }

    const serverOptions: {
      includeClean: boolean;
      preferredScheme?: string;
      preferredXcodeproj?: string;
    } = { includeClean };

    if (preferredScheme) serverOptions.preferredScheme = preferredScheme;
    if (preferredXcodeproj) serverOptions.preferredXcodeproj = preferredXcodeproj;

    const server = new XcodeServer(serverOptions);

    const toolOptions: {
      includeClean: boolean;
      preferredScheme?: string;
      preferredXcodeproj?: string;
    } = { includeClean };

    if (preferredScheme) toolOptions.preferredScheme = preferredScheme;
    if (preferredXcodeproj) toolOptions.preferredXcodeproj = preferredXcodeproj;

    const tools = getToolDefinitions(toolOptions);
    
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
          'build',
          'build-and-run',
          'release-lock',
          'view-build-log',
          'view-run-log',
          'stop',
          'get-run-destinations',
          'release-all-locks',
        ];
        
        // Add clean only if not disabled
        if (includeClean) {
          buildAndRunCommands.splice(1, 0, 'clean'); // Insert clean after build
        }
        
        const categories = {
          'Project Management': [
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
          const defaultName = tool.name.replace(/^xcode_/, '').replace(/_/g, '-');
          const commandName = tool.cliName ?? defaultName;
          toolMap.set(commandName, tool);
          if (tool.cliAliases) {
            for (const alias of tool.cliAliases) {
              toolMap.set(alias, tool);
            }
          }
          if (!toolMap.has(defaultName)) {
            toolMap.set(defaultName, tool);
          }
        }
        
        // Add non-tool commands
        toolMap.set('help', { description: 'Show help information' });
        toolMap.set('list-tools', { description: 'List all available tools' });
        toolMap.set('release-all-locks', { description: 'CLI-only: Force release every outstanding build/run lock' });
        
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

    program
      .command('release-all-locks')
      .description('Force release every outstanding build/run lock (CLI-only safety valve)')
      .action(async () => {
        const { released, details } = await LockManager.releaseAllLocks();
        if (released === 0) {
          console.log('No active locks detected.');
          return;
        }
        console.log(`Released ${released} lock${released === 1 ? '' : 's'}:`);
        for (const detail of details) {
          const reason = detail.reason ? `reason: "${detail.reason}"` : 'reason: n/a';
          const waiting = Math.max(0, detail.queueDepth - 1);
          const waitingMsg = waiting > 0 ? `, ${waiting} worker${waiting === 1 ? '' : 's'} were waiting` : '';
          console.log(`  • ${detail.path} (${reason}${waitingMsg})`);
        }
      });
    // Dynamically create subcommands for each tool
    for (const tool of tools) {
      if (tool.cliHidden) {
        continue;
      }
      // Convert tool name: remove "xcode_" prefix and replace underscores with dashes
      const commandName = tool.cliName ?? tool.name.replace(/^xcode_/, '').replace(/_/g, '-');
      const cmd = program
        .command(commandName)
        .description(tool.description);
      
      if (tool.cliAliases) {
        for (const alias of tool.cliAliases) {
          cmd.alias(alias);
        }
      }
      
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
              process.exitCode = 1;
              return;
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
              process.exitCode = 1;
              return;
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
          let result = await server.callToolDirect(tool.name, toolArgs);

          // Output the result
          const output = formatResult(result, program.opts().json);
          const hasError = detectError(tool.name, result);
          if (hasError) {
            console.error(output);
          } else {
            console.log(output);
          }
          
          // Exit with appropriate code without forcing an immediate shutdown (allows stdout flush)
          process.exitCode = hasError ? 1 : 0;
          return;
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ ${tool.name} failed:`, errorMsg);
          process.exitCode = 1;
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
    process.exitCode = 1;
  });
}

export { main };
