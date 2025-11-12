import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import * as childProcess from 'child_process';

// Get the mocked spawn function
const mockSpawn = jest.fn();
const spawn = mockSpawn; // Add alias for tests

// Mock the child_process module
jest.mock('child_process', () => ({
  spawn: mockSpawn,
  execFile: jest.fn((...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (callback) {
      callback(null, '', '');
    }
    return { pid: 123 };
  }),
}));

// Mock the MCP SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn().mockResolvedValue()
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

// Skip tests when Xcode is not available
const describeIfXcode = process.env.SKIP_XCODE_TESTS ? describe.skip : describe;

describeIfXcode('XcodeMCPServer', () => {
  let XcodeMCPServer;
  let mockProcess;

  beforeAll(async () => {
    // Import after mocks are set up
    const module = await import('../dist/index.js');
    XcodeMCPServer = module.XcodeMCPServer;
  });

  beforeEach(() => {
    // Create a mock process that behaves like osascript
    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = jest.fn();
    
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeJXA', () => {
    test('should execute JXA script successfully', async () => {
      const server = new XcodeMCPServer();
      const testScript = 'Application("Xcode").name()';
      
      // Execute the method asynchronously
      const resultPromise = server.executeJXA(testScript);
      
      // Simulate successful execution
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Xcode\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript', '-e', testScript]);
      expect(result).toBe('Xcode');
    });

    test('should handle JXA execution errors', async () => {
      const server = new XcodeMCPServer();
      const testScript = 'invalid script';
      
      const resultPromise = server.executeJXA(testScript);
      
      // Simulate error
      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Error: Script failed\n');
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(resultPromise).rejects.toThrow('JXA execution failed: Error: Script failed');
    });
  });

  describe('Tool argument validation', () => {
    test('should generate correct JXA script for openProject', async () => {
      const server = new XcodeMCPServer();
      const testPath = '/Users/test/TestProject.xcodeproj';
      
      // Mock successful execution
      const resultPromise = server.openProject(testPath);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Project opened successfully\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][2];
      expect(spawnArgs[0]).toContain(testPath);
      expect(result.content[0].text).toBe('Project opened successfully');
    });

    test('should generate correct JXA script for test with arguments', async () => {
      const server = new XcodeMCPServer();
      const testPath = '/Users/test/TestProject.xcodeproj';
      const testArgs = ['--verbose', '--parallel-testing-enabled', 'YES'];
      
      const resultPromise = server.test(testPath, testArgs);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Test started. Result ID: test-123\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][2];
      expect(spawnArgs[0]).toContain(JSON.stringify(testArgs));
      expect(result.content[0].text).toBe('Test started. Result ID: test-123');
    });

    test('should generate correct JXA script for debug with optional parameters', async () => {
      const server = new XcodeMCPServer();
      const scheme = 'TestScheme';
      const skipBuilding = true;
      
      const resultPromise = server.debug(scheme, skipBuilding);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Debug started. Result ID: debug-456\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][2];
      expect(spawnArgs[0]).toContain(`scheme: "${scheme}"`);
      expect(spawnArgs[0]).toContain('skipBuilding: true');
      expect(result.content[0].text).toBe('Debug started. Result ID: debug-456');
    });
  });

  describe('JSON parsing for complex responses', () => {
    test('should parse schemes response correctly', async () => {
      const server = new XcodeMCPServer();
      const mockSchemesResponse = JSON.stringify([
        { name: 'MyApp', id: 'scheme-1', isActive: true },
        { name: 'MyApp-Tests', id: 'scheme-2', isActive: false }
      ], null, 2);
      
      const resultPromise = server.getSchemes();
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', mockSchemesResponse);
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(result.content[0].text).toBe(mockSchemesResponse);
    });

    test('should parse workspace info response correctly', async () => {
      const server = new XcodeMCPServer();
      const mockWorkspaceInfo = JSON.stringify({
        name: 'TestWorkspace.xcworkspace',
        path: '/Users/test/TestWorkspace.xcworkspace',
        loaded: true,
        activeScheme: 'MyApp',
        activeRunDestination: 'iPhone 15 Simulator'
      }, null, 2);
      
      const resultPromise = server.getWorkspaceInfo();
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', mockWorkspaceInfo);
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(result.content[0].text).toBe(mockWorkspaceInfo);
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle empty command line arguments', async () => {
      const server = new XcodeMCPServer();
      
      const resultPromise = server.test([]);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Test started. Result ID: test-empty\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][2];
      // Should not contain withCommandLineArguments when empty
      expect(spawnArgs[0]).not.toContain('withCommandLineArguments');
    });

    test('should handle scheme name with special characters', async () => {
      const server = new XcodeMCPServer();
      const schemeName = "My-App's Test Scheme";
      
      const resultPromise = server.setActiveScheme(schemeName);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', `Active scheme set to: ${schemeName}\n`);
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][2];
      expect(spawnArgs[0]).toContain(schemeName);
    });

    test('should handle file path with spaces', async () => {
      const server = new XcodeMCPServer();
      const filePath = '/Users/test/My Project/Source File.swift';
      const lineNumber = 42;
      
      const resultPromise = server.openFile(filePath, lineNumber);
      
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'File opened successfully\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await resultPromise;
      
      expect(spawn).toHaveBeenCalled();
      const spawnArgs = spawn.mock.calls[0][2];
      expect(spawnArgs[0]).toContain(filePath);
      expect(spawnArgs[0]).toContain(lineNumber.toString());
    });
  });

  describe('Script generation validation', () => {
    test('should generate valid JavaScript syntax', async () => {
      const server = new XcodeMCPServer();
      
      // Test multiple methods to ensure they generate valid JS
      const fakeProject = '/Users/test/TestApp.xcodeproj';
      const methods = [
        () => server.build(fakeProject, 'Debug', null, 'Script generation test'),
        () => server.clean(fakeProject),
        () => server.stop(fakeProject),
        () => server.getSchemes(fakeProject),
        () => server.getRunDestinations(fakeProject),
        () => server.getWorkspaceInfo(fakeProject),
        () => server.getProjects(fakeProject)
      ];
      
      for (const method of methods) {
        const resultPromise = method();
        
        setTimeout(() => {
          mockProcess.stdout.emit('data', 'Success\n');
          mockProcess.emit('close', 0);
        }, 10);
        
        await resultPromise;
        
        // Verify that osascript was called with JavaScript flag
        expect(mockSpawn).toHaveBeenCalledWith('osascript', expect.arrayContaining(['-l', 'JavaScript']));
        
        // Reset mock for next iteration
        mockSpawn.mockClear();
        mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        spawn.mockReturnValue(mockProcess);
      }
    });
  });
});
