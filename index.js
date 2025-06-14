#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { XcodeServer } from './src/XcodeServer.js';

class XcodeMCPServer extends XcodeServer {
  async start() {
    try {
      // Perform environment validation on startup
      console.error('XcodeMCP: Starting server and validating environment...');
      
      const validation = await this.validateEnvironment();
      
      if (!validation.overall.valid) {
        if (validation.overall.canOperateInDegradedMode) {
          console.error('XcodeMCP: Starting in degraded mode due to configuration issues');
          console.error('XcodeMCP: Some features may be unavailable');
          console.error('XcodeMCP: Run the "xcode_health_check" tool for detailed diagnostics');
        } else {
          console.error('XcodeMCP: Critical configuration issues detected');
          console.error('XcodeMCP: Server may not function properly');
          console.error('XcodeMCP: Please run the "xcode_health_check" tool to resolve issues');
        }
      } else {
        console.error('XcodeMCP: Environment validation passed - all systems operational');
      }

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('XcodeMCP: Server started successfully on stdio');
      
    } catch (error) {
      console.error('XcodeMCP: Failed to start server:', error.message);
      console.error('XcodeMCP: Attempting to start in minimal mode...');
      
      try {
        // Attempt to start in minimal mode without validation
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('XcodeMCP: Server started in minimal mode (validation failed)');
        console.error('XcodeMCP: Use "xcode_health_check" tool to diagnose startup issues');
      } catch (fallbackError) {
        console.error('XcodeMCP: Critical failure - unable to start server:', fallbackError.message);
        process.exit(1);
      }
    }
  }
}

export { XcodeMCPServer };

if (process.env.NODE_ENV !== 'test') {
  const server = new XcodeMCPServer();
  server.start().catch(console.error);
}