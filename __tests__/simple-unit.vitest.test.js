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
  execFile: vi.fn((...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (callback) {
      callback(null, '', '');
    }
    return { pid: 123 };
  }),
}));

// Mock filesystem operations
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn().mockReturnValue('mock file content'),
    writeFileSync: vi.fn()
  },
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn().mockReturnValue('mock file content'),
  writeFileSync: vi.fn()
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

  test('should have all required tool handlers registered', async () => {
    const server = new XcodeMCPServer();
    
    // List of required tools that should be available
    const requiredTools = [
      'xcode_build',
      'xcode_clean',
      'xcode_test',
      'xcode_build_and_run',
      'xcode_stop',
      'xcode_get_schemes',
      'xcode_set_active_scheme',
      'xcode_get_run_destinations',
      'xcode_get_workspace_info',
      'xcode_get_projects',
      'xcode_open_file',
      'xcode_health_check',
      'xcode_find_xcresults',
      'xcode_xcresult_browse',
      'xcode_xcresult_browser_get_console',
      'xcode_xcresult_summary',
      'xcode_xcresult_get_screenshot',
      'xcode_xcresult_get_ui_hierarchy',
      'xcode_xcresult_get_ui_element',
      'xcode_xcresult_list_attachments',
      'xcode_xcresult_export_attachment'
    ];
    
    // Verify the server was created and has the expected MCP server instance
    expect(server.server).toBeDefined();
    expect(server.server.setRequestHandler).toBeDefined();
    
    // Verify that setRequestHandler was called for both ListTools and CallTool
    expect(server.server.setRequestHandler).toHaveBeenCalledWith('ListToolsRequestSchema', expect.any(Function));
    expect(server.server.setRequestHandler).toHaveBeenCalledWith('CallToolRequestSchema', expect.any(Function));
    
    // Test that the server has methods for direct tool access
    expect(typeof server.callToolDirect).toBe('function');
    expect(typeof server.executeJXA).toBe('function');
    
    // Extract the ListTools handler and test it
    const setRequestHandlerCalls = server.server.setRequestHandler.mock.calls;
    const listToolsCall = setRequestHandlerCalls.find(call => call[0] === 'ListToolsRequestSchema');
    expect(listToolsCall).toBeDefined();
    
    const listToolsHandler = listToolsCall[1];
    const toolsResult = await listToolsHandler();
    
    // Verify the handler returns the expected structure
    expect(toolsResult).toHaveProperty('tools');
    expect(Array.isArray(toolsResult.tools)).toBe(true);
    expect(toolsResult.tools.length).toBeGreaterThan(0);
    
    // Verify all required tools are present in the tools list
    const availableToolNames = toolsResult.tools.map(tool => tool.name);
    for (const toolName of requiredTools) {
      expect(availableToolNames).toContain(toolName);
    }
    
    // Verify each tool has the required properties
    for (const tool of toolsResult.tools) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('inputSchema');
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
  });

  test('should properly format JXA scripts for simple operations', async () => {
    // Import the actual tool classes to test JXA script generation
    const { InfoTools } = await import('../dist/tools/InfoTools.js');
    const { JXAExecutor } = await import('../dist/utils/JXAExecutor.js');
    
    // Mock JXAExecutor to capture generated scripts
    const mockExecute = vi.fn().mockResolvedValue('{"mockResult": "success"}');
    vi.spyOn(JXAExecutor, 'execute').mockImplementation(mockExecute);
    
    // Mock the openProject callback
    const mockOpenProject = vi.fn().mockResolvedValue(null);
    
    // Test the getWorkspaceInfo method which generates JXA scripts
    const result = await InfoTools.getWorkspaceInfo('/test/project.xcodeproj', mockOpenProject);
    
    // Verify JXA script was executed
    expect(mockExecute).toHaveBeenCalled();
    
    // Get the generated JXA script
    const generatedScript = mockExecute.mock.calls[0][0];
    
    // Validate JXA script structure and formatting
    expect(generatedScript).toContain('(function() {');
    expect(generatedScript).toContain('const app = Application(\'Xcode\');');
    expect(generatedScript).toContain('workspaceDocuments()');
    expect(generatedScript).toContain('if (!workspace)');
    expect(generatedScript).toContain('})()');
    
    // Should use the new workspace finding mechanism
    expect(generatedScript).toContain('Find the workspace document matching the target path');
    
    // Validate proper error handling
    expect(generatedScript).toContain('throw new Error');
    
    // Validate JSON serialization for return values
    expect(generatedScript).toContain('JSON.stringify');
    
    // Validate proper function closure (IIFE pattern)
    expect(generatedScript.trim()).toMatch(/^\s*\(function\(\) \{[\s\S]*\}\)\(\)\s*$/);
    
    // Validate indentation consistency (should use consistent spaces/tabs)
    const lines = generatedScript.split('\n');
    const indentedLines = lines.filter(line => line.trim() && line.startsWith('  '));
    expect(indentedLines.length).toBeGreaterThan(0); // Should have some indented lines
    
    // Validate that the script contains workspace information extraction
    expect(generatedScript).toContain('workspace.name()');
    expect(generatedScript).toContain('workspace.path()');
    expect(generatedScript).toContain('workspace.loaded()');
    expect(generatedScript).toContain('workspace.activeScheme()');
    expect(generatedScript).toContain('workspace.activeRunDestination()');
    
    // Validate proper JavaScript object literal syntax
    expect(generatedScript).toContain('const info = {');
    expect(generatedScript).toContain('name: workspace.name(),');
    expect(generatedScript).toContain('path: workspace.path(),');
    
    // Validate conditional logic for optional properties
    expect(generatedScript).toContain('workspace.activeScheme() ? workspace.activeScheme().name() : null');
    expect(generatedScript).toContain('workspace.activeRunDestination() ? workspace.activeRunDestination().name() : null');
    
    // Validate proper JSON.stringify usage with formatting
    expect(generatedScript).toContain('JSON.stringify(info, null, 2)');
    
    // Validate return statement
    expect(generatedScript).toContain('return JSON.stringify');
    
    // Validate no syntax errors in generated script (basic structure check)
    expect(generatedScript).not.toContain('undefined');
    expect(generatedScript).not.toContain(',,'); // No empty array/object elements
    
    // Validate proper string escaping (important for path handling)
    expect(generatedScript).toContain('throw new Error(\'Workspace not found for path:');
    
    // Test should return expected MCP result format
    expect(result).toHaveProperty('content');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text', '{"mockResult": "success"}');
  });
});
