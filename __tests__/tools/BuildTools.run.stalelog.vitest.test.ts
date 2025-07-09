import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BuildTools } from '../../src/tools/BuildTools.js';
import { JXAExecutor } from '../../src/utils/JXAExecutor.js';
import { BuildLogParser } from '../../src/utils/BuildLogParser.js';

// Mock the dependencies
vi.mock('../../src/utils/JXAExecutor.js');
vi.mock('../../src/utils/BuildLogParser.js');

describe('BuildTools.run - Stale Build Log Bug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should wait for NEW build log, not return stale previous build log', async () => {
    const projectPath = '/test/project.xcodeproj';
    const scheme = 'TestScheme';
    
    // Mock the initial state - there's already an old build log
    const oldBuildLog = {
      path: '/test/old-build.xcactivitylog',
      mtime: new Date('2023-01-01T10:00:00Z'),
      buildId: 'old-build-123'
    };
    
    // Mock the new build log that should be created after the run command
    const newBuildLog = {
      path: '/test/new-build.xcactivitylog', 
      mtime: new Date('2023-01-01T10:05:00Z'),
      buildId: 'new-build-456'
    };

    // Mock JXA execution to simulate running the build
    const mockJXAExecutor = vi.mocked(JXAExecutor.execute);
    mockJXAExecutor.mockResolvedValue('Build started successfully');

    // Mock BuildLogParser to simulate the sequence:
    // 1. Initial call returns old log
    // 2. After run starts, still returns old log for a few attempts
    // 3. Then returns new log once build creates it
    const mockGetLatestBuildLog = vi.mocked(BuildLogParser.getLatestBuildLog);
    const mockParseBuildLog = vi.mocked(BuildLogParser.parseBuildLog);
    
    // Set up the sequence of calls
    let callCount = 0;
    mockGetLatestBuildLog.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Initial call - returns old log
        return oldBuildLog;
      } else if (callCount <= 5) {
        // First few attempts after run starts - still old log
        return oldBuildLog;
      } else if (callCount <= 10) {
        // New build log appears
        return newBuildLog;
      } else {
        // Build stabilizes - keep returning new log
        return newBuildLog;
      }
    });

    // Mock successful build result
    mockParseBuildLog.mockResolvedValue({
      buildStatus: 'succeeded',
      errors: [],
      warnings: [],
      buildId: 'new-build-456'
    });

    // Mock openProject callback
    const mockOpenProject = vi.fn().mockResolvedValue(undefined);
    
    // Call the run function
    const result = await BuildTools.run(projectPath, scheme, [], mockOpenProject);

    // Verify the result indicates success
    expect(result.content[0].text).toContain('BUILD SUCCESSFUL');
    
    // Critical assertion: BuildLogParser.parseBuildLog should be called with the NEW build log
    expect(mockParseBuildLog).toHaveBeenCalledWith(newBuildLog.path);
    
    // Should NOT be called with the old build log path
    expect(mockParseBuildLog).not.toHaveBeenCalledWith(oldBuildLog.path);
    
    // Verify we waited for the new build log to be created
    expect(mockGetLatestBuildLog).toHaveBeenCalledTimes(expect.any(Number));
    expect(callCount).toBeGreaterThan(5); // Should have waited for new log
  });

  it('should fail test: demonstrates the current bug where old log is used', async () => {
    const projectPath = '/test/project.xcodeproj';
    const scheme = 'TestScheme';
    
    // Mock the stale build log that exists before the run
    const staleBuildLog = {
      path: '/test/stale-build.xcactivitylog',
      mtime: new Date('2023-01-01T09:00:00Z'),
      buildId: 'stale-build-789'
    };

    // Mock JXA execution
    const mockJXAExecutor = vi.mocked(JXAExecutor.execute);
    mockJXAExecutor.mockResolvedValue('Build started');

    // Mock BuildLogParser to always return the stale log (simulating the bug)
    const mockGetLatestBuildLog = vi.mocked(BuildLogParser.getLatestBuildLog);
    const mockParseBuildLog = vi.mocked(BuildLogParser.parseBuildLog);
    
    // Bug scenario: always returns the same stale log
    mockGetLatestBuildLog.mockResolvedValue(staleBuildLog);
    
    // Parse the stale log (which might have old errors)
    mockParseBuildLog.mockResolvedValue({
      buildStatus: 'failed',
      errors: ['Old error from previous build'],
      warnings: [],
      buildId: 'stale-build-789'
    });

    // Mock openProject callback
    const mockOpenProject = vi.fn().mockResolvedValue(undefined);
    
    // This should fail because we're reading stale data
    await expect(BuildTools.run(projectPath, scheme, [], mockOpenProject)).rejects.toThrow();
    
    // The bug: we're parsing the stale log instead of waiting for new one
    expect(mockParseBuildLog).toHaveBeenCalledWith(staleBuildLog.path);
    
    // This test demonstrates the bug - we should NOT be using stale logs
    // TODO: Fix the bug so this test passes with correct behavior
  });

  it('should handle case where build log timing detection fails', async () => {
    const projectPath = '/test/project.xcodeproj';
    const scheme = 'TestScheme';
    
    // Mock scenario where initial log exists
    const initialLog = {
      path: '/test/initial.xcactivitylog',
      mtime: new Date('2023-01-01T08:00:00Z'),
      buildId: 'initial-123'
    };

    // Mock JXA execution
    const mockJXAExecutor = vi.mocked(JXAExecutor.execute);
    mockJXAExecutor.mockResolvedValue('Build started');

    const mockGetLatestBuildLog = vi.mocked(BuildLogParser.getLatestBuildLog);
    
    // Bug: The condition `newLog.path !== initialLog.path` might be wrong
    // if the build reuses the same log file but updates it
    let callCount = 0;
    mockGetLatestBuildLog.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return initialLog;
      } else {
        // Same path but newer timestamp - this is the real scenario
        return {
          path: initialLog.path, // SAME path
          mtime: new Date('2023-01-01T10:00:00Z'), // NEWER timestamp
          buildId: 'new-build-in-same-file'
        };
      }
    });

    const mockParseBuildLog = vi.mocked(BuildLogParser.parseBuildLog);
    mockParseBuildLog.mockResolvedValue({
      buildStatus: 'succeeded',
      errors: [],
      warnings: [],
      buildId: 'new-build-in-same-file'
    });

    // Mock openProject callback
    const mockOpenProject = vi.fn().mockResolvedValue(undefined);
    
    // This should work correctly when the bug is fixed
    const result = await BuildTools.run(projectPath, scheme, [], mockOpenProject);
    
    expect(result.content[0].text).toContain('BUILD SUCCESSFUL');
    expect(mockParseBuildLog).toHaveBeenCalledWith(initialLog.path);
  });
});