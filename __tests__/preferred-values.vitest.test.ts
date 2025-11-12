import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolDefinitions } from '../src/shared/toolDefinitions.js';
import { XcodeServer } from '../src/XcodeServer.js';

describe('Preferred Values', () => {
  describe('Tool Definitions', () => {
    it('should make xcodeproj optional when preferredXcodeproj is provided', () => {
      const tools = getToolDefinitions({
        preferredXcodeproj: 'MyApp.xcodeproj'
      });
      
      const buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool).toBeDefined();
      expect(buildTool!.inputSchema.required).not.toContain('xcodeproj');
      expect(buildTool!.inputSchema.required).toContain('reason');
      expect(buildTool!.inputSchema.properties.xcodeproj.description).toContain('defaults to MyApp.xcodeproj');
    });

    it('should make scheme optional when preferredScheme is provided', () => {
      const tools = getToolDefinitions({
        preferredScheme: 'MyAppScheme'
      });
      
      const buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool).toBeDefined();
      expect(buildTool!.inputSchema.required).not.toContain('scheme');
      expect(buildTool!.inputSchema.required).toContain('reason');
      expect(buildTool!.inputSchema.properties.scheme.description).toContain('defaults to MyAppScheme');
    });

    it('should make both optional when both preferred values are provided', () => {
      const tools = getToolDefinitions({
        preferredXcodeproj: 'MyApp.xcodeproj',
        preferredScheme: 'MyAppScheme'
      });
      
      const buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool).toBeDefined();
      expect(buildTool!.inputSchema.required).toEqual(['reason']);
      expect(buildTool!.inputSchema.properties.xcodeproj.description).toContain('defaults to MyApp.xcodeproj');
      expect(buildTool!.inputSchema.properties.scheme.description).toContain('defaults to MyAppScheme');
    });

    it('should keep parameters required when no preferred values are provided', () => {
      const tools = getToolDefinitions({});
      
      const buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool).toBeDefined();
      expect(buildTool!.inputSchema.required).toContain('reason');
      expect(buildTool!.inputSchema.required).toContain('xcodeproj');
      expect(buildTool!.inputSchema.required).toContain('scheme');
      expect(buildTool!.inputSchema.properties.xcodeproj.description).not.toContain('defaults to');
      expect(buildTool!.inputSchema.properties.scheme.description).not.toContain('defaults to');
    });

    it('should update descriptions for all tools that use xcodeproj', () => {
      const tools = getToolDefinitions({
        preferredXcodeproj: 'MyApp.xcodeproj'
      });
      
      const toolsWithXcodeproj = [
        'xcode_build',
        'xcode_get_schemes',
        'xcode_set_active_scheme',
        'xcode_test',
        'xcode_build_and_run',
        'xcode_release_lock',
        'xcode_stop',
        'xcode_find_xcresults',
        'xcode_get_run_destinations',
        'xcode_get_workspace_info',
        'xcode_get_projects'
      ];
      
      toolsWithXcodeproj.forEach(toolName => {
        const tool = tools.find(t => t.name === toolName);
        expect(tool, `Tool ${toolName} should exist`).toBeDefined();
        if (tool && tool.inputSchema.properties.xcodeproj) {
          expect(tool.inputSchema.properties.xcodeproj.description, `Tool ${toolName} should have updated description`).toContain('defaults to MyApp.xcodeproj');
          
          // Most tools should have xcodeproj not required when preferred value is set
          if (toolName !== 'xcode_set_active_scheme') {  // This one still requires scheme_name
            expect(tool.inputSchema.required).not.toContain('xcodeproj');
          }
        }
      });
    });

    it('should handle xcode_clean when includeClean is true', () => {
      const tools = getToolDefinitions({
        includeClean: true,
        preferredXcodeproj: 'MyApp.xcodeproj'
      });
      
      const cleanTool = tools.find(t => t.name === 'xcode_clean');
      expect(cleanTool).toBeDefined();
      expect(cleanTool!.inputSchema.required).toEqual([]);
      expect(cleanTool!.inputSchema.properties.xcodeproj.description).toContain('defaults to MyApp.xcodeproj');
    });

    it('should not include xcode_clean when includeClean is false', () => {
      const tools = getToolDefinitions({
        includeClean: false,
        preferredXcodeproj: 'MyApp.xcodeproj'
      });
      
      const cleanTool = tools.find(t => t.name === 'xcode_clean');
      expect(cleanTool).toBeUndefined();
    });
  });

  describe('XcodeServer', () => {
    let server: XcodeServer;

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should store preferred values when initialized', () => {
      server = new XcodeServer({
        preferredScheme: 'MyScheme',
        preferredXcodeproj: 'MyProject.xcodeproj'
      });
      
      // Check that the server was created successfully
      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should work without preferred values', () => {
      server = new XcodeServer({});
      
      // Check that the server was created successfully
      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should handle only preferredScheme', () => {
      server = new XcodeServer({
        preferredScheme: 'MyScheme'
      });
      
      // Check that the server was created successfully
      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });

    it('should handle only preferredXcodeproj', () => {
      server = new XcodeServer({
        preferredXcodeproj: 'MyProject.xcodeproj'
      });
      
      // Check that the server was created successfully
      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });
  });

  describe('Tool Parameter Required Arrays', () => {
    it('should correctly build required array for xcode_build', () => {
      // No preferred values - both required
      let tools = getToolDefinitions({});
      let buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool!.inputSchema.required).toEqual(['reason', 'xcodeproj', 'scheme']);

      // Only preferred xcodeproj - scheme still required
      tools = getToolDefinitions({ preferredXcodeproj: 'MyApp.xcodeproj' });
      buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool!.inputSchema.required).toEqual(['reason', 'scheme']);

      // Only preferred scheme - xcodeproj still required
      tools = getToolDefinitions({ preferredScheme: 'MyScheme' });
      buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool!.inputSchema.required).toEqual(['reason', 'xcodeproj']);

      // Both preferred - nothing required
      tools = getToolDefinitions({ 
        preferredXcodeproj: 'MyApp.xcodeproj',
        preferredScheme: 'MyScheme'
      });
      buildTool = tools.find(t => t.name === 'xcode_build');
      expect(buildTool!.inputSchema.required).toEqual(['reason']);
    });

    it('should correctly build required array for xcode_test', () => {
      // No preferred values - xcodeproj and scheme required
      let tools = getToolDefinitions({});
      let testTool = tools.find(t => t.name === 'xcode_test');
      expect(testTool!.inputSchema.required).toEqual(['xcodeproj', 'scheme']);

      // With preferred xcodeproj - only scheme required
      tools = getToolDefinitions({ preferredXcodeproj: 'MyApp.xcodeproj' });
      testTool = tools.find(t => t.name === 'xcode_test');
      expect(testTool!.inputSchema.required).toEqual(['scheme']);
    });

  it('should correctly handle xcode_set_active_scheme', () => {
      // No preferred values - both required
      let tools = getToolDefinitions({});
      let schemeTool = tools.find(t => t.name === 'xcode_set_active_scheme');
      expect(schemeTool!.inputSchema.required).toEqual(['xcodeproj', 'scheme_name']);

      // With preferred xcodeproj - only scheme_name required
      tools = getToolDefinitions({ preferredXcodeproj: 'MyApp.xcodeproj' });
      schemeTool = tools.find(t => t.name === 'xcode_set_active_scheme');
      expect(schemeTool!.inputSchema.required).toEqual(['scheme_name']);
    });
  });
});
