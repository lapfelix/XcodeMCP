import { EventEmitter } from 'events';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export interface SseEvent {
    type: string;
    data: any;
}
export interface CallToolOptions {
    onEvent?: (event: SseEvent) => void;
}
export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
}
export declare class McpLibrary extends EventEmitter {
    private initialized;
    private cliPath;
    constructor();
    /**
     * Initialize the MCP library if not already initialized
     */
    private initialize;
    /**
     * Get all available tools with their schemas
     */
    getTools(): Promise<ToolDefinition[]>;
    /**
     * Spawn CLI subprocess and execute command
     */
    private spawnCli;
    /**
     * Call a tool with the given name and arguments
     * This spawns the CLI subprocess to execute the tool
     */
    callTool(name: string, args?: Record<string, unknown>, options?: CallToolOptions): Promise<CallToolResult>;
    /**
     * Get CLI path (for advanced use cases)
     */
    getCliPath(): string;
}
/**
 * Get or create the default MCP library instance
 */
export declare function getDefaultLibrary(): McpLibrary;
/**
 * Call a tool using the default library instance
 */
export declare function callTool(name: string, args?: Record<string, unknown>, options?: CallToolOptions): Promise<CallToolResult>;
/**
 * Get all available tools using the default library instance
 */
export declare function getTools(): Promise<ToolDefinition[]>;
//# sourceMappingURL=index.d.ts.map