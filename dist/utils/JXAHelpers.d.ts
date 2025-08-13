/**
 * Helper functions for JXA workspace operations
 */
/**
 * Generate JXA script to get workspace by path instead of using activeWorkspaceDocument
 * This allows targeting specific workspaces when multiple are open
 *
 * @param projectPath - The path to the .xcodeproj or .xcworkspace file
 * @returns JXA script snippet to get the workspace
 */
export declare function getWorkspaceByPathScript(projectPath: string): string;
/**
 * Generate JXA script that tries to get workspace by path, falling back to active if only one is open
 * This provides backward compatibility for single-workspace scenarios
 *
 * @param projectPath - The path to the .xcodeproj or .xcworkspace file (optional)
 * @returns JXA script snippet to get the workspace
 */
export declare function getWorkspaceWithFallbackScript(projectPath?: string): string;
//# sourceMappingURL=JXAHelpers.d.ts.map