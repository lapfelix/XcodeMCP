import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Create the mock spawn function before importing anything
const mockSpawn = jest.fn();

// Mock child_process before any imports
jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn
}));

// Mock fs/promises
jest.unstable_mockModule('fs/promises', () => ({
  readdir: jest.fn(),
  stat: jest.fn()
}));

// Mock MCP SDK
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

// Skip integration tests when Xcode is not available
const describeIfXcode = process.env.SKIP_XCODE_TESTS ? describe.skip : describe;

describeIfXcode('Integration Tests', () => {
  let XcodeMCPServer;
  let mockProcess;

  beforeAll(async () => {
    const module = await import('../dist/index.js');
    XcodeMCPServer = module.default || module.XcodeMCPServer;
  });

  beforeEach(() => {
    mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.kill = jest.fn();
    jest.clearAllMocks();
    mockSpawn.mockClear();
    mockSpawn.mockReturnValue(mockProcess);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Complete Workflow Tests', () => {
    test('should handle complete build workflow', async () => {
      const server = new XcodeMCPServer();
      
      // Step 1: Open project
      const openPromise = server.openProject('/Users/test/TestApp.xcodeproj');
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Project opened successfully\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const openResult = await openPromise;
      expect(openResult.content[0].text).toBe('Project opened successfully');
      
      // Reset mock for next call
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);
      
      // Step 2: Get workspace info
      const infoPromise = server.getWorkspaceInfo();
      setTimeout(() => {
        const workspaceInfo = JSON.stringify({
          name: 'TestApp.xcodeproj',
          path: '/Users/test/TestApp.xcodeproj',
          loaded: true,
          activeScheme: 'TestApp',
          activeRunDestination: 'iPhone 15 Simulator'
        }, null, 2);
        mockProcess.stdout.emit('data', workspaceInfo);
        mockProcess.emit('close', 0);
      }, 10);
      
      const infoResult = await infoPromise;
      const workspaceData = JSON.parse(infoResult.content[0].text);
      expect(workspaceData.loaded).toBe(true);
      expect(workspaceData.activeScheme).toBe('TestApp');
      
      // Reset mock for next call
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);
      
      // Step 3: Build project
      const buildPromise = server.build('/Users/test/TestApp.xcodeproj', 'Debug', null, 'Integration workflow');
      setTimeout(() => {
        mockProcess.stdout.emit('data', '/Users/test/TestApp.xcodeproj\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const buildResult = await buildPromise;
      expect(buildResult.content[0].text).toContain('BUILD SUCCESSFUL');
    });

    test('should handle test workflow with custom arguments', async () => {
      const server = new XcodeMCPServer();
      
      // Step 1: Get available schemes
      const schemesPromise = server.getSchemes();
      setTimeout(() => {
        const schemes = JSON.stringify([
          { name: 'TestApp', id: 'scheme-1', isActive: true },
          { name: 'TestApp-Tests', id: 'scheme-2', isActive: false }
        ], null, 2);
        mockProcess.stdout.emit('data', schemes);
        mockProcess.emit('close', 0);
      }, 10);
      
      const schemesResult = await schemesPromise;
      const schemes = JSON.parse(schemesResult.content[0].text);
      expect(schemes).toHaveLength(2);
      
      // Reset mock for next call
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);
      
      // Step 2: Set active scheme to test scheme
      const setSchemePromise = server.setActiveScheme('TestApp-Tests');
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Active scheme set to: TestApp-Tests\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const setSchemeResult = await setSchemePromise;
      expect(setSchemeResult.content[0].text).toContain('TestApp-Tests');
      
      // Reset mock for next call
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);
      
      // Step 3: Run tests with arguments
      const testArgs = ['--verbose', '--parallel-testing-enabled', 'YES'];
      const testPromise = server.test(testArgs);
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Test started. Result ID: test-456\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const testResult = await testPromise;
      expect(testResult.content[0].text).toContain('Test started');
    });
  });

  describe('Error Recovery Tests', () => {
    test('should handle Xcode not running error', async () => {
      const server = new XcodeMCPServer();
      
      const buildPromise = server.build('/Users/test/TestApp.xcodeproj', 'Debug', null, 'Integration workflow');
      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Error: Application "Xcode" is not running\n');
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(buildPromise).rejects.toThrow('JXA execution failed');
    });

    test('should handle invalid scheme name', async () => {
      const server = new XcodeMCPServer();
      
      const setSchemePromise = server.setActiveScheme('NonExistentScheme');
      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Error: Scheme "NonExistentScheme" not found\n');
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(setSchemePromise).rejects.toThrow('JXA execution failed');
    });

    test('should handle invalid project path', async () => {
      const server = new XcodeMCPServer();
      
      const openPromise = server.openProject('/invalid/path/Project.xcodeproj');
      setTimeout(() => {
        mockProcess.stderr.emit('data', 'Error: File not found\n');
        mockProcess.emit('close', 1);
      }, 10);
      
      await expect(openPromise).rejects.toThrow('JXA execution failed');
    });
  });

  describe('Performance and Timeout Tests', () => {
    test('should handle slow JXA execution', async () => {
      const server = new XcodeMCPServer();
      
      const buildPromise = server.build('/Users/test/TestApp.xcodeproj', 'Debug', null, 'Integration workflow');
      
      // Simulate slow response
      setTimeout(() => {
        mockProcess.stdout.emit('data', '/Users/test/TestApp.xcodeproj\n');
        mockProcess.emit('close', 0);
      }, 100); // 100ms delay
      
      const result = await buildPromise;
      expect(result.content[0].text).toContain('BUILD SUCCESSFUL');
    });

    test('should handle multiple concurrent operations', async () => {
      const server = new XcodeMCPServer();
      
      // Create multiple mock processes for concurrent calls
      const processes = [];
      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter();
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        processes.push(proc);
        return proc;
      });
      
      // Start multiple operations concurrently
      const promises = [
        server.getSchemes(),
        server.getRunDestinations(),
        server.getWorkspaceInfo()
      ];
      
      // Simulate responses for all processes
      setTimeout(() => {
        processes.forEach((proc, index) => {
          const responses = [
            JSON.stringify([{ name: 'Scheme1', id: '1', isActive: true }]),
            JSON.stringify([{ name: 'iPhone 15', platform: 'iOS', architecture: 'arm64', isActive: true }]),
            JSON.stringify({ name: 'Test', loaded: true })
          ];
          proc.stdout.emit('data', responses[index]);
          proc.emit('close', 0);
        });
      }, 10);
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('content');
        expect(result.content[0]).toHaveProperty('text');
      });
    });
  });

  describe('Real-world Scenario Tests', () => {
    test('should handle debugging workflow', async () => {
      const server = new XcodeMCPServer();
      
      // Step 1: Get run destinations
      const destPromise = server.getRunDestinations();
      setTimeout(() => {
        const destinations = JSON.stringify([
          { name: 'iPhone 15 Pro', platform: 'iOS', architecture: 'arm64', isActive: false },
          { name: 'iPhone 15 Simulator', platform: 'iOS Simulator', architecture: 'x86_64', isActive: true }
        ], null, 2);
        mockProcess.stdout.emit('data', destinations);
        mockProcess.emit('close', 0);
      }, 10);
      
      const destResult = await destPromise;
      const destinations = JSON.parse(destResult.content[0].text);
      const activeDestination = destinations.find(d => d.isActive);
      expect(activeDestination.name).toBe('iPhone 15 Simulator');
      
      // Reset mock
      mockProcess = new EventEmitter();
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);
      
      // Step 2: Start debugging
      const debugPromise = server.debug('TestApp', false);
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'Debug started. Result ID: debug-789\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const debugResult = await debugPromise;
      expect(debugResult.content[0].text).toContain('Debug started');
    });

    test('should handle file operations workflow', async () => {
      const server = new XcodeMCPServer();
      
      // Open a source file at specific line
      const filePath = '/Users/test/TestApp/ViewController.swift';
      const lineNumber = 25;
      
      const openFilePromise = server.openFile(filePath, lineNumber);
      setTimeout(() => {
        mockProcess.stdout.emit('data', 'File opened successfully\n');
        mockProcess.emit('close', 0);
      }, 10);
      
      const result = await openFilePromise;
      expect(result.content[0].text).toBe('File opened successfully');
      
      // Verify the correct osascript call was made
      expect(mockSpawn).toHaveBeenCalledWith('osascript', ['-l', 'JavaScript', '-e', expect.any(String)]);
      const script = mockSpawn.mock.calls[0][2][2];
      expect(script).toContain(filePath);
      expect(script).toContain(lineNumber.toString());
    });
  });
});
