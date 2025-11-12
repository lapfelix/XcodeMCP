#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer } from 'http';
import { XcodeServer } from './XcodeServer.js';
import Logger from './utils/Logger.js';
import type { EnvironmentValidation } from './types/index.js';

const ALLOWED_EXACT_ARGS = new Set(['--no-clean']);
const ALLOWED_PREFIX_ARGS = ['--preferred-scheme=', '--preferred-xcodeproj=', '--port='];

export function findUnsupportedServerArgs(args: string[]): string[] {
  return args.filter((arg) => {
    if (ALLOWED_EXACT_ARGS.has(arg)) {
      return false;
    }
    return !ALLOWED_PREFIX_ARGS.some((prefix) => arg.startsWith(prefix));
  });
}

// Handle uncaught exceptions and unhandled promise rejections 
process.on('uncaughtException', (error) => {
  Logger.error('🚨 UNCAUGHT EXCEPTION - This may indicate a bug that needs fixing:', error);
  Logger.error('Stack trace:', error.stack);
  // Log to stderr as well for visibility
  console.error('🚨 XcodeMCP: Uncaught exception detected:', error.message);
  // Don't exit immediately - log and continue for MCP server stability
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('🚨 UNHANDLED PROMISE REJECTION - This may indicate a bug that needs fixing:', reason);
  Logger.error('Promise:', promise);
  // Log to stderr as well for visibility
  console.error('🚨 XcodeMCP: Unhandled promise rejection:', reason);
  // Don't exit - log and continue
});

process.on('SIGTERM', () => {
  Logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  Logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

export class XcodeMCPServer extends XcodeServer {
  constructor(options: { 
    includeClean?: boolean;
    preferredScheme?: string;
    preferredXcodeproj?: string;
  } = {}) {
    super(options);
  }

  public async start(port?: number): Promise<void> {
    try {
      // Initialize logging system
      Logger.info('Starting server and validating environment...');
      Logger.debug('Log level set to:', Logger.getLogLevel());
      
      const validation: EnvironmentValidation = await this.validateEnvironment();
      
      if (!validation.overall.valid) {
        if (validation.overall.canOperateInDegradedMode) {
          Logger.warn('Starting in degraded mode due to configuration issues');
          Logger.warn('Some features may be unavailable');
          Logger.info('Run the "xcode_health_check" tool for detailed diagnostics');
        } else {
          Logger.error('Critical configuration issues detected');
          Logger.error('Server may not function properly');
          Logger.error('Please run the "xcode_health_check" tool to resolve issues');
        }
      } else {
        Logger.info('Environment validation passed - all systems operational');
      }

      if (port) {
        // Store active SSE transports by session ID
        const sseTransports = new Map<string, SSEServerTransport>();
        
        // Create HTTP server for SSE transport
        const httpServer = createServer(async (req, res) => {
          const url = new URL(req.url!, `http://localhost:${port}`);
          
          if (req.method === 'GET' && url.pathname === '/sse') {
            // Handle SSE connection
            const transport = new SSEServerTransport('/message', res);
            await this.server.connect(transport);
            
            // Store the transport by session ID
            sseTransports.set(transport.sessionId, transport);
            Logger.info(`SSE connection established with session ID: ${transport.sessionId}`);
            
            // Clean up when connection closes
            transport.onclose = () => {
              sseTransports.delete(transport.sessionId);
              Logger.info(`SSE connection closed for session: ${transport.sessionId}`);
            };
            
          } else if (req.method === 'POST' && url.pathname === '/message') {
            // Handle POST messages - route to the correct transport
            const sessionId = url.searchParams.get('sessionId');
            
            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing sessionId parameter');
              return;
            }
            
            const transport = sseTransports.get(sessionId);
            if (!transport) {
              res.writeHead(404, { 'Content-Type': 'text/plain' });
              res.end('Session not found. Please establish SSE connection first.');
              return;
            }
            
            try {
              await transport.handlePostMessage(req, res);
            } catch (error) {
              Logger.error('Error handling POST message:', error);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Internal server error');
              }
            }
            
          } else if (req.method === 'GET' && url.pathname === '/') {
            // MCP Server Discovery - provide server capabilities and endpoints
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
                logging: {}
              },
              serverInfo: {
                name: 'xcode-mcp-server',
                version: '1.7.4'
              },
              transport: {
                type: 'sse',
                endpoints: {
                  sse: '/sse',
                  message: '/message'
                }
              },
              status: 'running',
              activeSessions: sseTransports.size
            }));
          } else if (req.method === 'GET' && url.pathname === '/.well-known/mcp') {
            // MCP Discovery endpoint
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: 'xcode-mcp-server',
                version: '1.7.4'
              },
              capabilities: {
                tools: {},
                logging: {}
              },
              transport: {
                type: 'sse',
                sseEndpoint: '/sse',
                messageEndpoint: '/message'
              }
            }));
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
          }
        });

        httpServer.listen(port, () => {
          Logger.info(`Server started successfully on port ${port} with SSE transport`);
          Logger.info(`SSE endpoint: http://localhost:${port}/sse`);
          Logger.info(`Status page: http://localhost:${port}/`);
        });
      } else {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.info('Server started successfully on stdio');
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('Failed to start server:', errorMessage);
      Logger.warn('Attempting to start in minimal mode...');
      
      try {
        // Attempt to start in minimal mode without validation
        if (port) {
          Logger.warn('Minimal mode does not support HTTP/SSE - falling back to stdio');
        }
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.warn('Server started in minimal mode (validation failed)');
        Logger.info('Use "xcode_health_check" tool to diagnose startup issues');
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        Logger.error('Critical failure - unable to start server:', fallbackErrorMessage);
        await Logger.flush();
        process.exit(1);
      }
    }
  }
}

// Only run if not in test environment
if (process.env.NODE_ENV !== 'test') {
  const unsupportedArgs = findUnsupportedServerArgs(process.argv.slice(2));
  if (unsupportedArgs.length > 0) {
    const formattedArgs = unsupportedArgs.join(', ');
    Logger.error('Unsupported arguments provided to xcodemcp CLI:', formattedArgs);
    Logger.error('The xcodemcp binary only starts the MCP server and does not run tools directly.');
    console.error('❌ xcodemcp only launches the MCP server.');
    console.error(`Unsupported arguments detected: ${formattedArgs}`);
    console.error('Run individual build/test commands via your MCP client (e.g., call the xcode_build or xcode_test tools, or use the xcodecontrol CLI).');
    await Logger.flush();
    process.exit(1);
  }
  // Check for --no-clean argument
  const noCleanArg = process.argv.includes('--no-clean');
  const includeClean = !noCleanArg;
  
  // Check for preferred values from environment variables or command-line arguments
  const preferredScheme = process.env.XCODE_MCP_PREFERRED_SCHEME || 
    process.argv.find(arg => arg.startsWith('--preferred-scheme='))?.split('=')[1];
  
  const preferredXcodeproj = process.env.XCODE_MCP_PREFERRED_XCODEPROJ || 
    process.argv.find(arg => arg.startsWith('--preferred-xcodeproj='))?.split('=')[1];
  
  const serverOptions: {
    includeClean: boolean;
    preferredScheme?: string;
    preferredXcodeproj?: string;
  } = { includeClean };
  
  if (preferredScheme) serverOptions.preferredScheme = preferredScheme;
  if (preferredXcodeproj) serverOptions.preferredXcodeproj = preferredXcodeproj;
  
  const server = new XcodeMCPServer(serverOptions);
  
  // Check for port argument
  const portArg = process.argv.find(arg => arg.startsWith('--port='));
  const portValue = portArg?.split('=')[1];
  const port = portValue ? parseInt(portValue, 10) : undefined;
  
  server.start(port).catch(async (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Logger.error('Server startup failed:', errorMessage);
    await Logger.flush();
    process.exit(1);
  });
}
