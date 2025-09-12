import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { EnvironmentValidation, McpResult } from './types/index.js';
export declare class XcodeServer {
    server: Server;
    currentProjectPath: string | null;
    private environmentValidation;
    private isValidated;
    private canOperateInDegradedMode;
    private includeClean;
    constructor(options?: {
        includeClean?: boolean;
    });
    /**
     * Validates the environment and sets up the server accordingly
     */
    validateEnvironment(): Promise<EnvironmentValidation>;
    /**
     * Checks if a tool operation should be blocked due to environment issues
     */
    validateToolOperation(toolName: string): Promise<McpResult | null>;
    /**
     * Determines tool limitations based on environment validation
     */
    private getToolLimitations;
    /**
     * Enhances error messages with configuration guidance
     */
    enhanceErrorWithGuidance(error: Error | {
        message?: string;
    }, _toolName: string): Promise<string | null>;
    private setupToolHandlers;
    openProject(projectPath: string): Promise<McpResult>;
    executeJXA(script: string): Promise<string>;
    validateProjectPath(projectPath: string): McpResult | null;
    findProjectDerivedData(projectPath: string): Promise<string | null>;
    getLatestBuildLog(projectPath: string): Promise<import("./types/index.js").BuildLogInfo | null>;
    build(projectPath: string, schemeName?: string, destination?: string | null): Promise<import('./types/index.js').McpResult>;
    clean(projectPath: string): Promise<import('./types/index.js').McpResult>;
    test(projectPath: string, destination: string, commandLineArguments?: string[]): Promise<import('./types/index.js').McpResult>;
    run(projectPath: string, commandLineArguments?: string[]): Promise<import('./types/index.js').McpResult>;
    debug(projectPath: string, scheme: string, skipBuilding?: boolean): Promise<import('./types/index.js').McpResult>;
    stop(projectPath?: string): Promise<import('./types/index.js').McpResult>;
    getSchemes(projectPath: string): Promise<import('./types/index.js').McpResult>;
    getRunDestinations(projectPath: string): Promise<import('./types/index.js').McpResult>;
    setActiveScheme(projectPath: string, schemeName: string): Promise<import('./types/index.js').McpResult>;
    getWorkspaceInfo(projectPath: string): Promise<import('./types/index.js').McpResult>;
    getProjects(projectPath: string): Promise<import('./types/index.js').McpResult>;
    openFile(filePath: string, lineNumber?: number): Promise<import('./types/index.js').McpResult>;
    parseBuildLog(logPath: string, retryCount?: number, maxRetries?: number): Promise<import("./types/index.js").ParsedBuildResults>;
    canParseLog(logPath: string): Promise<boolean>;
    getCustomDerivedDataLocationFromXcodePreferences(): Promise<string | null>;
    /**
     * Call a tool directly without going through the MCP protocol
     * This is used by the CLI to bypass the JSON-RPC layer
     */
    callToolDirect(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
}
//# sourceMappingURL=XcodeServer.d.ts.map