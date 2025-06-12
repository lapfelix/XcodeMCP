#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { XcodeServer } from './src/XcodeServer.js';

class XcodeMCPServer extends XcodeServer {
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Xcode MCP server running on stdio');
  }
}

export { XcodeMCPServer };

if (process.env.NODE_ENV !== 'test') {
  const server = new XcodeMCPServer();
  server.start().catch(console.error);
}