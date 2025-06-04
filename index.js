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

  async openProject(path) {
    const script = `
      const app = Application('Xcode');
      app.open(${JSON.stringify(path)});
      'Project opened successfully';
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
  }

  async build() {
    const script = `
      const app = Application('Xcode');
      const docs = app.workspaceDocuments();
      if (docs.length === 0) throw new Error('No workspace document open');
      
      const workspace = docs[0];
      const actionResult = workspace.build();
      
      // Track progress every 0.5 seconds  
      while (true) {
        try {
          if (actionResult.completed()) break;
        } catch (e) {
          // If we can't check completion, assume it's done
          break;
        }
        delay(0.5);
      }
      
      'Build process completed';
    `;
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
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
    
    const result = await this.executeJXA(script);
    return { content: [{ type: 'text', text: result }] };
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

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new XcodeMCPServer();
  server.start().catch(console.error);
}