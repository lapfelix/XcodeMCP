import { JXAExecutor } from '../utils/JXAExecutor.js';
import PathValidator from '../utils/PathValidator.js';
import { getWorkspaceByPathScript } from '../utils/JXAHelpers.js';
import type { McpResult, OpenProjectCallback } from '../types/index.js';

export class InfoTools {
  public static async getWorkspaceInfo(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
        const info = {
          name: workspace.name(),
          path: workspace.path(),
          loaded: workspace.loaded(),
          activeScheme: workspace.activeScheme() ? workspace.activeScheme().name() : null,
          activeRunDestination: workspace.activeRunDestination() ? workspace.activeRunDestination().name() : null
        };
        
        return JSON.stringify(info, null, 2);
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  public static async getProjects(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
        const projects = workspace.projects();
        const projectInfo = projects.map(project => ({
          name: project.name(),
          id: project.id()
        }));
        
        return JSON.stringify(projectInfo, null, 2);
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  public static async openFile(filePath: string, lineNumber?: number): Promise<McpResult> {
    const validationError = PathValidator.validateFilePath(filePath);
    if (validationError) return validationError;
    
    const script = `
      (function() {
        const app = Application('Xcode');
        app.open(${JSON.stringify(filePath)});
        
        ${lineNumber ? `
        const docs = app.sourceDocuments();
        const doc = docs.find(d => d.path().includes(${JSON.stringify(filePath.split('/').pop())}));
        if (doc) {
          app.hack({document: doc, start: ${lineNumber}, stop: ${lineNumber}});
        }` : ''}
        
        return 'File opened successfully';
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }
}

export default InfoTools;
