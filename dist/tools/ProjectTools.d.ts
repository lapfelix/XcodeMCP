import type { McpResult, OpenProjectCallback } from '../types/index.js';
export declare class ProjectTools {
    static ensureXcodeIsRunning(): Promise<McpResult | null>;
    static openProject(projectPath: string): Promise<McpResult>;
    static waitForProjectToLoad(projectPath: string, maxRetries?: number, retryDelayMs?: number): Promise<McpResult | null>;
    static openProjectAndWaitForLoad(projectPath: string): Promise<McpResult>;
    static closeProject(projectPath: string): Promise<McpResult>;
    static getSchemes(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult>;
    static setActiveScheme(projectPath: string, schemeName: string, openProject: OpenProjectCallback): Promise<McpResult>;
    static getRunDestinations(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult>;
    /**
     * Get test targets information from project
     */
    static getTestTargets(projectPath: string): Promise<McpResult>;
}
//# sourceMappingURL=ProjectTools.d.ts.map