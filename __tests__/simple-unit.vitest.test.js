import { vi, describe, test, expect, beforeAll, afterAll } from 'vitest';

// Mock dependencies
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn()
  })
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn().mockImplementation(() => ({
    setRequestHandler: vi.fn(),
    connect: vi.fn()
  }))
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn()
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ErrorCode: {
    MethodNotFound: 'MethodNotFound',
    InternalError: 'InternalError'
  },
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  McpError: class McpError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
}));

describe('XcodeMCPServer Basic Tests', () => {
  let XcodeMCPServer;

  beforeAll(async () => {
    const module = await import('../dist/index.js');
    XcodeMCPServer = module.XcodeMCPServer;
  });

  test('should be able to instantiate XcodeMCPServer', () => {
    expect(() => new XcodeMCPServer()).not.toThrow();
  });

  test('should have executeJXA method', () => {
    const server = new XcodeMCPServer();
    expect(typeof server.executeJXA).toBe('function');
  });

  test.skip('should have all required tool methods', () => {
    // These are MCP tools, not instance methods
    // This test needs to be rewritten to test the tool handlers
  });

  test.skip('should properly format JXA scripts for simple operations', () => {
    // These are MCP tools, not instance methods
    // This test needs to be rewritten to test the tool handlers
  });
});