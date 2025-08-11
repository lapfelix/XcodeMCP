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
export function getWorkspaceByPathScript(projectPath: string): string {
  if (!projectPath) {
    throw new Error('projectPath is required for workspace finding');
  }
  
  const workspacePath = projectPath.replace('.xcodeproj', '.xcworkspace');
  const projectOnlyPath = projectPath.replace('.xcworkspace', '.xcodeproj');
  
  return `
    const app = Application('Xcode');
    const documents = app.workspaceDocuments();
    
    // Find the workspace document matching the target path
    let workspace = null;
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const docPath = doc.path();
      
      // Match exact path or handle .xcodeproj vs .xcworkspace differences
      if (docPath === ${JSON.stringify(projectPath)} || 
          docPath === ${JSON.stringify(workspacePath)} ||
          docPath === ${JSON.stringify(projectOnlyPath)}) {
        workspace = doc;
        break;
      }
    }
    
    if (!workspace) {
      throw new Error('Workspace not found for path: ' + ${JSON.stringify(projectPath)} + '. Open workspaces: ' + documents.map(d => d.path()).join(', '));
    }
  `;
}

/**
 * Generate JXA script that tries to get workspace by path, falling back to active if only one is open
 * This provides backward compatibility for single-workspace scenarios
 * 
 * @param projectPath - The path to the .xcodeproj or .xcworkspace file (optional)
 * @returns JXA script snippet to get the workspace
 */
export function getWorkspaceWithFallbackScript(projectPath?: string): string {
  if (!projectPath) {
    // No path provided, use active workspace (backward compatibility)
    return `
      const app = Application('Xcode');
      const workspace = app.activeWorkspaceDocument();
      if (!workspace) throw new Error('No active workspace');
    `;
  }
  
  return `
    const app = Application('Xcode');
    const documents = app.workspaceDocuments();
    
    // If only one workspace is open, use it (backward compatibility)
    if (documents.length === 1) {
      const workspace = documents[0];
    } else {
      // Multiple workspaces open, find the right one
      let workspace = null;
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const docPath = doc.path();
        
        if (docPath === ${JSON.stringify(projectPath)} || 
            docPath === ${JSON.stringify(projectPath.replace('.xcodeproj', '.xcworkspace'))} ||
            docPath === ${JSON.stringify(projectPath.replace('.xcworkspace', '.xcodeproj'))}) {
          workspace = doc;
          break;
        }
      }
      
      if (!workspace) {
        throw new Error('Workspace not found for path: ' + ${JSON.stringify(projectPath)} + '. Open workspaces: ' + documents.map(d => d.path()).join(', '));
      }
    }
  `;
}