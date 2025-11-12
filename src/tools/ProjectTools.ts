import { JXAExecutor } from '../utils/JXAExecutor.js';
import PathValidator from '../utils/PathValidator.js';
import { ParameterNormalizer } from '../utils/ParameterNormalizer.js';
import ErrorHelper from '../utils/ErrorHelper.js';
import { getWorkspaceByPathScript } from '../utils/JXAHelpers.js';
import type { McpResult, OpenProjectCallback } from '../types/index.js';

export class ProjectTools {
  public static async ensureXcodeIsRunning(): Promise<McpResult | null> {
    // First check if Xcode is already running
    const checkScript = `
      (function() {
        try {
          const app = Application('Xcode');
          if (app.running()) {
            return 'Xcode is already running';
          } else {
            return 'Xcode is not running';
          }
        } catch (error) {
          return 'Xcode is not running: ' + error.message;
        }
      })()
    `;
    
    try {
      const checkResult = await JXAExecutor.execute(checkScript);
      if (checkResult.includes('already running')) {
        return null; // All good, Xcode is running
      }
    } catch (error) {
      // Continue to launch Xcode
    }
    
    // Get the Xcode path from xcode-select
    let xcodePath: string;
    try {
      const { spawn } = await import('child_process');
      const xcodeSelectResult = await new Promise<string>((resolve, reject) => {
        const process = spawn('xcode-select', ['-p']);
        let stdout = '';
        let stderr = '';
        
        process.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        process.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        process.on('close', (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`xcode-select failed with code ${code}: ${stderr}`));
          }
        });
      });
      
      if (!xcodeSelectResult || xcodeSelectResult.trim() === '') {
        return {
          content: [{
            type: 'text',
            text: '❌ No Xcode installation found\n\n💡 To fix this:\n• Install Xcode from the Mac App Store\n• Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer'
          }]
        };
      }
      
      // Convert from Developer path to app path
      xcodePath = xcodeSelectResult.replace('/Contents/Developer', '');
      
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to determine Xcode path: ${error instanceof Error ? error.message : String(error)}\n\n💡 Ensure Xcode is properly installed and xcode-select is configured`
        }]
      };
    }
    
    // Launch Xcode
    const launchScript = `
      (function() {
        try {
          const app = Application(${JSON.stringify(xcodePath)});
          app.launch();
          
          // Wait for Xcode to start
          let attempts = 0;
          while (!app.running() && attempts < 30) {
            delay(1);
            attempts++;
          }
          
          if (app.running()) {
            return 'Xcode launched successfully from ' + ${JSON.stringify(xcodePath)};
          } else {
            return 'Failed to launch Xcode - timed out after 30 seconds';
          }
        } catch (error) {
          return 'Failed to launch Xcode: ' + error.message;
        }
      })()
    `;
    
    try {
      const launchResult = await JXAExecutor.execute(launchScript);
      if (launchResult.includes('launched successfully')) {
        return null; // Success
      } else {
        return {
          content: [{
            type: 'text',
            text: `❌ ${launchResult}\n\n💡 Try:\n• Manually launching Xcode once\n• Checking Xcode installation\n• Ensuring sufficient system resources`
          }]
        };
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Failed to launch Xcode: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }

  public static async openProject(projectPath: string): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;
    
    // Check for workspace preference: if we're opening a .xcodeproj file,
    // check if there's a corresponding .xcworkspace file in the same directory
    let actualPath = projectPath;
    if (projectPath.endsWith('.xcodeproj')) {
      const { existsSync } = await import('fs');
      const workspacePath = projectPath.replace(/\.xcodeproj$/, '.xcworkspace');
      if (existsSync(workspacePath)) {
        actualPath = workspacePath;
      }
    }
    
    // Ensure Xcode is running before trying to open project
    const xcodeError = await this.ensureXcodeIsRunning();
    if (xcodeError) return xcodeError;
    
    const script = `
      const app = Application('Xcode');
      app.open(${JSON.stringify(actualPath)});
      'Project opened successfully';
    `;
    
    try {
      const result = await JXAExecutor.execute(script);
      
      // If we automatically chose a workspace over a project, indicate this in the response
      if (actualPath !== projectPath && actualPath.endsWith('.xcworkspace')) {
        return { content: [{ type: 'text', text: `Opened workspace instead of project: ${result}` }] };
      }
      
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Failed to open project: ${errorMessage}` }] };
    }
  }

  public static async waitForProjectToLoad(projectPath: string, maxRetries: number = 30, retryDelayMs: number = 1000): Promise<McpResult | null> {
    const checkScript = `
      (function() {
        try {
          ${getWorkspaceByPathScript(projectPath)}
          if (!workspace) {
            return JSON.stringify({ loaded: false, reason: 'Workspace not found' });
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
            ${getWorkspaceByPathScript(projectPath)}
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
    const waitResult = await this.waitForProjectToLoad(projectPath);
    if (waitResult) {
      return waitResult;
    }

    return { content: [{ type: 'text', text: 'Project opened and loaded successfully' }] };
  }

  public static async closeProject(projectPath: string): Promise<McpResult> {
    // Simplified close project to prevent crashes - just close without complex error handling
    const closeScript = `
      (function() {
        try {
          ${getWorkspaceByPathScript(projectPath)}
          if (!workspace) {
            return 'No workspace to close (already closed)';
          }
          
          // Simple close (no options) to align with test mocks and avoid dialogs
          workspace.close();
          return 'Project close initiated';
        } catch (error) {
          return 'Close completed (may have had dialogs): ' + error.message;
        }
      })()
    `;
    
    try {
      const result = await JXAExecutor.execute(closeScript);
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      // Even if JXA fails, consider it successful to prevent crashes
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Project close completed with issues: ${errorMessage}` }] };
    }
  }

  public static async getSchemes(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult> {
    const validationError = PathValidator.validateProjectPath(projectPath);
    if (validationError) return validationError;

    await openProject(projectPath);

    const script = `
      (function() {
        ${getWorkspaceByPathScript(projectPath)}
        
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
    
    // Parse the result to check if schemes array is empty
    try {
      const schemeInfo = JSON.parse(result);
      if (Array.isArray(schemeInfo) && schemeInfo.length === 0) {
        return { content: [{ type: 'text', text: 'No schemes found in the project' }] };
      }
    } catch (error) {
      // If parsing fails, return the raw result
    }
    
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
        ${getWorkspaceByPathScript(projectPath)}
        
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
        ${getWorkspaceByPathScript(projectPath)}
        
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
    
    // Parse the result to check if destinations array is empty
    try {
      const destInfo = JSON.parse(result);
      if (Array.isArray(destInfo) && destInfo.length === 0) {
        return { content: [{ type: 'text', text: 'No run destinations found for the project' }] };
      }
    } catch (error) {
      // If parsing fails, return the raw result
    }
    
    return { content: [{ type: 'text', text: result }] };
  }

  /**
   * Get test targets information from project
   */
  public static async getTestTargets(projectPath: string): Promise<McpResult> {
    try {
      const { promises: fs } = await import('fs');
      
      // Read the project.pbxproj file
      const pbxprojPath = `${projectPath}/project.pbxproj`;
      const projectContent = await fs.readFile(pbxprojPath, 'utf8');
      
      // Parse test targets from the project file
      const testTargets: Array<{ name: string; identifier: string; productType: string }> = [];
      
      // Find PBXNativeTarget sections that are test targets
      const targetMatches = projectContent.matchAll(/([A-F0-9]{24}) \/\* (.+?) \*\/ = {\s*isa = PBXNativeTarget;[\s\S]*?productType = "([^"]+)";/g);
      
      for (const match of targetMatches) {
        const [, identifier, name, productType] = match;
        
        // Only include test targets (with null checks)
        if (identifier && name && productType && 
            (productType.includes('test') || productType.includes('xctest'))) {
          testTargets.push({
            name: name.trim(),
            identifier: identifier.trim(),
            productType: productType.trim()
          });
        }
      }
      
      if (testTargets.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `📋 TEST TARGETS\n\n⚠️ No test targets found in project.\n\nThis could mean:\n  • No test targets are configured\n  • Project file parsing failed\n  • Test targets use a different naming convention`
          }]
        };
      }
      
      // Helper function to convert product type to human-readable name
      const getHumanReadableProductType = (productType: string): string => {
        switch (productType) {
          case 'com.apple.product-type.bundle.unit-test':
            return 'Unit Tests';
          case 'com.apple.product-type.bundle.ui-testing':
            return 'UI Tests';
          default:
            return 'Tests';
        }
      };
      
      let message = `📋 TEST TARGETS\n\n`;
      message += `Found ${testTargets.length} test target(s):\n\n`;
      
      testTargets.forEach((target, index) => {
        const testType = getHumanReadableProductType(target.productType);
        message += `${index + 1}. **${target.name}** (${testType})\n\n`;
      });
      
      message += `💡 Usage Examples:\n`;
      if (testTargets.length > 0) {
        message += `  • --test-target-name "${testTargets[0]?.name}"\n\n`;
      }
      message += `📝 Use --test-target-name with the target name for test filtering`;
      
      return {
        content: [{
          type: 'text',
          text: message
        }]
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{
          type: 'text',
          text: `Failed to get test targets: ${errorMessage}`
        }]
      };
    }
  }
}

export default ProjectTools;
