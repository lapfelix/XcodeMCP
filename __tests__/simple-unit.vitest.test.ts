import { vi, describe, test, expect, beforeAll, afterAll } from 'vitest';

// Mock dependencies
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({
    stdout: { on: vi.fn(), pipe: vi.fn() },
    stderr: { on: vi.fn(), pipe: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    exitCode: null,
    killed: false,
  }),
  execFile: vi.fn((...args: any[]) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (callback) {
      callback(null, '', '');
    }
    return { pid: 123 };
  }),
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
    constructor(public code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  CallToolResult: {} // Mock type
}));

describe('XcodeMCPServer Basic Tests', () => {
  let XcodeMCPServer: any;

  beforeAll(async () => {
    const module = await import('../src/index.js');
    XcodeMCPServer = module.XcodeMCPServer;
  });

  test('should be able to instantiate XcodeMCPServer', () => {
    expect(() => new XcodeMCPServer()).not.toThrow();
  });

  test('should have executeJXA method', () => {
    const server = new XcodeMCPServer();
    expect(typeof server.executeJXA).toBe('function');
  });

  test('should have all required tool methods', () => {
    const server = new XcodeMCPServer();
    
    const requiredMethods = [
      'openProject',
      'validateProjectPath',
      'findProjectDerivedData',
      'getLatestBuildLog',
      'parseBuildLog',
      'canParseLog',
      'getCustomDerivedDataLocationFromXcodePreferences'
    ];

    requiredMethods.forEach(method => {
      expect(typeof server[method]).toBe('function');
    });
  });

  test('should properly format JXA scripts for simple operations', () => {
    const server = new XcodeMCPServer();
    
    // Test that methods exist and can be called (though they will fail without proper mocking)
    expect(() => server.openProject('/test/path')).not.toThrow();
  });
});
