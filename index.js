#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { XcodeServer } from './src/XcodeServer.js';
import { Logger } from './src/utils/Logger.js';

class XcodeMCPServer extends XcodeServer {
  async start() {
    try {
      // Initialize logging system
      Logger.info('Starting server and validating environment...');
      Logger.debug('Log level set to:', Logger.getLogLevel());
      
      const validation = await this.validateEnvironment();
      
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

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      Logger.info('Server started successfully on stdio');
      
    } catch (error) {
      Logger.error('Failed to start server:', error.message);
      Logger.warn('Attempting to start in minimal mode...');
      
      try {
        // Attempt to start in minimal mode without validation
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        Logger.warn('Server started in minimal mode (validation failed)');
        Logger.info('Use "xcode_health_check" tool to diagnose startup issues');
      } catch (fallbackError) {
        Logger.error('Critical failure - unable to start server:', fallbackError.message);
        await Logger.flush();
        process.exit(1);
      }
    }
  }
}

export { XcodeMCPServer };

if (process.env.NODE_ENV !== 'test') {
  const server = new XcodeMCPServer();
  server.start().catch(async (error) => {
    Logger.error('Server startup failed:', error);
    await Logger.flush();
    process.exit(1);
  });
}