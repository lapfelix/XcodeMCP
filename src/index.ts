#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { XcodeServer } from './XcodeServer.js';
import { Logger } from './utils/Logger.js';
import type { EnvironmentValidation } from './types/index.js';

// Handle uncaught exceptions and unhandled promise rejections to prevent crashes
process.on('uncaughtException', (error) => {
  Logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('Unhandled promise rejection:', reason);
  Logger.error('Promise:', promise);
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
  public async start(): Promise<void> {
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

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      Logger.info('Server started successfully on stdio');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('Failed to start server:', errorMessage);
      Logger.warn('Attempting to start in minimal mode...');
      
      try {
        // Attempt to start in minimal mode without validation
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
  const server = new XcodeMCPServer();
  server.start().catch(async (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Logger.error('Server startup failed:', errorMessage);
    await Logger.flush();
    process.exit(1);
  });
}