#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { callTool, getTools } from './mcp/index.js';
import { Logger } from './utils/Logger.js';
import type { ToolDefinition, SseEvent } from './mcp/index.js';

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

/**
 * Handle SSE events by writing to stderr
 */
function handleSseEvent(event: SseEvent): void {
  const eventData = `event:${event.type}\ndata:${JSON.stringify(event.data)}\n\n`;
  process.stderr.write(eventData);
}

/**
 * Main CLI function
 */
async function main(): Promise<void> {
  try {
    const pkg = await loadPackageJson();
    const tools = await getTools();
    
    const program = new Command('mcp')
      .version(pkg.version)
      .description('MCP one-shot CLI for Xcode tools')
      .option('--json', 'Output results in JSON format', false);
    
    // Add global help command
    program
      .command('help')
      .description('Show help information')
      .action(() => {
        program.help();
      });
    
    // Dynamically create subcommands for each tool
    for (const tool of tools) {
      const cmd = program
        .command(tool.name.replace(/_/g, '-'))
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
          
          // Call the tool
          const result = await callTool(tool.name, toolArgs, {
            onEvent: handleSseEvent
          });
          
          // Check if the result indicates an error
          let hasError = false;
          if (result?.content && Array.isArray(result.content)) {
            for (const item of result.content) {
              if (item.type === 'text' && item.text) {
                const text = item.text;
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
          
          // Output the result
          const output = formatResult(result, program.opts().json);
          console.log(output);
          
          // Exit with appropriate code
          process.exit(hasError ? 1 : 0);
          
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.error(`❌ ${tool.name} failed:`, errorMsg);
          process.exit(1);
        }
      });
    }
    
    // Add a special command to list all available tools
    program
      .command('list-tools')
      .description('List all available tools')
      .action(() => {
        console.log('Available tools:');
        for (const tool of tools) {
          console.log(`  ${tool.name.replace(/_/g, '-')} - ${tool.description}`);
        }
      });
    
    // Parse command line arguments
    await program.parseAsync(process.argv);
    
  } catch (error) {
    Logger.error('CLI initialization failed:', error);
    console.error('❌ Failed to initialize CLI:', error);
    process.exit(1);
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