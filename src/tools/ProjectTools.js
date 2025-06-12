import { JXAExecutor } from '../utils/JXAExecutor.js';
import { PathValidator } from '../utils/PathValidator.js';

export class ProjectTools {
  static async openProject(projectPath) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;
    
    const script = `
      const app = Application('Xcode');
      app.open(${JSON.stringify(projectPath)});
      'Project opened successfully';
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  static async getSchemes(projectPath, openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const activeScheme = workspace.activeScheme();
        
        const schemeInfo = schemes.map(scheme => ({
          name: scheme.name(),
          id: scheme.id(),
          isActive: activeScheme && scheme.id() === activeScheme.id()
        }));
        
        return JSON.stringify(schemeInfo, null, 2);
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  static async setActiveScheme(projectPath, schemeName, openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
        
        if (!targetScheme) {
          throw new Error('Scheme ' + ${JSON.stringify(schemeName)} + ' not found');
        }
        
        workspace.activeScheme = targetScheme;
        return 'Active scheme set to: ' + ${JSON.stringify(schemeName)};
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }

  static async getRunDestinations(projectPath, openProject) {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const destinations = workspace.runDestinations();
        const activeDestination = workspace.activeRunDestination();
        
        const destInfo = destinations.map(dest => ({
          name: dest.name(),
          platform: dest.platform(),
          architecture: dest.architecture(),
          isActive: activeDestination && dest.name() === activeDestination.name()
        }));
        
        return JSON.stringify(destInfo, null, 2);
      })()
    `;
    
    const result = await JXAExecutor.execute(script);
    return { content: [{ type: 'text', text: result }] };
  }
}