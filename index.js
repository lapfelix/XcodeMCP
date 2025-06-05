#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import { readdir, stat } from 'fs/promises';
import path from 'path';
import os from 'os';

class XcodeMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'xcode-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.currentProjectPath = null;
    this.setupToolHandlers();
  }

  // Execute JXA (JavaScript for Automation) code
  async executeJXA(script) {
    return new Promise((resolve, reject) => {
      const osascript = spawn('osascript', ['-l', 'JavaScript', '-e', script]);
      let stdout = '';
      let stderr = '';

      osascript.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      osascript.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      osascript.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`JXA execution failed: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  async findProjectDerivedData(projectPath) {
    const projectName = path.basename(projectPath, path.extname(projectPath));
    const derivedDataPath = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
    
    try {
      const dirs = await readdir(derivedDataPath);
      const matches = dirs.filter(dir => dir.startsWith(`${projectName}-`));
      
      if (matches.length === 0) return null;
      
      // Find the most recently modified directory
      let latestDir = null;
      let latestTime = 0;
      
      for (const match of matches) {
        const fullPath = path.join(derivedDataPath, match);
        const stats = await stat(fullPath);
        if (stats.mtime.getTime() > latestTime) {
          latestTime = stats.mtime.getTime();
          latestDir = fullPath;
        }
      }
      
      return latestDir;
    } catch (error) {
      return null;
    }
  }

  async getLatestBuildLog(projectPath) {
    const derivedData = await this.findProjectDerivedData(projectPath);
    if (!derivedData) return null;
    
    const logsDir = path.join(derivedData, 'Logs', 'Build');
    
    try {
      const files = await readdir(logsDir);
      const logFiles = files.filter(file => file.endsWith('.xcactivitylog'));
      
      if (logFiles.length === 0) return null;
      
      // Find the most recently modified log file
      let latestLog = null;
      let latestTime = 0;
      
      for (const logFile of logFiles) {
        const fullPath = path.join(logsDir, logFile);
        const stats = await stat(fullPath);
        if (stats.mtime.getTime() > latestTime) {
          latestTime = stats.mtime.getTime();
          latestLog = { path: fullPath, mtime: stats.mtime };
        }
      }
      
      return latestLog;
    } catch (error) {
      return null;
    }
  }

  async parseBuildLog(logPath, retryCount = 0, maxRetries = 6) {
    const delays = [1000, 2000, 3000, 5000, 8000, 13000]; // Fibonacci-like progression in ms
    return new Promise((resolve) => {
      // Use xclogparser to properly parse Apple's binary xcactivitylog format
      const command = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
      let stdout = '';
      let stderr = '';
      
      command.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      command.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      command.on('close', (code) => {
        if (code !== 0) {
          const errorMessage = stderr.trim() || 'No error details available';
          
          // Check if this is a log file parsing error and we can retry
          if ((errorMessage.includes('not a valid SLF log') || 
               errorMessage.includes('not a valid xcactivitylog file') ||
               errorMessage.includes('corrupted') || 
               errorMessage.includes('incomplete')) 
              && retryCount < maxRetries) {
            console.error(`XCLogParser failed (attempt ${retryCount + 1}/${maxRetries + 1}): ${errorMessage}`);
            console.error(`Retrying in ${delays[retryCount]}ms...`);
            
            setTimeout(async () => {
              const result = await this.parseBuildLog(logPath, retryCount + 1, maxRetries);
              resolve(result);
            }, delays[retryCount]);
            return;
          }
          
          console.error('xclogparser failed:', stderr);
          resolve({
            errors: [
              'XCLogParser failed to parse the build log.',
              '',
              'This may indicate:',
              '• The log file is corrupted or incomplete',
              '• An unsupported Xcode version was used',
              '• XCLogParser needs to be updated',
              '',
              `Error details: ${errorMessage}`
            ],
            warnings: [], 
            notes: []
          });
          return;
        }
        
        try {
          const result = JSON.parse(stdout);
          
          // Convert xclogparser format to our format
          const errors = (result.errors || []).map(error => {
            const fileName = error.documentURL ? error.documentURL.replace('file://', '') : 'Unknown file';
            return `${fileName}: ${error.title}`;
          });
          
          const warnings = (result.warnings || []).map(warning => {
            const fileName = warning.documentURL ? warning.documentURL.replace('file://', '') : 'Unknown file';
            return `${fileName}: ${warning.title}`;
          });
          
          resolve({
            errors,
            warnings,
            notes: [] // xclogparser issues reporter doesn't include notes
          });
        } catch (parseError) {
          console.error('Failed to parse xclogparser output:', parseError);
          resolve({
            errors: [
              'Failed to parse XCLogParser JSON output.',
              '',
              'This may indicate:',
              '• XCLogParser returned unexpected output format',
              '• The build log contains unusual data',
              '• XCLogParser version incompatibility',
              '',
              `Parse error: ${parseError.message}`
            ],
            warnings: [], 
            notes: []
          });
        }
      });
      
      command.on('error', (err) => {
        console.error('Failed to run xclogparser:', err);
        resolve({
          errors: [
            'XCLogParser is required to parse Xcode build logs but is not installed.',
            '',
            'Please install XCLogParser using one of these methods:',
            '• Homebrew: brew install xclogparser',
            '• From source: https://github.com/MobileNativeFoundation/XCLogParser',
            '',
            'XCLogParser is a professional tool for parsing Xcode\'s binary log format.'
          ],
          warnings: [], 
          notes: []
        });
      });
    });
  }

  async canParseLog(logPath) {
    return new Promise((resolve) => {
      // Test if xclogparser can parse the log without retries
      const command = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
      let hasOutput = false;
      
      command.stdout.on('data', () => {
        hasOutput = true;
      });
      
      command.on('close', (code) => {
        // If it succeeds and produces output, the log is ready
        resolve(code === 0 && hasOutput);
      });
      
      command.on('error', () => {
        resolve(false);
      });
      
      // Set a timeout to avoid hanging
      setTimeout(() => {
        command.kill();
        resolve(false);
      }, 5000);
    });
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'xcode_open_project',
            description: 'Open an Xcode project or workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_build',
            description: 'Build the active workspace using the current scheme',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_get_schemes',
            description: 'Get list of available schemes',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_set_active_scheme',
            description: 'Set the active scheme',
            inputSchema: {
              type: 'object',
              properties: {
                schemeName: {
                  type: 'string',
                  description: 'Name of the scheme to activate',
                },
              },
              required: ['schemeName'],
            },
          },
          {
            name: 'xcode_clean',
            description: 'Clean the active workspace',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_test',
            description: 'Run tests for the active workspace',
            inputSchema: {
              type: 'object',
              properties: {
                commandLineArguments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional command line arguments',
                },
              },
            },
          },
          {
            name: 'xcode_run',
            description: 'Run the active scheme',
            inputSchema: {
              type: 'object',
              properties: {
                commandLineArguments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional command line arguments',
                },
              },
            },
          },
          {
            name: 'xcode_debug',
            description: 'Start debugging session',
            inputSchema: {
              type: 'object',
              properties: {
                scheme: {
                  type: 'string',
                  description: 'Scheme name (optional)',
                },
                skipBuilding: {
                  type: 'boolean',
                  description: 'Whether to skip building',
                },
              },
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
            name: 'xcode_get_schemes',
            description: 'Get list of available schemes',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_get_run_destinations',
            description: 'Get list of available run destinations',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_set_active_scheme',
            description: 'Set the active scheme',
            inputSchema: {
              type: 'object',
              properties: {
                schemeName: {
                  type: 'string',
                  description: 'Name of the scheme to activate',
                },
              },
              required: ['schemeName'],
            },
          },
          {
            name: 'xcode_get_workspace_info',
            description: 'Get information about the active workspace',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_get_projects',
            description: 'Get list of projects in the workspace',
            inputSchema: {
              type: 'object',
              properties: {},
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
                  description: 'Path to the file to open',
                },
                lineNumber: {
                  type: 'number',
                  description: 'Optional line number to navigate to',
                },
              },
              required: ['filePath'],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'xcode_open_project':
            return await this.openProject(args.path);
          case 'xcode_build':
            return await this.build();
          case 'xcode_clean':
            return await this.clean();
          case 'xcode_test':
            return await this.test(args.commandLineArguments);
          case 'xcode_run':
            return await this.run(args.commandLineArguments);
          case 'xcode_debug':
            return await this.debug(args.scheme, args.skipBuilding);
          case 'xcode_stop':
            return await this.stop();
          case 'xcode_get_schemes':
            return await this.getSchemes();
          case 'xcode_get_run_destinations':
            return await this.getRunDestinations();
          case 'xcode_set_active_scheme':
            return await this.setActiveScheme(args.schemeName);
          case 'xcode_get_workspace_info':
            return await this.getWorkspaceInfo();
          case 'xcode_get_projects':
            return await this.getProjects();
          case 'xcode_open_file':
            return await this.openFile(args.filePath, args.lineNumber);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error.message}`
        );
      }
    });
  }

  async openProject(projectPath) {
    const script = `
      const app = Application('Xcode');
      app.open(${JSON.stringify(projectPath)});
      'Project opened successfully';
    `;
    
    const result = await this.executeJXA(script);
    this.currentProjectPath = projectPath; // Store the project path
    return { content: [{ type: 'text', text: result }] };
  }

  async build() {
    // Get project path from open workspace in Xcode
    const getProjectScript = `
      const app = Application('Xcode');
      const docs = app.workspaceDocuments();
      if (docs.length === 0) throw new Error('No workspace document open');
      
      docs[0].path();
    `;
    
    let projectPath;
    try {
      projectPath = await this.executeJXA(getProjectScript);
    } catch (error) {
      return { content: [{ type: 'text', text: 'No project opened. Please open a project first.' }] };
    }

    // Get initial build log to compare timestamps
    const initialLog = await this.getLatestBuildLog(projectPath);
    const initialTime = Date.now();

    // Trigger build using JXA
    const script = `
      const app = Application('Xcode');
      const docs = app.workspaceDocuments();
      if (docs.length === 0) throw new Error('No workspace document open');
      
      const workspace = docs[0];
      workspace.build();
      'Build triggered';
    `;
    
    await this.executeJXA(script);

    // Wait for new build log to appear or existing one to be modified
    let newLog = null;
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds

    while (attempts < maxAttempts) {
      newLog = await this.getLatestBuildLog(projectPath);
      
      if (newLog && (!initialLog || newLog.path !== initialLog.path || 
                     newLog.mtime.getTime() > initialTime)) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: 'Build triggered but no build log found' }] };
    }

    // Wait for build to complete by checking if we can parse the latest log
    let lastLogPath = newLog.path;
    attempts = 0;
    const buildMaxAttempts = 600; // 5 minutes

    while (attempts < buildMaxAttempts) {
      const currentLog = await this.getLatestBuildLog(projectPath);
      if (currentLog) {
        // Check if a newer log file appeared (Xcode sometimes creates multiple logs)
        if (currentLog.path !== lastLogPath) {
          console.error(`Newer build log detected: ${currentLog.path}`);
          newLog = currentLog;
          lastLogPath = currentLog.path;
        }
        
        // Test if xclogparser can parse the current log file
        const canParse = await this.canParseLog(currentLog.path);
        if (canParse) {
          console.error(`Build log is ready for parsing: ${currentLog.path}`);
          newLog = currentLog;
          break;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    // Parse build results
    const results = await this.parseBuildLog(newLog.path);
    
    let message = '';
    if (results.errors.length > 0) {
      message = `❌ BUILD FAILED (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
      });
      // Throw MCP error for build failures
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message = `⚠️ BUILD COMPLETED WITH WARNINGS (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
      });
    } else {
      message = '✅ BUILD SUCCESSFUL';
    }

    return { content: [{ type: 'text', text: message }] };
  }

  async clean() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const result = workspace.clean();
        return \`Clean started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async test(commandLineArguments = []) {
    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const result = workspace.test({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const result = workspace.test();`
        }
        return \`Test started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async run(commandLineArguments = []) {
    // Get project path from open workspace in Xcode
    const getProjectScript = `
      const app = Application('Xcode');
      const docs = app.workspaceDocuments();
      if (docs.length === 0) throw new Error('No workspace document open');
      
      docs[0].path();
    `;
    
    let projectPath;
    try {
      projectPath = await this.executeJXA(getProjectScript);
    } catch (error) {
      return { content: [{ type: 'text', text: 'No project opened. Please open a project first.' }] };
    }

    // Get initial build log to compare timestamps
    const initialLog = await this.getLatestBuildLog(projectPath);
    const initialTime = Date.now();

    const hasArgs = commandLineArguments && commandLineArguments.length > 0;
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasArgs 
          ? `const result = workspace.run({withCommandLineArguments: ${JSON.stringify(commandLineArguments)}});`
          : `const result = workspace.run();`
        }
        return \`Run started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const runResult = await this.executeJXA(script);

    // Wait for new build log to appear or existing one to be modified
    let newLog = null;
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds

    while (attempts < maxAttempts) {
      newLog = await this.getLatestBuildLog(projectPath);
      
      if (newLog && (!initialLog || newLog.path !== initialLog.path || 
                     newLog.mtime.getTime() > initialTime)) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: `${runResult}\n\nNote: Run triggered but no build log found (app may have launched without building)` }] };
    }

    // Wait for build to complete by monitoring log file stability
    let lastModified = 0;
    let stableCount = 0;
    attempts = 0;
    const buildMaxAttempts = 600; // 5 minutes

    while (attempts < buildMaxAttempts) {
      const currentLog = await this.getLatestBuildLog(projectPath);
      if (currentLog) {
        const currentModified = currentLog.mtime.getTime();
        if (currentModified === lastModified) {
          stableCount++;
          if (stableCount >= 6) { // File hasn't changed for 3 seconds
            break;
          }
        } else {
          lastModified = currentModified;
          stableCount = 0;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    // Parse build results
    const results = await this.parseBuildLog(newLog.path);
    
    let message = `${runResult}\n\n`;
    if (results.errors.length > 0) {
      message += `❌ BUILD FAILED (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
      });
      // Throw MCP error for build failures during run
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message += `⚠️ BUILD COMPLETED WITH WARNINGS (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
      });
    } else {
      message += '✅ BUILD SUCCESSFUL - App should be launching';
    }

    return { content: [{ type: 'text', text: message }] };
  }

  async debug(scheme, skipBuilding = false) {
    const hasParams = scheme || skipBuilding;
    let paramsObj = {};
    if (scheme) paramsObj.scheme = scheme;
    if (skipBuilding) paramsObj.skipBuilding = skipBuilding;
    
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        ${hasParams 
          ? `const result = workspace.debug(${JSON.stringify(paramsObj)});`
          : `const result = workspace.debug();`
        }
        return \`Debug started. Result ID: \${result.id()}\`;
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async stop() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        workspace.stop();
        return 'Stop command sent';
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async getSchemes() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const activeScheme = workspace.activeScheme();
        
        const schemeInfo = schemes.map(scheme => ({
          name: scheme.name(),
          id: scheme.id(),
          isActive: activeScheme && scheme.id() === activeScheme.id()
        }));
        
        return JSON.stringify(schemeInfo, null, 2);
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async getRunDestinations() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const destinations = workspace.runDestinations();
        const activeDestination = workspace.activeRunDestination();
        
        const destInfo = destinations.map(dest => ({
          name: dest.name(),
          platform: dest.platform(),
          architecture: dest.architecture(),
          isActive: activeDestination && dest.name() === activeDestination.name()
        }));
        
        return JSON.stringify(destInfo, null, 2);
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async setActiveScheme(schemeName) {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
        
        if (!targetScheme) {
          throw new Error('Scheme ' + ${JSON.stringify(schemeName)} + ' not found');
        }
        
        workspace.activeScheme = targetScheme;
        return 'Active scheme set to: ' + ${JSON.stringify(schemeName)};
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async getWorkspaceInfo() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const info = {
          name: workspace.name(),
          path: workspace.path(),
          loaded: workspace.loaded(),
          activeScheme: workspace.activeScheme() ? workspace.activeScheme().name() : null,
          activeRunDestination: workspace.activeRunDestination() ? workspace.activeRunDestination().name() : null
        };
        
        return JSON.stringify(info, null, 2);
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async getProjects() {
    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const projects = workspace.projects();
        const projectInfo = projects.map(project => ({
          name: project.name(),
          id: project.id()
        }));
        
        return JSON.stringify(projectInfo, null, 2);
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async openFile(filePath, lineNumber) {
    const script = `
      (function() {
        const app = Application('Xcode');
        app.open(${JSON.stringify(filePath)});
        
        ${lineNumber ? `
        // Navigate to specific line if provided
        const docs = app.sourceDocuments();
        const doc = docs.find(d => d.path().includes(${JSON.stringify(filePath.split('/').pop())}));
        if (doc) {
          // Use the hack command to navigate to line
          app.hack({document: doc, start: ${lineNumber}, stop: ${lineNumber}});
        }` : ''}
        
        return 'File opened successfully';
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Xcode MCP server running on stdio');
  }
}

// Export the class for testing
export { XcodeMCPServer };

// Start the server when this file is executed directly
const server = new XcodeMCPServer();
server.start().catch(console.error);