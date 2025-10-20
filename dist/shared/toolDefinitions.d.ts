export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
}
/**
 * Get all tool definitions shared between CLI and MCP
 */
export declare function getToolDefinitions(options?: {
    includeClean?: boolean;
    preferredScheme?: string;
    preferredXcodeproj?: string;
    allowedTools?: string[];
}): ToolDefinition[];
//# sourceMappingURL=toolDefinitions.d.ts.map