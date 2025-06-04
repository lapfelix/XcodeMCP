import { jest } from '@jest/globals';

// Mock the MCP SDK
const mockServer = {
  setRequestHandler: jest.fn(),
  connect: jest.fn()
};

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => mockServer)
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

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

describe('MCP Tool Handlers', () => {
  let XcodeMCPServer;
  let server;
  let listToolsHandler;
  let callToolHandler;

  beforeAll(async () => {
    const module = await import('../index.js');
    XcodeMCPServer = module.default || module.XcodeMCPServer;
  });

  beforeEach(() => {
    server = new XcodeMCPServer();
    
    // Extract the handlers that were registered
    const setRequestHandlerCalls = mockServer.setRequestHandler.mock.calls;
    
    const listToolsCall = setRequestHandlerCalls.find(call => call[0] === 'ListToolsRequestSchema');
    const callToolCall = setRequestHandlerCalls.find(call => call[0] === 'CallToolRequestSchema');
    
    listToolsHandler = listToolsCall ? listToolsCall[1] : null;
    callToolHandler = callToolCall ? callToolCall[1] : null;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('ListTools Handler', () => {
    test('should return all available tools', async () => {
      expect(listToolsHandler).toBeDefined();
      
      const result = await listToolsHandler();
      
      expect(result).toHaveProperty('tools');
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.length).toBeGreaterThan(0);
      
      // Check for essential tools
      const toolNames = result.tools.map(tool => tool.name);
      expect(toolNames).toContain('xcode_open_project');
      expect(toolNames).toContain('xcode_build');
      expect(toolNames).toContain('xcode_test');
      expect(toolNames).toContain('xcode_run');
      expect(toolNames).toContain('xcode_debug');
    });

    test('should include proper tool schemas', async () => {
      const result = await listToolsHandler();
      
      const openProjectTool = result.tools.find(tool => tool.name === 'xcode_open_project');
      expect(openProjectTool).toHaveProperty('description');
      expect(openProjectTool).toHaveProperty('inputSchema');
      expect(openProjectTool.inputSchema).toHaveProperty('properties');
      expect(openProjectTool.inputSchema.properties).toHaveProperty('path');
      expect(openProjectTool.inputSchema.required).toContain('path');
    });

    test('should include optional parameter tools', async () => {
      const result = await listToolsHandler();
      
      const testTool = result.tools.find(tool => tool.name === 'xcode_test');
      expect(testTool.inputSchema.properties).toHaveProperty('commandLineArguments');
      expect(testTool.inputSchema.properties.commandLineArguments.type).toBe('array');
      
      const debugTool = result.tools.find(tool => tool.name === 'xcode_debug');
      expect(debugTool.inputSchema.properties).toHaveProperty('scheme');
      expect(debugTool.inputSchema.properties).toHaveProperty('skipBuilding');
    });
  });

  describe('CallTool Handler', () => {
    test('should handle unknown tool names', async () => {
      expect(callToolHandler).toBeDefined();
      
      const request = {
        params: {
          name: 'unknown_tool',
          arguments: {}
        }
      };
      
      await expect(callToolHandler(request)).rejects.toThrow('Unknown tool: unknown_tool');
    });

    test('should route to correct methods for known tools', async () => {
      // Mock the individual methods
      const mockExecuteJXA = jest.fn().mockResolvedValue('Success');
      server.executeJXA = mockExecuteJXA;

      const toolTests = [
        { name: 'xcode_build', args: {} },
        { name: 'xcode_clean', args: {} },
        { name: 'xcode_stop', args: {} },
        { name: 'xcode_get_schemes', args: {} },
        { name: 'xcode_get_run_destinations', args: {} },
        { name: 'xcode_get_workspace_info', args: {} },
        { name: 'xcode_get_projects', args: {} }
      ];

      for (const { name, args } of toolTests) {
        const request = {
          params: { name, arguments: args }
        };

        const result = await callToolHandler(request);
        
        expect(result).toHaveProperty('content');
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0]).toHaveProperty('type', 'text');
        expect(result.content[0]).toHaveProperty('text');
      }
    });

    test('should handle tools with parameters correctly', async () => {
      const mockExecuteJXA = jest.fn().mockResolvedValue('Project opened successfully');
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_open_project',
          arguments: {
            path: '/Users/test/TestProject.xcodeproj'
          }
        }
      };

      const result = await callToolHandler(request);
      
      expect(result.content[0].text).toBe('Project opened successfully');
      expect(mockExecuteJXA).toHaveBeenCalled();
    });

    test('should handle array parameters', async () => {
      const mockExecuteJXA = jest.fn().mockResolvedValue('Test started. Result ID: test-123');
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_test',
          arguments: {
            commandLineArguments: ['--verbose', '--parallel-testing-enabled', 'YES']
          }
        }
      };

      const result = await callToolHandler(request);
      
      expect(result.content[0].text).toBe('Test started. Result ID: test-123');
      expect(mockExecuteJXA).toHaveBeenCalled();
    });

    test('should handle optional parameters', async () => {
      const mockExecuteJXA = jest.fn().mockResolvedValue('Debug started. Result ID: debug-456');
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_debug',
          arguments: {
            scheme: 'TestScheme',
            skipBuilding: true
          }
        }
      };

      const result = await callToolHandler(request);
      
      expect(result.content[0].text).toBe('Debug started. Result ID: debug-456');
      expect(mockExecuteJXA).toHaveBeenCalled();
    });

    test('should propagate execution errors', async () => {
      const mockExecuteJXA = jest.fn().mockRejectedValue(new Error('JXA execution failed'));
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_build',
          arguments: {}
        }
      };

      await expect(callToolHandler(request)).rejects.toThrow('Tool execution failed: JXA execution failed');
    });
  });

  describe('Tool Input Validation', () => {
    test('should handle missing required parameters gracefully', async () => {
      const mockExecuteJXA = jest.fn();
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_open_project',
          arguments: {} // Missing required 'path' parameter
        }
      };

      // The method should handle undefined gracefully
      await expect(callToolHandler(request)).rejects.toThrow();
    });

    test('should handle undefined optional parameters', async () => {
      const mockExecuteJXA = jest.fn().mockResolvedValue('Test started');
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_test',
          arguments: {
            // commandLineArguments is optional and not provided
          }
        }
      };

      const result = await callToolHandler(request);
      expect(result).toBeDefined();
    });

    test('should handle boolean parameters correctly', async () => {
      const mockExecuteJXA = jest.fn().mockResolvedValue('Debug started');
      server.executeJXA = mockExecuteJXA;

      const request = {
        params: {
          name: 'xcode_debug',
          arguments: {
            skipBuilding: false
          }
        }
      };

      const result = await callToolHandler(request);
      expect(result).toBeDefined();
    });
  });
});