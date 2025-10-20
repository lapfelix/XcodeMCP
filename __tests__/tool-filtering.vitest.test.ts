import { describe, it, expect, beforeEach } from 'vitest';
import { getToolDefinitions } from '../src/shared/toolDefinitions.js';
import { XcodeServer } from '../src/XcodeServer.js';

describe('Tool Filtering', () => {
  describe('--no-clean flag (includeClean option)', () => {
    it('should include xcode_clean by default', () => {
      const tools = getToolDefinitions({});

      const cleanTool = tools.find(t => t.name === 'xcode_clean');
      expect(cleanTool).toBeDefined();
      expect(cleanTool!.name).toBe('xcode_clean');
    });

    it('should include xcode_clean when includeClean is true', () => {
      const tools = getToolDefinitions({
        includeClean: true
      });

      const cleanTool = tools.find(t => t.name === 'xcode_clean');
      expect(cleanTool).toBeDefined();
    });

    it('should exclude xcode_clean when includeClean is false', () => {
      const tools = getToolDefinitions({
        includeClean: false
      });

      const cleanTool = tools.find(t => t.name === 'xcode_clean');
      expect(cleanTool).toBeUndefined();
    });

    it('should place xcode_clean at the correct position in the tools array', () => {
      const tools = getToolDefinitions({
        includeClean: true
      });

      // xcode_clean should be at index 5 (after set_active_scheme, before test)
      const cleanToolIndex = tools.findIndex(t => t.name === 'xcode_clean');
      expect(cleanToolIndex).toBe(5);

      // Verify the tools around it
      expect(tools[4].name).toBe('xcode_set_active_scheme');
      expect(tools[6].name).toBe('xcode_test');
    });
  });

  describe('--allowed-tools flag (tool whitelist)', () => {
    it('should return all tools when allowedTools is not provided', () => {
      const allTools = getToolDefinitions({});
      const filteredTools = getToolDefinitions({
        allowedTools: undefined
      });

      expect(filteredTools.length).toBe(allTools.length);
    });

    it('should return all tools when allowedTools is empty array', () => {
      const allTools = getToolDefinitions({});
      const filteredTools = getToolDefinitions({
        allowedTools: []
      });

      expect(filteredTools.length).toBe(allTools.length);
    });

    it('should filter to only allowed tools', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_build', 'xcode_test']
      });

      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name)).toEqual(['xcode_build', 'xcode_test']);
    });

    it('should filter to a single tool', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_build']
      });

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('xcode_build');
    });

    it('should handle multiple tools in whitelist', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_build', 'xcode_test', 'xcode_get_schemes', 'xcode_open_project']
      });

      expect(tools.length).toBe(4);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('xcode_build');
      expect(toolNames).toContain('xcode_test');
      expect(toolNames).toContain('xcode_get_schemes');
      expect(toolNames).toContain('xcode_open_project');
    });

    it('should return empty array when no tools match whitelist', () => {
      const tools = getToolDefinitions({
        allowedTools: ['nonexistent_tool']
      });

      expect(tools.length).toBe(0);
    });

    it('should ignore non-existent tools in whitelist', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_build', 'nonexistent_tool', 'xcode_test']
      });

      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name)).toEqual(['xcode_build', 'xcode_test']);
    });

    it('should maintain original tool order when filtering', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_test', 'xcode_build', 'xcode_open_project']
      });

      // Tools should appear in their original definition order, not whitelist order
      expect(tools[0].name).toBe('xcode_open_project');  // Original position 0
      expect(tools[1].name).toBe('xcode_build');         // Original position 2
      expect(tools[2].name).toBe('xcode_test');          // Original position 5 or 6
    });
  });

  describe('Combining --no-clean with --allowed-tools', () => {
    it('should exclude xcode_clean from filtered tools when includeClean is false', () => {
      const tools = getToolDefinitions({
        includeClean: false,
        allowedTools: ['xcode_build', 'xcode_test', 'xcode_clean']
      });

      // xcode_clean should not be in the filtered list even though it's in allowedTools
      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name)).toEqual(['xcode_build', 'xcode_test']);
    });

    it('should include xcode_clean in filtered tools when includeClean is true and in whitelist', () => {
      const tools = getToolDefinitions({
        includeClean: true,
        allowedTools: ['xcode_build', 'xcode_clean', 'xcode_test']
      });

      expect(tools.length).toBe(3);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('xcode_clean');
      expect(toolNames).toContain('xcode_build');
      expect(toolNames).toContain('xcode_test');
    });

    it('should exclude xcode_clean from filtered tools when not in whitelist even if includeClean is true', () => {
      const tools = getToolDefinitions({
        includeClean: true,
        allowedTools: ['xcode_build', 'xcode_test']
      });

      expect(tools.length).toBe(2);
      expect(tools.map(t => t.name)).toEqual(['xcode_build', 'xcode_test']);
    });
  });

  describe('Combining with preferred values', () => {
    it('should apply preferred values to filtered tools', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_build', 'xcode_test'],
        preferredXcodeproj: 'MyApp.xcodeproj',
        preferredScheme: 'MyScheme'
      });

      expect(tools.length).toBe(2);

      const buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool).toBeDefined();
      expect(buildTool!.inputSchema.required).toEqual([]);
      expect(buildTool!.inputSchema.properties.xcodeproj.description).toContain('defaults to MyApp.xcodeproj');
      expect(buildTool!.inputSchema.properties.scheme.description).toContain('defaults to MyScheme');

      const testTool = tools.find(t => t.name === 'xcode_test');
      expect(testTool).toBeDefined();
      expect(testTool!.inputSchema.required).toEqual(['destination']);
      expect(testTool!.inputSchema.properties.xcodeproj.description).toContain('defaults to MyApp.xcodeproj');
    });
  });

  describe('XcodeServer initialization', () => {
    let server: XcodeServer;

    beforeEach(() => {
      // Reset any previous instances
    });

    it('should initialize with includeClean option', () => {
      server = new XcodeServer({
        includeClean: false
      });

      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should initialize with allowedTools option', () => {
      server = new XcodeServer({
        allowedTools: ['xcode_build', 'xcode_test']
      });

      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should initialize with both includeClean and allowedTools', () => {
      server = new XcodeServer({
        includeClean: false,
        allowedTools: ['xcode_build', 'xcode_test']
      });

      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should initialize with all options combined', () => {
      server = new XcodeServer({
        includeClean: true,
        allowedTools: ['xcode_build', 'xcode_test', 'xcode_clean'],
        preferredScheme: 'MyScheme',
        preferredXcodeproj: 'MyProject.xcodeproj'
      });

      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });
  });

  describe('Real-world scenarios', () => {
    it('should support minimal testing workflow', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_test', 'xcode_get_schemes', 'xcode_open_project'],
        preferredXcodeproj: 'MyApp.xcodeproj'
      });

      expect(tools.length).toBe(3);
      expect(tools.map(t => t.name)).toEqual([
        'xcode_open_project',
        'xcode_get_schemes',
        'xcode_test'
      ]);

      // All should have preferred xcodeproj
      tools.forEach(tool => {
        if (tool.inputSchema.properties.xcodeproj) {
          expect(tool.inputSchema.properties.xcodeproj.description).toContain('defaults to MyApp.xcodeproj');
        }
      });
    });

    it('should support minimal build workflow', () => {
      const tools = getToolDefinitions({
        allowedTools: ['xcode_build', 'xcode_open_project'],
        preferredXcodeproj: 'MyApp.xcodeproj',
        preferredScheme: 'MyScheme'
      });

      expect(tools.length).toBe(2);

      const buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool).toBeDefined();
      expect(buildTool!.inputSchema.required).toEqual([]);
    });

    it('should support XCResult analysis workflow', () => {
      const tools = getToolDefinitions({
        allowedTools: [
          'find_xcresults',
          'xcresult_browse',
          'xcresult_summary',
          'xcresult_get_screenshot'
        ]
      });

      expect(tools.length).toBe(4);
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('find_xcresults');
      expect(toolNames).toContain('xcresult_browse');
      expect(toolNames).toContain('xcresult_summary');
      expect(toolNames).toContain('xcresult_get_screenshot');
    });
  });
});
