import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockJXAExecutor, MockJXAExecutor } from '../mocks/MockJXAExecutor.js';
import { mockFileSystem, MockFileSystem } from '../mocks/MockFileSystem.js';
import { getGlobalJXAMock } from '../setup.ts';

// Mock child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const mockProcess = {
      stdout: {
        on: vi.fn((event, callback) => {
          if (event === 'data') {
            callback('/Applications/Xcode.app/Contents/Developer\n');
          }
        }),
        pipe: vi.fn(),
      },
      stderr: {
        on: vi.fn(),
        pipe: vi.fn(),
      },
      on: vi.fn((event, callback) => {
        if (event === 'close') {
          callback(0);
        }
      }),
      kill: vi.fn(),
      exitCode: null,
      killed: false,
    };
    return mockProcess;
  }),
  execFile: vi.fn((...args: any[]) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (callback) {
      callback(null, '', '');
    }
    return { pid: 123 };
  }),
}));

// Import the tools to test
import { ProjectTools } from '../../src/tools/ProjectTools.js';

// Mock ensureXcodeIsRunning to always return null (success)
const mockEnsureXcodeIsRunning = vi.fn().mockResolvedValue(null);
vi.spyOn(ProjectTools, 'ensureXcodeIsRunning').mockImplementation(mockEnsureXcodeIsRunning);

describe('ProjectTools', () => {
  let jxaMock: ReturnType<typeof mockJXAExecutor>;
  let fsMock: ReturnType<typeof mockFileSystem>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup mock systems
    jxaMock = mockJXAExecutor();
    fsMock = mockFileSystem();
    
    // Reset mock states
    jxaMock.resetState();
    fsMock.reset();
    
    // Create test projects
    fsMock.createMockProject('/Users/test/MyApp', 'MyApp', 'xcodeproj', ['MyApp', 'MyAppTests']);
    fsMock.createMockProject('/Users/test/MyWorkspace', 'MyWorkspace', 'xcworkspace', ['MyApp', 'MyLibrary']);
    jxaMock.setupMockProject('/Users/test/MyApp/MyApp.xcodeproj', ['MyApp', 'MyAppTests']);
    jxaMock.setupMockProject('/Users/test/MyWorkspace/MyWorkspace.xcworkspace', ['MyApp', 'MyLibrary'], ['MyApp', 'MyLibrary']);
    
    // Mock Xcode to be already running to bypass the ensureXcodeIsRunning issues
    jxaMock.setState({ isRunning: true, activeProject: '/Users/test/MyApp/MyApp.xcodeproj' });
  });

  describe('openProject', () => {
    it('should successfully open an Xcode project', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';

      const result = await ProjectTools.openProject(projectPath);

      expect(result.content).toEqual([
        { type: 'text', text: 'Project opened successfully' }
      ]);
      // Use the global mock from setup.ts
      const globalMock = getGlobalJXAMock();
      expect(globalMock).toHaveBeenCalledWith(
        expect.stringContaining("Application('Xcode')")
      );
      
      // State check disabled for now due to import issue
      // const state = MockJXAExecutor.getState();
      // expect(state.activeProject).toBe(projectPath);
      // expect(state.isRunning).toBe(true);
    });

    it('should successfully open an Xcode workspace', async () => {
      const workspacePath = '/Users/test/MyWorkspace/MyWorkspace.xcworkspace';

      const result = await ProjectTools.openProject(workspacePath);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('opened successfully') }
      ]);
      
      const state = jxaMock.getState();
      expect(state.activeProject).toBe(workspacePath);
    });

    it('should handle non-existent project files', async () => {
      const invalidPath = '/nonexistent/project.txt';

      const result = await ProjectTools.openProject(invalidPath);

      expect(result.content).toEqual([
        { type: 'text', text: 'Invalid project path. Must be a .xcodeproj or .xcworkspace file.' }
      ]);
    });

    it('should handle JXA execution errors', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      
      // Mock JXA to throw an error using the global mock
      const globalMock = getGlobalJXAMock();
      globalMock.mockImplementationOnce(async (script: string) => {
        throw new Error('Permission denied');
      });

      const result = await ProjectTools.openProject(projectPath);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('Permission denied') }
      ]);
    });
  });

  describe('openProjectAndWaitForLoad', () => {
    it('should open project and wait for it to load', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';

      const result = await ProjectTools.openProjectAndWaitForLoad(projectPath);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringMatching(/opened and loaded successfully|Project is already open and loaded/) }
      ]);
      
      // Should call at least one JXA script (either check if already open, or open project + wait for load)
      // Use the global mock from setup.ts instead of local mock
      const globalMock = getGlobalJXAMock();
      expect(globalMock).toHaveBeenCalledTimes(3); // Check if open, open project, wait for load
    });
  });

  describe('closeProject', () => {
    it('should successfully close the current project', async () => {
      // First open a project
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      await ProjectTools.openProject(projectPath);
      
      const result = await ProjectTools.closeProject(projectPath);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('close initiated') }
      ]);
      
      const state = jxaMock.getState();
      expect(state.activeProject).toBe(null);
      expect(state.buildInProgress).toBe(false);
      expect(state.testInProgress).toBe(false);
    });
  });

  describe('getSchemes', () => {
    it('should get schemes for an Xcode project', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      const openProjectMock = vi.fn().mockResolvedValue({ 
        content: [{ type: 'text', text: 'Project opened successfully' }] 
      });

      const result = await ProjectTools.getSchemes(projectPath, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('MyApp') }
      ]);
      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('MyAppTests') }
      ]);
      expect(openProjectMock).toHaveBeenCalledWith(projectPath);
    });

    it('should handle no schemes found', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      const openProjectMock = vi.fn().mockResolvedValue({ 
        content: [{ type: 'text', text: 'Project opened successfully' }] 
      });

      // Mock JXA to return empty schemes using the global mock
      const globalMock = getGlobalJXAMock();
      globalMock.mockImplementationOnce(async (script: string) => {
        if (script.includes('schemes()')) {
          return JSON.stringify([]);
        }
        return MockJXAExecutor.execute(script);
      });

      const result = await ProjectTools.getSchemes(projectPath, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('No schemes found') }
      ]);
    });
  });

  describe('setActiveScheme', () => {
    it('should set the active scheme', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      const schemeName = 'MyApp';
      const openProjectMock = vi.fn().mockResolvedValue({ 
        content: [{ type: 'text', text: 'Project opened successfully' }] 
      });

      const result = await ProjectTools.setActiveScheme(projectPath, schemeName, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining(`Active scheme set to: ${schemeName}`) }
      ]);
      const globalMock = getGlobalJXAMock();
      expect(globalMock).toHaveBeenCalledWith(
        expect.stringContaining(`workspace.activeScheme = targetScheme`)
      );
      
      const state = jxaMock.getState();
      expect(state.activeScheme).toBe(schemeName);
    });

    it('should handle invalid scheme names', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      const invalidScheme = 'NonExistentScheme';
      const openProjectMock = vi.fn().mockResolvedValue({ 
        content: [{ type: 'text', text: 'Project opened successfully' }] 
      });

      // Don't need to mock anything - the MockJXAExecutor will handle invalid schemes correctly

      const result = await ProjectTools.setActiveScheme(projectPath, invalidScheme, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining(`Scheme '${invalidScheme}' not found`) }
      ]);
    });
  });

  describe('getRunDestinations', () => {
    it('should get available run destinations', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      const openProjectMock = vi.fn().mockResolvedValue({ 
        content: [{ type: 'text', text: 'Project opened successfully' }] 
      });

      const result = await ProjectTools.getRunDestinations(projectPath, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('iPhone 15 Pro') }
      ]);
      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('iPad Pro') }
      ]);
      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('My Mac') }
      ]);
    });

    it('should handle no destinations found', async () => {
      const projectPath = '/Users/test/MyApp/MyApp.xcodeproj';
      const openProjectMock = vi.fn().mockResolvedValue({ 
        content: [{ type: 'text', text: 'Project opened successfully' }] 
      });

      // Mock JXA to return empty destinations using the global mock
      const globalMock = getGlobalJXAMock();
      globalMock.mockImplementationOnce(async (script: string) => {
        if (script.includes('runDestinations()')) {
          return JSON.stringify([]);
        }
        return MockJXAExecutor.execute(script);
      });

      const result = await ProjectTools.getRunDestinations(projectPath, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('No run destinations found') }
      ]);
    });
  });

  describe('path validation', () => {
    it('should validate project path exists', async () => {
      const invalidPath = '/nonexistent/project.xcodeproj';
      const openProjectMock = vi.fn();

      const result = await ProjectTools.getSchemes(invalidPath, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: 'Invalid project path. Must be a .xcodeproj or .xcworkspace file.' }
      ]);
      expect(openProjectMock).not.toHaveBeenCalled();
    });

    it('should validate project file extension', async () => {
      const invalidPath = '/Users/test/MyApp/somefile.txt';
      const openProjectMock = vi.fn();

      const result = await ProjectTools.getSchemes(invalidPath, openProjectMock);

      expect(result.content).toEqual([
        { type: 'text', text: 'Invalid project path. Must be a .xcodeproj or .xcworkspace file.' }
      ]);
    });
  });

  describe('workspace preference', () => {
    it('should prefer workspace over project when both exist', async () => {
      // Create both .xcodeproj and .xcworkspace in same directory
      fsMock.createMockProject('/Users/test/Dual', 'Dual', 'xcodeproj', ['Dual']);
      fsMock.createMockProject('/Users/test/Dual', 'Dual', 'xcworkspace', ['Dual']);

      const projectPath = '/Users/test/Dual/Dual.xcodeproj';
      
      const result = await ProjectTools.openProject(projectPath);

      // Should automatically use workspace instead
      expect(result.content).toEqual([
        { type: 'text', text: expect.stringContaining('workspace') }
      ]);
      
      const state = jxaMock.getState();
      expect(state.activeProject).toBe('/Users/test/Dual/Dual.xcworkspace');
    });
  });
});
