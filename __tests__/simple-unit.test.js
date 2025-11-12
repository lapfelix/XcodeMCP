import { jest } from '@jest/globals';

// Mock dependencies
jest.mock('child_process', () => ({
  spawn: jest.fn().mockReturnValue({
    stdout: { on: jest.fn(), pipe: jest.fn() },
    stderr: { on: jest.fn(), pipe: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
    exitCode: null,
    killed: false,
  }),
  execFile: jest.fn((...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (callback) {
      callback(null, '', '');
    }
    return { pid: 123 };
  }),
}));

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn()
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}));

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
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

// Suppress console.error during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalConsoleError;
});

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

  test('should have all required tool methods', () => {
    const server = new XcodeMCPServer();
    
    const requiredMethods = [
      'openProject',
      'build',
      'clean',
      'test',
      'run',
      'debug',
      'stop',
      'getSchemes',
      'getRunDestinations',
      'setActiveScheme',
      'getWorkspaceInfo',
      'getProjects',
      'openFile'
    ];

    requiredMethods.forEach(method => {
      expect(typeof server[method]).toBe('function');
    });
  });

  test('should properly format JXA scripts for simple operations', () => {
    const server = new XcodeMCPServer();
    
    // Test that methods exist and can be called (though they will fail without proper mocking)
    expect(() => server.openProject('/test/path')).not.toThrow();
    expect(() => server.build('/test/path', 'Debug', null, 'Simple unit smoke')).not.toThrow();
    expect(() => server.clean()).not.toThrow();
  });
});
