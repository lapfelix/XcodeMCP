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

  public static async waitForProjectToLoad(maxRetries: number = 30, retryDelayMs: number = 1000): Promise<McpResult | null> {
    const checkScript = `
      (function() {
        try {
          const app = Application('Xcode');
          const workspace = app.activeWorkspaceDocument();
          if (!workspace) {
            return JSON.stringify({ loaded: false, reason: 'No active workspace' });
          }
          
          // Try to access schemes - this will fail if project is still loading
          const schemes = workspace.schemes();
          if (schemes.length === 0) {
            return JSON.stringify({ loaded: false, reason: 'Schemes not loaded yet' });
          }
          
          // Try to access destinations - this might also fail during loading
          const destinations = workspace.runDestinations();
          
          return JSON.stringify({ loaded: true, schemes: schemes.length, destinations: destinations.length });
        } catch (error) {
          return JSON.stringify({ loaded: false, reason: error.message });
        }
      })()
    `;

    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const result = await JXAExecutor.execute(checkScript);
        const status = JSON.parse(result);
        
        if (status.loaded) {
          return null; // Success - project is loaded
        }
        
        if (retry === maxRetries - 1) {
          return {
            content: [{
              type: 'text',
              text: `❌ Project failed to load after ${maxRetries} attempts (${maxRetries * retryDelayMs / 1000}s)\n\nLast status: ${status.reason}\n\n💡 Try:\n• Manually opening the project in Xcode\n• Checking if the project file is corrupted\n• Ensuring sufficient system resources`
            }]
          };
        }
        
        // Wait before next retry
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      } catch (error) {
        if (retry === maxRetries - 1) {
          return {
            content: [{
              type: 'text',
              text: `❌ Failed to check project loading status: ${error instanceof Error ? error.message : String(error)}`
            }]
          };
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
    
    return null; // This shouldn't be reached
  }

  public static async openProjectAndWaitForLoad(projectPath: string): Promise<McpResult> {
    // First check if project is already open and loaded
    try {
      const checkScript = `
        (function() {
          try {
            const app = Application('Xcode');
            const workspace = app.activeWorkspaceDocument();
            if (!workspace) {
              return JSON.stringify({ isOpen: false });
            }
            
            // Check if it's the right project
            const workspacePath = workspace.path();
            if (workspacePath === ${JSON.stringify(projectPath)}) {
              // Try to access schemes to see if it's fully loaded
              const schemes = workspace.schemes();
              return JSON.stringify({ isOpen: true, isLoaded: schemes.length > 0 });
            }
            
            return JSON.stringify({ isOpen: false, differentProject: workspacePath });
          } catch (error) {
            return JSON.stringify({ isOpen: false, error: error.message });
          }
        })()
      `;
      
      const result = await JXAExecutor.execute(checkScript);
      const status = JSON.parse(result);
      
      if (status.isOpen && status.isLoaded) {
        return { content: [{ type: 'text', text: 'Project is already open and loaded' }] };
      }
    } catch (error) {
      // Continue with opening the project
    }

    // Open the project
    const openResult = await this.openProject(projectPath);
    if (openResult.content?.[0]?.type === 'text' && openResult.content[0].text.includes('Error')) {
      return openResult;
    }

    // Wait for the project to load
    const waitResult = await this.waitForProjectToLoad();
    if (waitResult) {
      return waitResult;
    }

    return { content: [{ type: 'text', text: 'Project opened and loaded successfully' }] };
  }

  public static async closeProject(): Promise<McpResult> {
    // Step 1: Stop any running tasks and handle stop dialogs
    const stopScript = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) {
          return 'No active workspace to close';
        }
        
        // Stop any running actions
        try {
          workspace.stop();
          return 'Tasks stopped successfully';
        } catch (error) {
          return 'No tasks were running';
        }
      })()
    `;
    
    try {
      await JXAExecutor.execute(stopScript);
    } catch (error) {
      // Continue even if stop fails
    }
    
    // Step 2: Handle any "Stop Tasks" dialogs that might appear
    const handleStopDialogScript = `
      (function() {
        const systemEvents = Application('System Events');
        systemEvents.includeStandardAdditions = false;
        
        try {
          const xcodeProcess = systemEvents.processes.byName('Xcode');
          const windows = xcodeProcess.windows();
          
          for (let i = 0; i < windows.length; i++) {
            const window = windows[i];
            try {
              // Check both description and subrole for dialogs
              const isDialog = window.description() === 'alert' || window.subrole() === 'AXDialog';
              if (isDialog) {
                const buttons = window.buttons();
                const buttonNames = [];
                for (let j = 0; j < buttons.length; j++) {
                  const button = buttons[j];
                  const buttonName = button.name();
                  buttonNames.push(buttonName);
                  if (buttonName === 'Stop Tasks') {
                    button.click();
                    delay(1); // Wait longer for dialog to close
                    return 'Stop Tasks dialog handled successfully';
                  }
                }
                return 'Dialog found with buttons: ' + buttonNames.join(', ') + ' - but no Stop Tasks button';
              }
            } catch (windowError) {
              // Continue to next window if this one fails
            }
          }
          return 'No Stop Tasks dialog found';
        } catch (error) {
          return 'Could not check for dialogs: ' + error.message;
        }
      })()
    `;
    
    try {
      await JXAExecutor.execute(handleStopDialogScript);
    } catch (error) {
      // Continue even if dialog handling fails
    }
    
    // Step 3: Close the project with timeout protection
    const closeScript = `
      (function() {
        const app = Application('Xcode');
        const workspace = app.activeWorkspaceDocument();
        if (!workspace) {
          return 'No workspace to close (already closed?)';
        }
        
        // Try to close without saving first
        try {
          workspace.close({ saving: false });
          return 'Project closed successfully without saving';
        } catch (error) {
          // If that fails, try regular close but with a non-blocking approach
          try {
            workspace.close();
            return 'Project close initiated';
          } catch (closeError) {
            return 'Failed to close project: ' + closeError.message;
          }
        }
      })()
    `;
    
    try {
      // Use a shorter timeout for the close operation to avoid hanging
      const result = await Promise.race([
        JXAExecutor.execute(closeScript),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Close operation timed out - may need manual dialog interaction')), 5000)
        )
      ]);
      return { content: [{ type: 'text', text: result as string }] };
    } catch (error) {
      // If close times out, try to handle any remaining dialogs
      const handleCloseDialogScript = `
        (function() {
          const systemEvents = Application('System Events');
          systemEvents.includeStandardAdditions = false;
          
          try {
            const xcodeProcess = systemEvents.processes.byName('Xcode');
            const windows = xcodeProcess.windows();
            
            for (let i = 0; i < windows.length; i++) {
              const window = windows[i];
              try {
                // Check for both alert dialogs and standard dialogs
                const isDialog = window.description() === 'alert' || window.subrole() === 'AXDialog';
                if (isDialog) {
                  const buttons = window.buttons();
                  const buttonNames = [];
                  for (let j = 0; j < buttons.length; j++) {
                    const button = buttons[j];
                    const buttonName = button.name();
                    buttonNames.push(buttonName);
                    
                    // Check for various close-related buttons
                    if (buttonName === "Don't Save" || 
                        buttonName === "Discard Changes" || 
                        buttonName === "Close" ||
                        buttonName === "Stop Tasks") {
                      button.click();
                      return 'Dialog handled - clicked: ' + buttonName;
                    }
                  }
                  return 'Dialog found with buttons: ' + buttonNames.join(', ') + ' - no suitable button found';
                }
              } catch (windowError) {
                // Continue to next window if this one fails
              }
            }
            return 'No close dialog found';
          } catch (error) {
            return 'Could not handle close dialog: ' + error.message;
          }
        })()
      `;
      
      try {
        const dialogResult = await JXAExecutor.execute(handleCloseDialogScript);
        return { content: [{ type: 'text', text: `Close operation completed with dialog handling: ${dialogResult}` }] };
      } catch (dialogError) {
        return { content: [{ type: 'text', text: `Close operation may have completed (timeout after 5s). Error: ${error instanceof Error ? error.message : String(error)}` }] };
      }
    }
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