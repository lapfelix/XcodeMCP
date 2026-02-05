export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
}
/**
 * Get all tool definitions shared between CLI and MCP
 *
 * @param options.sidekickOnly - When true, only returns tools that complement Apple's official
 *   Xcode MCP (project management and XCResult inspection tools). Excludes build/run/test/debug tools.
 */
export declare function getToolDefinitions(options?: {
    includeClean?: boolean;
    preferredScheme?: string;
    preferredXcodeproj?: string;
    sidekickOnly?: boolean;
}): ToolDefinition[];
//# sourceMappingURL=toolDefinitions.d.ts.map