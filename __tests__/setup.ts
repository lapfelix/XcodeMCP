import { beforeEach, vi } from 'vitest';

/**
 * Global test setup for XcodeMCP tests
 */

// Mock environment variables for consistent testing
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

// Create a shared mock function that can be accessed by tests
const globalJXAMock = vi.fn();

// Global beforeEach to reset all mocks
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  
  // Reset any global state that might leak between tests
  delete process.env.MOCK_XCODE_RUNNING;
  delete process.env.MOCK_PROJECT_PATH;
  
  // Set up default behavior for global JXA mock to delegate to MockJXAExecutor
  globalJXAMock.mockImplementation(async (script: string) => {
    return MockJXAExecutor.execute(script);
  });
});

// Import MockJXAExecutor to share state
import { MockJXAExecutor } from './mocks/MockJXAExecutor.js';

// Mock the JXA executor to use our mock implementation
vi.mock('../src/utils/JXAExecutor.js', () => {
  return {
    JXAExecutor: {
      execute: globalJXAMock
    }
  };
});

// Mock the Environment Validator to always pass in tests
vi.mock('../src/utils/EnvironmentValidator.js', () => {
  return {
    EnvironmentValidator: {
      validateEnvironment: vi.fn().mockResolvedValue({
        overall: { 
          valid: true, 
          canOperateInDegradedMode: true,
          criticalFailures: [],
          nonCriticalFailures: []
        },
        os: { valid: true, message: 'macOS available (mocked)' },
        xcode: { valid: true, message: 'Xcode available (mocked)' },
        osascript: { valid: true, message: 'osascript available (mocked)' },
        xclogparser: { valid: true, message: 'XCLogParser available (mocked)' },
        permissions: { valid: true, message: 'Permissions granted (mocked)' }
      }),
      createHealthCheckReport: vi.fn().mockResolvedValue('✅ All systems operational (mocked)'),
      validateXCLogParser: vi.fn().mockResolvedValue({
        valid: true,
        message: 'XCLogParser available (mocked)',
        recoveryInstructions: [],
        metadata: {
          version: 'XCLogParser 0.2.9',
          path: '/usr/local/bin/xclogparser'
        }
      }),
      getUnavailableFeatures: vi.fn().mockReturnValue([])
    }
  };
});

// Mock external dependencies that we don't want to actually call in tests
vi.mock('fs', () => ({
  existsSync: vi.fn().mockImplementation((path: string) => {
    // Only return true for specific test files that are supposed to exist
    if (path.includes('/Users/test/MyApp/MyApp.xcodeproj') || 
        path.includes('/Users/test/MyWorkspace/MyWorkspace.xcworkspace') ||
        path.includes('/Users/test/Dual/Dual.xcodeproj') ||
        path.includes('/Users/test/Dual/Dual.xcworkspace')) {
      return true;
    }
    // For MyApp project, don't return true for the workspace - it doesn't exist
    if (path.includes('/Users/test/MyApp/MyApp.xcworkspace')) {
      return false;
    }
    return false;
  }),
  readFileSync: vi.fn().mockReturnValue('{}'),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ 
    isDirectory: () => false, 
    isFile: () => true, 
    mtime: new Date(),
    size: 1024 
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn()
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ 
    isDirectory: () => false, 
    isFile: () => true, 
    mtime: new Date(),
    size: 1024 // Stable file size for build monitoring
  }),
  readdir: vi.fn().mockResolvedValue([])
}));

// Mock path validation with proper validation logic
vi.mock('../src/utils/PathValidator.js', () => {
  const mockPathValidator = {
    validateProjectPath: vi.fn().mockImplementation((path: string) => {
      if (
        !path ||
        path === '' ||
        path.includes('/invalid/') ||
        path.endsWith('.txt') ||
        path.includes('/nonexistent/')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Invalid project path. Must be a .xcodeproj or .xcworkspace file.',
            },
          ],
        };
      }
      return null;
    }),
    validateFilePath: vi.fn().mockImplementation((path: string) => {
      if (
        !path ||
        path === '' ||
        path.includes('/invalid/') ||
        path.endsWith('.txt') ||
        path.includes('/nonexistent/')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Invalid project path. Must be a .xcodeproj or .xcworkspace file.',
            },
          ],
        };
      }
      return null;
    }),
  };
  return {
    PathValidator: mockPathValidator,
    default: mockPathValidator,
  };
});

// Mock BuildLogParser 
vi.mock('../src/utils/BuildLogParser.js', () => {
  const mockBuildLogParser = {
    parseBuildOutput: vi.fn().mockResolvedValue({
      summary: { warnings: 0, errors: 0, tests: 0, passed: 0, failed: 0 },
      issues: [],
    }),
    getLatestBuildLog: vi.fn().mockResolvedValue({
      path: '/mock/path/to/build.log',
      mtime: new Date(Date.now() + 1000),
    }),
    findProjectDerivedData: vi.fn().mockResolvedValue('/mock/derived/data'),
    parseBuildLog: vi.fn().mockResolvedValue({
      summary: { warnings: 0, errors: 0, tests: 0, passed: 0, failed: 0 },
      issues: [],
      errors: [],
      warnings: [],
    }),
    getRecentBuildLogs: vi.fn().mockResolvedValue([
      {
        path: '/mock/path/to/build.log',
        mtime: new Date(Date.now() + 1000),
      },
    ]),
  };
  return {
    BuildLogParser: mockBuildLogParser,
    default: mockBuildLogParser,
  };
});

// Global flag to track large output test
let isLargeOutputTest = false;

// Mock XCResultTool command execution - simplified for now
vi.mock('../src/tools/XCResultTools.js', () => {
  const mockXCResultTools = {
      getBrowseHandler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Mock XCResult data' }] }),
      getConsoleHandler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Mock console output' }] }),
      getScreenshotHandler: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Mock screenshot' }] }),
      
      // Main methods called by tests
      xcresultBrowse: vi.fn().mockImplementation(async (xcresultPath: string, testId?: string, includeConsole?: boolean) => {
        if (xcresultPath.includes('nonexistent')) {
          return { content: [{ type: 'text', text: 'XCResult bundle not found - error parsing XCResult' }] };
        }
        if (xcresultPath.includes('notanxcresult')) {
          return { content: [{ type: 'text', text: 'must be an .xcresult bundle' }] };
        }
        if (testId) {
          // Handle test index numbers (e.g. "1" refers to the second test, 0-indexed)
          if (testId === '1') {
            let text = `Test Details for testFailure\nStatus: failed\nDuration: 0.456s`;
            if (includeConsole) {
              text += '\nConsole Output:\nTest started\nAssertion failed\nTest failed';
            }
            return { content: [{ type: 'text', text }] };
          }
          let text = `Test Details for ${testId}\nStatus: ${testId.includes('Failure') ? 'failed' : 'passed'}\nDuration: ${testId.includes('Failure') ? '0.456s' : '0.123s'}`;
          if (includeConsole) {
            text += '\nConsole Output:\nTest started\nAssertion failed\nTest failed';
          }
          return { content: [{ type: 'text', text }] };
        }
        return { 
          content: [{ 
            type: 'text', 
            text: 'Test Summary\nTotal: 7\nPassed: 5\nFailed: 2\ntestExample (passed)\ntestFailure (failed)' 
          }] 
        };
      }),
      
      xcresultBrowserGetConsole: vi.fn()
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Console Output:\nTest started\nAssertion failed\nTest failed' }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Console output saved to file: /tmp/console_output_test.txt' }] })
        .mockResolvedValue({ content: [{ type: 'text', text: 'Console Output:\nTest started\nTest passed' }] }),
      
      xcresultSummary: vi.fn().mockImplementation(async (xcresultPath: string) => {
        return { 
          content: [{ 
            type: 'text', 
            text: 'Quick Summary\n7 tests total\n5 passed\n2 failed' 
          }] 
        };
      }),
      
      xcresultGetScreenshot: vi.fn().mockImplementation(async (xcresultPath: string, testId: string, timestamp: number) => {
        if (testId.includes('testExample')) {
          return { content: [{ type: 'text', text: 'No screenshots found for this test' }] };
        }
        if (timestamp >= 0.456) {
          return { content: [{ type: 'text', text: 'Screenshot extracted at timestamp 0.456 with warning: use timestamps before failure' }] };
        }
        return { content: [{ type: 'text', text: `Screenshot extracted at timestamp ${timestamp}` }] };
      }),
      
      xcresultGetUIHierarchy: vi.fn().mockImplementation(async (xcresultPath: string, testId: string, timestamp?: number, fullHierarchy?: boolean, rawFormat?: boolean) => {
        if (rawFormat) {
          return { content: [{ type: 'text', text: 'Raw accessibility tree data' }] };
        }
        if (fullHierarchy) {
          return { content: [{ type: 'text', text: 'Full hierarchy saved to file (several MB)' }] };
        }
        let text = 'UI Hierarchy (AI-readable format)';
        if (timestamp !== undefined) {
          text += ` at timestamp ${timestamp}`;
        }
        return { content: [{ type: 'text', text }] };
      }),
      
      xcresultListAttachments: vi.fn().mockImplementation(async (xcresultPath: string, testId: string) => {
        if (testId.includes('testExample')) {
          return { content: [{ type: 'text', text: 'No attachments found for this test' }] };
        }
        return { 
          content: [{ 
            type: 'text', 
            text: 'Attachments for test:\nScreenshot (public.png)\nUI Hierarchy (text)' 
          }] 
        };
      }),
      
      xcresultExportAttachment: vi.fn().mockImplementation(async (xcresultPath: string, testId: string, attachmentIndex: number, convertToJson?: boolean) => {
        if (attachmentIndex > 2) {
          return { content: [{ type: 'text', text: 'Attachment not found - Invalid index' }] };
        }
        let text = 'Attachment exported';
        if (convertToJson) {
          text += ' and converted to JSON';
        }
        return { content: [{ type: 'text', text }] };
      })
  };
  return {
    XCResultTools: mockXCResultTools,
    default: mockXCResultTools,
  };
});

// Mock ParameterNormalizer
vi.mock('../src/utils/ParameterNormalizer.js', () => {
  return {
    ParameterNormalizer: {
      normalizeSchemeName: vi.fn().mockImplementation((name: string) => {
        if (!name || name.trim() === '') {
          throw new Error('Scheme name cannot be empty');
        }
        return name;
      }),
      normalizeDestinationName: vi.fn().mockImplementation((dest: string) => dest || 'Default Destination'),
      getDestinationNameCandidates: vi.fn().mockImplementation((dest: string) => {
        const normalized = dest || 'Default Destination';
        return [normalized];
      }),
      findBestMatch: vi.fn().mockImplementation((input: string, options: string[]) => {
        if (!input || !options.length) return null;
        return options.find(opt => opt.toLowerCase().includes(input.toLowerCase())) || options[0];
      })
    }
  };
});

// Mock ErrorHelper
vi.mock('../src/utils/ErrorHelper.js', () => {
  const mockErrorHelper = {
    parseCommonErrors: vi.fn().mockReturnValue(null),
    createErrorWithGuidance: vi.fn().mockImplementation(
      (error: string, guidance?: string) => `${error}${guidance ? '\n\n' + guidance : ''}`,
    ),
    getSchemeNotFoundGuidance: vi.fn().mockReturnValue('Try checking available schemes'),
    getDestinationNotFoundGuidance: vi.fn().mockReturnValue('Try checking available destinations'),
  };
  return {
    ErrorHelper: mockErrorHelper,
    default: mockErrorHelper,
  };
});

// Global error handler for uncaught test errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Increase timeout for integration tests
vi.setConfig({
  testTimeout: 10000 // 10 seconds
});

// Export the global JXA mock for use in tests
export function getGlobalJXAMock() {
  return globalJXAMock;
}
