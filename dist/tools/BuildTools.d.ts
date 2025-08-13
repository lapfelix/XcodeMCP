import type { McpResult, OpenProjectCallback } from '../types/index.js';
export declare class BuildTools {
    static build(projectPath: string, schemeName: string, destination: string | null | undefined, openProject: OpenProjectCallback): Promise<McpResult>;
    static clean(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult>;
    static test(projectPath: string, destination: string, commandLineArguments: string[] | undefined, openProject: OpenProjectCallback, options?: {
        testPlanPath?: string;
        selectedTests?: string[];
        selectedTestClasses?: string[];
        testTargetIdentifier?: string;
        testTargetName?: string;
    }): Promise<McpResult>;
    /**
     * Helper method to restore test plan and return result
     */
    private static _restoreTestPlanAndReturn;
    static run(projectPath: string, schemeName: string, commandLineArguments: string[] | undefined, openProject: OpenProjectCallback): Promise<McpResult>;
    static debug(projectPath: string, scheme?: string, skipBuilding?: boolean, openProject?: OpenProjectCallback): Promise<McpResult>;
    static stop(projectPath: string): Promise<McpResult>;
    private static _getAvailableSchemes;
    private static _getAvailableDestinations;
    private static _findXCResultFiles;
    private static _findNewXCResultFile;
    /**
     * Find XCResult files for a given project
     */
    static findXCResults(projectPath: string): Promise<McpResult>;
    private static _getTimeAgo;
    private static _formatFileSize;
    /**
     * Handle alerts that appear when starting builds/tests while another operation is in progress.
     * This includes "replace existing build" alerts and similar dialog overlays.
     */
    private static _handleReplaceExistingBuildAlert;
}
//# sourceMappingURL=BuildTools.d.ts.map