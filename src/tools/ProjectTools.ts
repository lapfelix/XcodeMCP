import { JXAExecutor } from '../utils/JXAExecutor.js';
import { PathValidator } from '../utils/PathValidator.js';
import { ParameterNormalizer } from '../utils/ParameterNormalizer.js';
import { ErrorHelper } from '../utils/ErrorHelper.js';
import type { McpResult, OpenProjectCallback } from '../types/index.js';

export class ProjectTools {
  public static async openProject(projectPath: string): Promise<McpResult> {
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

  public static async getSchemes(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
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

  public static async setActiveScheme(
    projectPath: string, 
    schemeName: string, 
    openProject: OpenProjectCallback
  ): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    // Normalize the scheme name for better matching
    const normalizedSchemeName = ParameterNormalizer.normalizeSchemeName(schemeName);

    const script = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) throw new Error('No active workspace');
        
        const schemes = workspace.schemes();
        const schemeNames = schemes.map(scheme => scheme.name());
        
        // Try exact match first
        let targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(normalizedSchemeName)});
        
        // If not found, try original name
        if (!targetScheme) {
          targetScheme = schemes.find(scheme => scheme.name() === ${JSON.stringify(schemeName)});
        }
        
        if (!targetScheme) {
          throw new Error('Scheme not found. Available: ' + JSON.stringify(schemeNames));
        }
        
        workspace.activeScheme = targetScheme;
        return 'Active scheme set to: ' + targetScheme.name();
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      const enhancedError = ErrorHelper.parseCommonErrors(error as Error);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('not found')) {
        try {
          // Extract available schemes from error message if present
          let availableSchemes: string[] = [];
          if (errorMessage.includes('Available:')) {
            const availablePart = errorMessage.split('Available: ')[1];
            // Find the JSON array part
            const jsonMatch = availablePart?.match(/\[.*?\]/);
            if (jsonMatch) {
              availableSchemes = JSON.parse(jsonMatch[0]);
            }
          }
            
          // Try to find a close match with fuzzy matching
          const bestMatch = ParameterNormalizer.findBestMatch(schemeName, availableSchemes);
          let guidance = ErrorHelper.getSchemeNotFoundGuidance(schemeName, availableSchemes);
          
          if (bestMatch && bestMatch !== schemeName) {
            guidance += `\n• Did you mean '${bestMatch}'?`;
          }
          
          return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Scheme '${schemeName}' not found`, guidance) }] };
        } catch {
          return { content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Scheme '${schemeName}' not found`, ErrorHelper.getSchemeNotFoundGuidance(schemeName)) }] };
        }
      }
      
      return { content: [{ type: 'text', text: `Failed to set active scheme: ${errorMessage}` }] };
    }
  }

  public static async getRunDestinations(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
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