import type { McpResult, OpenProjectCallback } from '../types/index.js';
export declare class InfoTools {
    static getWorkspaceInfo(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult>;
    static getProjects(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult>;
    static openFile(filePath: string, lineNumber?: number): Promise<McpResult>;
}
//# sourceMappingURL=InfoTools.d.ts.map