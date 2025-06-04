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
      const workspace = app.activeWorkspaceDocument();
      if (!workspace) throw new Error('No active workspace');
      
      workspace.build();
      'Build started';
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

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new XcodeMCPServer();
  server.start().catch(console.error);
}