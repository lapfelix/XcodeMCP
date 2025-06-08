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
import { existsSync } from 'fs';
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

  // Helper function to validate project paths
  validateProjectPath(projectPath) {
    if (!projectPath) {
      return { content: [{ type: 'text', text: 'Project path is required. Please specify the path to your .xcodeproj or .xcworkspace file.' }] };
    }
    
    if (!path.isAbsolute(projectPath)) {
      return { content: [{ type: 'text', text: `Project path must be absolute, got: ${projectPath}\nExample: /Users/username/path/to/project.xcodeproj` }] };
    }
    
    // Check if the project file actually exists
    if (!existsSync(projectPath)) {
      return { content: [{ type: 'text', text: `Project file does not exist: ${projectPath}` }] };
    }
    
    // For .xcodeproj files, also check if project.pbxproj exists inside
    if (projectPath.endsWith('.xcodeproj')) {
      const pbxprojPath = path.join(projectPath, 'project.pbxproj');
      if (!existsSync(pbxprojPath)) {
        return { content: [{ type: 'text', text: `Project is missing project.pbxproj file: ${pbxprojPath}` }] };
      }
    }
    
    // For .xcworkspace files, check if contents.xcworkspacedata exists
    if (projectPath.endsWith('.xcworkspace')) {
      const workspaceDataPath = path.join(projectPath, 'contents.xcworkspacedata');
      if (!existsSync(workspaceDataPath)) {
        return { content: [{ type: 'text', text: `Workspace is missing contents.xcworkspacedata file: ${workspaceDataPath}` }] };
      }
    }

    return null; // No validation errors
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
    const customDerivedDataLocation = await this.getCustomDerivedDataLocationFromXcodePreferences();
    const projectName = path.basename(projectPath, path.extname(projectPath));
    let derivedDataPath = null;
    
    if (!customDerivedDataLocation) {
      derivedDataPath = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
    } else if (customDerivedDataLocation.startsWith('/')) {
      derivedDataPath = customDerivedDataLocation;
    } else {
      const localProjectPath = path.dirname(projectPath);
      derivedDataPath = path.join(localProjectPath, customDerivedDataLocation);
    }

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
  
  async getCustomDerivedDataLocationFromXcodePreferences() {
    return new Promise((resolve) => {
      const defaults = spawn('defaults', ['read', 'com.apple.dt.Xcode', 'IDECustomDerivedDataLocation']);
      let stdout = '';
      let stderr = '';

      defaults.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      defaults.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      defaults.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve(null);
        }
      });

      defaults.on('error', () => {
        resolve(null);
      });
    });
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
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_build',
            description: 'Build a specific Xcode project or workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file to build',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_build_scheme',
            description: 'Build a specific project/workspace with a scheme and destination',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                scheme: {
                  type: 'string',
                  description: 'Name of the scheme to build',
                },
                destination: {
                  type: 'string',
                  description: 'Build destination (optional)',
                },
              },
              required: ['path', 'scheme'],
            },
          },
          {
            name: 'xcode_get_schemes',
            description: 'Get list of available schemes for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_set_active_scheme',
            description: 'Set the active scheme for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                schemeName: {
                  type: 'string',
                  description: 'Name of the scheme to activate',
                },
              },
              required: ['path', 'schemeName'],
            },
          },
          {
            name: 'xcode_clean',
            description: 'Clean the build directory for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_test',
            description: 'Run tests for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                commandLineArguments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional command line arguments',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_run',
            description: 'Run a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                commandLineArguments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional command line arguments',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_debug',
            description: 'Start debugging session for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
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
              required: ['path'],
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
            name: 'xcode_get_run_destinations',
            description: 'Get list of available run destinations for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_get_workspace_info',
            description: 'Get information about a specific workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_get_projects',
            description: 'Get list of projects in a specific workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
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
            return await this.build(args.path);
          case 'xcode_build_scheme':
            return await this.buildScheme(args.path, args.scheme, args.destination);
          case 'xcode_clean':
            return await this.clean(args.path);
          case 'xcode_test':
            return await this.test(args.path, args.commandLineArguments);
          case 'xcode_run':
            return await this.run(args.path, args.commandLineArguments);
          case 'xcode_debug':
            return await this.debug(args.path, args.scheme, args.skipBuilding);
          case 'xcode_stop':
            return await this.stop();
          case 'xcode_get_schemes':
            return await this.getSchemes(args.path);
          case 'xcode_get_run_destinations':
            return await this.getRunDestinations(args.path);
          case 'xcode_set_active_scheme':
            return await this.setActiveScheme(args.path, args.schemeName);
          case 'xcode_get_workspace_info':
            return await this.getWorkspaceInfo(args.path);
          case 'xcode_get_projects':
            return await this.getProjects(args.path);
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
    // Require absolute paths to avoid confusion
    if (!path.isAbsolute(projectPath)) {
      return { content: [{ type: 'text', text: `Project path must be absolute, got: ${projectPath}\nExample: /Users/username/path/to/project.xcodeproj` }] };
    }
    
    // Check if the project file actually exists
    if (!existsSync(projectPath)) {
      return { content: [{ type: 'text', text: `Project file does not exist: ${projectPath}` }] };
    }
    
    // For .xcodeproj files, also check if project.pbxproj exists inside
    if (projectPath.endsWith('.xcodeproj')) {
      const pbxprojPath = path.join(projectPath, 'project.pbxproj');
      if (!existsSync(pbxprojPath)) {
        return { content: [{ type: 'text', text: `Project is missing project.pbxproj file: ${pbxprojPath}` }] };
      }
    }
    
    // For .xcworkspace files, check if contents.xcworkspacedata exists
    if (projectPath.endsWith('.xcworkspace')) {
      const workspaceDataPath = path.join(projectPath, 'contents.xcworkspacedata');
      if (!existsSync(workspaceDataPath)) {
        return { content: [{ type: 'text', text: `Workspace is missing contents.xcworkspacedata file: ${workspaceDataPath}` }] };
      }
    }
    
    const script = `
      const app = Application('Xcode');
      app.open(${JSON.stringify(projectPath)});
      'Project opened successfully';
    `;
    
    const result = await this.executeJXA(script);
    this.currentProjectPath = projectPath; // Store the project path
    return { content: [{ type: 'text', text: result }] };
  }

  async build(projectPath) {
    if (!projectPath) {
      return { content: [{ type: 'text', text: 'Project path is required. Please specify the path to your .xcodeproj or .xcworkspace file.' }] };
    }
    
    // Require absolute paths to avoid confusion
    if (!path.isAbsolute(projectPath)) {
      return { content: [{ type: 'text', text: `Project path must be absolute, got: ${projectPath}\nExample: /Users/username/path/to/project.xcodeproj` }] };
    }
    
    // Check if the project file actually exists
    if (!existsSync(projectPath)) {
      return { content: [{ type: 'text', text: `Project file does not exist: ${projectPath}` }] };
    }
    
    // For .xcodeproj files, also check if project.pbxproj exists inside
    if (projectPath.endsWith('.xcodeproj')) {
      const pbxprojPath = path.join(projectPath, 'project.pbxproj');
      if (!existsSync(pbxprojPath)) {
        return { content: [{ type: 'text', text: `Project is missing project.pbxproj file: ${pbxprojPath}` }] };
      }
    }
    
    // For .xcworkspace files, check if contents.xcworkspacedata exists
    if (projectPath.endsWith('.xcworkspace')) {
      const workspaceDataPath = path.join(projectPath, 'contents.xcworkspacedata');
      if (!existsSync(workspaceDataPath)) {
        return { content: [{ type: 'text', text: `Workspace is missing contents.xcworkspacedata file: ${workspaceDataPath}` }] };
      }
    }
    
    // Build using Apple's recommended approach with actionResult
    const buildScript = `
      (function() {
        const app = Application('Xcode');
        
        // Open the project (this will bring it to front if not already open)
        app.open(${JSON.stringify(projectPath)});
        
        // Find the workspace document for this project
        const docs = app.workspaceDocuments();
        let targetDoc = null;
        
        for (let i = 0; i < docs.length; i++) {
          if (docs[i].path() === ${JSON.stringify(projectPath)}) {
            targetDoc = docs[i];
            break;
          }
        }
        
        if (!targetDoc) {
          throw new Error('Could not find project after opening');
        }
        
        // Build this specific workspace document and get the action result
        const actionResult = targetDoc.build();
        
        // Wait for build to complete using Apple's approach
        while (true) {
          if (actionResult.completed()) {
            break;
          }
          delay(0.5);
        }
        
        return targetDoc.path();
      })()
    `;
    
    let actualProjectPath;
    try {
      actualProjectPath = await this.executeJXA(buildScript);
    } catch (error) {
      return { content: [{ type: 'text', text: `Failed to build project: ${error.message}` }] };
    }

    // Build completed! Now get the final build log
    console.error('Build completed, getting final log...');
    
    // Wait a moment for log to be finalized and then get it
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const newLog = await this.getLatestBuildLog(actualProjectPath);
    if (!newLog) {
      return { content: [{ type: 'text', text: 'Build completed but no build log found' }] };
    }
    
    console.error(`Parsing build log: ${newLog.path}`);

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

  async buildScheme(projectPath, schemeName, destination = null) {
    // Validate project path
    if (!projectPath) {
      return { content: [{ type: 'text', text: 'Project path is required. Please specify the path to your .xcodeproj or .xcworkspace file.' }] };
    }
    
    if (!path.isAbsolute(projectPath)) {
      return { content: [{ type: 'text', text: `Project path must be absolute, got: ${projectPath}\nExample: /Users/username/path/to/project.xcodeproj` }] };
    }
    
    // Check if the project file actually exists
    if (!existsSync(projectPath)) {
      return { content: [{ type: 'text', text: `Project file does not exist: ${projectPath}` }] };
    }
    
    // For .xcodeproj files, also check if project.pbxproj exists inside
    if (projectPath.endsWith('.xcodeproj')) {
      const pbxprojPath = path.join(projectPath, 'project.pbxproj');
      if (!existsSync(pbxprojPath)) {
        return { content: [{ type: 'text', text: `Project is missing project.pbxproj file: ${pbxprojPath}` }] };
      }
    }
    
    // For .xcworkspace files, check if contents.xcworkspacedata exists
    if (projectPath.endsWith('.xcworkspace')) {
      const workspaceDataPath = path.join(projectPath, 'contents.xcworkspacedata');
      if (!existsSync(workspaceDataPath)) {
        return { content: [{ type: 'text', text: `Workspace is missing contents.xcworkspacedata file: ${workspaceDataPath}` }] };
      }
    }

    // Stop any existing builds first
    try {
      await this.stop();
    } catch (error) {
      // Ignore errors if nothing was running
    }
    
    // Open the project first
    await this.openProject(projectPath);

    // Set the active scheme first
    const setSchemeScript = `
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
        return 'Scheme set to ' + ${JSON.stringify(schemeName)};
      })()
    `;
    
    try {
      await this.executeJXA(setSchemeScript);
    } catch (error) {
      return { content: [{ type: 'text', text: `Failed to set scheme '${schemeName}': ${error.message}` }] };
    }

    // Set destination if provided
    if (destination) {
      const setDestinationScript = `
        (function() {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) throw new Error('No active workspace');
          
          const destinations = workspace.runDestinations();
          const targetDestination = destinations.find(dest => dest.name() === ${JSON.stringify(destination)});
          
          if (!targetDestination) {
            throw new Error('Destination ' + ${JSON.stringify(destination)} + ' not found');
          }
          
          workspace.activeRunDestination = targetDestination;
          return 'Destination set to ' + ${JSON.stringify(destination)};
        })()
      `;
      
      try {
        await this.executeJXA(setDestinationScript);
      } catch (error) {
        return { content: [{ type: 'text', text: `Failed to set destination '${destination}': ${error.message}` }] };
      }
    }


    // Trigger build using JXA - just start the build
    const buildScript = `
      (function() {
        const app = Application('Xcode');
        const docs = app.workspaceDocuments();
        if (docs.length === 0) throw new Error('No workspace document open');
        
        const workspace = docs[0];
        
        // Start the build
        workspace.build();
        
        return 'Build started for scheme ${schemeName}';
      })()
    `;
    
    // Record the time when we started the build
    const buildStartTime = Date.now();
    
    await this.executeJXA(buildScript);

    // Wait for a NEW build log that was created AFTER we started the build
    console.error(`Waiting for new build log to appear after build start...`);
    
    let attempts = 0;
    let newLog = null;
    const initialWaitAttempts = 180; // Wait up to 3 minutes for a new log to appear

    // First, wait for a new log file to appear
    while (attempts < initialWaitAttempts) {
      const currentLog = await this.getLatestBuildLog(projectPath);
      
      if (currentLog) {
        const logTime = currentLog.mtime.getTime();
        const buildTime = buildStartTime;
        console.error(`Checking log: ${currentLog.path}, log time: ${logTime}, build time: ${buildTime}, diff: ${logTime - buildTime}ms`);
        
        if (logTime > buildTime) {
          newLog = currentLog;
          console.error(`Found new build log created after build start: ${newLog.path}`);
          break;
        }
      } else {
        console.error(`No build log found yet, attempt ${attempts + 1}/${initialWaitAttempts}`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: `Build started for scheme '${schemeName}' but no new build log appeared within ${initialWaitAttempts} seconds` }] };
    }

    // Now wait for this specific build to complete
    console.error(`Monitoring build completion for log: ${newLog.path}`);
    
    attempts = 0;
    const maxAttempts = 1200; // 20 minutes with 1 second intervals
    let lastLogSize = 0;
    let stableCount = 0;

    while (attempts < maxAttempts) {
      try {
        const logStats = await stat(newLog.path);
        const currentLogSize = logStats.size;
        
        // Check if log file has stopped growing
        if (currentLogSize === lastLogSize) {
          stableCount++;
          // Wait for log to be stable for 5 seconds and parseable
          if (stableCount >= 5) {
            const canParse = await this.canParseLog(newLog.path);
            if (canParse) {
              console.error(`Build completed, log is ready: ${newLog.path}`);
              break;
            }
          }
        } else {
          // Log is still growing
          lastLogSize = currentLogSize;
          stableCount = 0;
        }
      } catch (error) {
        // If we can't stat the file, it might have been moved or deleted
        // Try to get the latest log again
        const currentLog = await this.getLatestBuildLog(projectPath);
        if (currentLog && currentLog.path !== newLog.path && currentLog.mtime.getTime() > buildStartTime) {
          console.error(`Build log changed to: ${currentLog.path}`);
          newLog = currentLog;
          lastLogSize = 0;
          stableCount = 0;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!newLog) {
      return { content: [{ type: 'text', text: `Build started for scheme '${schemeName}' but no build log found after ${maxAttempts} seconds` }] };
    }
    
    if (attempts >= maxAttempts) {
      return { content: [{ type: 'text', text: `Build for scheme '${schemeName}' timed out after ${maxAttempts} seconds` }] };
    }

    // Parse build results
    const results = await this.parseBuildLog(newLog.path);
    
    let message = '';
    const schemeInfo = destination ? `scheme '${schemeName}' for destination '${destination}'` : `scheme '${schemeName}'`;
    
    if (results.errors.length > 0) {
      message = `❌ BUILD FAILED for ${schemeInfo} (${results.errors.length} errors)\n\nERRORS:\n`;
      results.errors.forEach(error => {
        message += `  • ${error}\n`;
      });
      // Throw MCP error for build failures
      throw new McpError(
        ErrorCode.InternalError,
        message
      );
    } else if (results.warnings.length > 0) {
      message = `⚠️ BUILD COMPLETED WITH WARNINGS for ${schemeInfo} (${results.warnings.length} warnings)\n\nWARNINGS:\n`;
      results.warnings.forEach(warning => {
        message += `  • ${warning}\n`;
      });
    } else {
      message = `✅ BUILD SUCCESSFUL for ${schemeInfo}`;
    }

    return { content: [{ type: 'text', text: message }] };
  }

  async clean(projectPath) {
    // Validate project path
    const validationError = this.validateProjectPath(projectPath);
    if (validationError) return validationError;

    // Open the project first
    await this.openProject(projectPath);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        // Start the clean and get the action result
        const actionResult = workspace.clean();
        
        // Wait for clean to complete using Apple's approach
        while (true) {
          if (actionResult.completed()) {
            break;
          }
          delay(0.5);
        }
        
        return \`Clean completed. Result ID: \${actionResult.id()}\`;
      })()
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async test(projectPath, commandLineArguments = []) {
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

  async run(projectPath, commandLineArguments = []) {

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

  async debug(projectPath, scheme, skipBuilding = false) {
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
    // Require absolute paths to avoid confusion
    if (!path.isAbsolute(filePath)) {
      return { content: [{ type: 'text', text: `File path must be absolute, got: ${filePath}\nExample: /Users/username/path/to/file.swift` }] };
    }
    
    // Check if the file actually exists
    if (!existsSync(filePath)) {
      return { content: [{ type: 'text', text: `File does not exist: ${filePath}` }] };
    }
    
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
if (process.env.NODE_ENV !== 'test') {
  const server = new XcodeMCPServer();
  server.start().catch(console.error);
}