import type { McpResult } from '../types/index.js';
export declare class PathValidator {
    /**
     * Resolve relative paths to absolute paths and validate project path
     */
    static resolveAndValidateProjectPath(projectPath: string, parameterName?: string): {
        resolvedPath: string;
        error: McpResult | null;
    };
    static validateProjectPath(projectPath: string, parameterName?: string): McpResult | null;
    static validateFilePath(filePath: string): McpResult | null;
}
//# sourceMappingURL=PathValidator.d.ts.map