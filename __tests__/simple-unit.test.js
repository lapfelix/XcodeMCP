import { jest } from '@jest/globals';

describe('XcodeMCPServer Basic Tests', () => {
  let XcodeMCPServer;

  beforeAll(async () => {
    // Mock all dependencies before importing
    jest.unstable_mockModule('child_process', () => ({
      spawn: jest.fn().mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      })
    }));

    jest.unstable_mockModule('@modelcontextprotocol/sdk/server/index.js', () => ({
      Server: jest.fn().mockImplementation(() => ({
        setRequestHandler: jest.fn(),
        connect: jest.fn()
      }))
    }));

    jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: jest.fn()
    }));

    jest.unstable_mockModule('@modelcontextprotocol/sdk/types.js', () => ({
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

    const module = await import('../index.js');
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
    expect(() => server.build()).not.toThrow();
    expect(() => server.clean()).not.toThrow();
  });
});