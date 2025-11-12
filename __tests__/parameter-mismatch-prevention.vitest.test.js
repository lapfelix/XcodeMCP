/**
 * Simplified tests to prevent parameter mismatch bugs like the xcode_run issue
 * Focus on catching "not defined" variable errors in function signatures
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { XcodeMCPServer } from '../dist/index.js';

describe('Parameter Mismatch Prevention', () => {
  let server;

  beforeEach(() => {
    server = new XcodeMCPServer();
  });

  describe('Function Parameter Counts', () => {
    test('functions have expected parameter counts (prevents signature mismatches)', () => {
      // These counts reflect the actual required parameters (without defaults)
      const expectedCounts = {
        build: 1,           // projectPath (schemeName and destination have defaults)
        clean: 1,           // projectPath
        test: 2,            // projectPath, destination (commandLineArguments has default)
        run: 1,             // projectPath (commandLineArguments has default)  
        debug: 2,           // projectPath, scheme (skipBuilding has default)
        stop: 1,            // projectPath
        getSchemes: 1,      // projectPath
        getRunDestinations: 1, // projectPath
        setActiveScheme: 2, // projectPath, schemeName
        getWorkspaceInfo: 1, // projectPath
        getProjects: 1,     // projectPath
        openFile: 2,        // filePath, lineNumber
        openProject: 1      // projectPath
      };

      Object.entries(expectedCounts).forEach(([functionName, expectedCount]) => {
        const actualCount = server[functionName].length;
        expect(actualCount).toBe(expectedCount);
      });
    });
  });

  describe('Critical Function Signature Validation', () => {
    test('run function accepts projectPath as first parameter', () => {
      // This test specifically prevents the "actualProjectPath is not defined" bug
      expect(server.run.length).toBeGreaterThanOrEqual(1);
      
      // Verify function doesn't immediately throw on parameter access
      const functionString = server.run.toString();
      expect(functionString).toContain('projectPath');
      expect(functionString).not.toContain('actualProjectPath');
    });

    test('test function accepts projectPath as first parameter', () => {
      expect(server.test.length).toBeGreaterThanOrEqual(1);
      
      const functionString = server.test.toString();
      expect(functionString).toContain('projectPath');
    });

    test('debug function accepts projectPath as first parameter', () => {
      expect(server.debug.length).toBeGreaterThanOrEqual(1);
      
      const functionString = server.debug.toString();
      expect(functionString).toContain('projectPath');
    });

    test('all tool handler calls match function signatures', () => {
      // Check that the call site mapping in setupToolHandlers matches function signatures
      // This prevents runtime "not defined" errors
      
      const callMappings = [
        { tool: 'xcode_build', method: 'build', args: ['args.path', 'args.scheme', 'args.destination'] },
        { tool: 'xcode_clean', method: 'clean', args: ['args.path'] },
        { tool: 'xcode_test', method: 'test', args: ['args.path', 'args.commandLineArguments'] },
        { tool: 'xcode_build_and_run', method: 'run', args: ['args.path', 'args.commandLineArguments'] },
        { tool: 'xcode_stop', method: 'stop', args: ['args.xcodeproj'] },
        { tool: 'xcode_get_schemes', method: 'getSchemes', args: ['args.path'] },
        { tool: 'xcode_set_active_scheme', method: 'setActiveScheme', args: ['args.path', 'args.schemeName'] },
        { tool: 'xcode_get_run_destinations', method: 'getRunDestinations', args: ['args.path'] },
        { tool: 'xcode_get_workspace_info', method: 'getWorkspaceInfo', args: ['args.path'] },
        { tool: 'xcode_get_projects', method: 'getProjects', args: ['args.path'] },
        { tool: 'xcode_open_file', method: 'openFile', args: ['args.filePath', 'args.lineNumber'] }
      ];

      callMappings.forEach(mapping => {
        const method = server[mapping.method];
        const requiredArgCount = method.length;
        const providedArgCount = mapping.args.length;
        
        expect(providedArgCount).toBeGreaterThanOrEqual(requiredArgCount);
      });
    });
  });

  describe('Variable Reference Validation', () => {
    test('run function does not reference undefined variables', () => {
      const functionString = server.run.toString();
      
      // Should not contain references to undefined variables like actualProjectPath
      expect(functionString).not.toContain('actualProjectPath');
      
      // Should use the parameter name consistently
      if (functionString.includes('getLatestBuildLog')) {
        expect(functionString).toContain('getLatestBuildLog(projectPath');
      }
    });

    test('test function does not reference undefined variables', () => {
      const functionString = server.test.toString();
      expect(functionString).not.toContain('actualProjectPath');
    });

    test('debug function does not reference undefined variables', () => {
      const functionString = server.debug.toString();
      expect(functionString).not.toContain('actualProjectPath');
    });
  });
});
