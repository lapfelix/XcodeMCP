import { vi } from 'vitest';

/**
 * Simulated Xcode application state for testing
 */
export interface MockXcodeState {
  isRunning: boolean;
  activeProject: string | null;
  activeScheme: string | null;
  buildInProgress: boolean;
  testInProgress: boolean;
  runInProgress: boolean;
  debugInProgress: boolean;
  schemes: Record<string, string[]>; // projectPath -> schemes
  destinations: string[];
  projects: Record<string, string[]>; // workspace -> projects
}

/**
 * Mock JXA executor that simulates Xcode behavior
 */
export class MockJXAExecutor {
  private static state: MockXcodeState = {
    isRunning: false,
    activeProject: null,
    activeScheme: null,
    buildInProgress: false,
    testInProgress: false,
    runInProgress: false,
    debugInProgress: false,
    schemes: {},
    destinations: [
      'iPhone 15 Pro',
      'iPhone 15 Plus',
      'iPad Pro (12.9-inch)',
      'My Mac',
      'macOS'
    ],
    projects: {}
  };

  /**
   * Reset mock state for testing
   */
  static resetState(): void {
    this.state = {
      isRunning: false,
      activeProject: null,
      activeScheme: null,
      buildInProgress: false,
      testInProgress: false,
      runInProgress: false,
      debugInProgress: false,
      schemes: {},
      destinations: [
        'iPhone 15 Pro',
        'iPhone 15 Plus', 
        'iPad Pro (12.9-inch)',
        'My Mac',
        'macOS'
      ],
      projects: {}
    };
  }

  /**
   * Set the state for testing
   */
  static setState(newState: Partial<MockXcodeState>): void {
    this.state = { ...this.state, ...newState };
  }

  /**
   * Set up mock project with schemes
   */
  static setupMockProject(projectPath: string, schemes: string[], projects?: string[]): void {
    this.state.schemes[projectPath] = schemes;
    if (projects) {
      this.state.projects[projectPath] = projects;
    }
  }

  /**
   * Get current mock state (for test assertions)
   */
  static getState(): MockXcodeState {
    return { ...this.state };
  }

  /**
   * Mock execute method that simulates JXA scripts
   */
  static async execute(script: string): Promise<string> {
    // Debug logging
    // console.log('MockJXAExecutor.execute called with script:', script.substring(0, 200) + '...');
    
    // Enable debugging for setActiveScheme
    // if (script.includes('setActiveScheme') || script.includes('workspace.activeScheme = targetScheme')) {
    //   console.log('DEBUG: setActiveScheme script:', script);
    // }
    
    // Check if this is the xcode-select check script
    if (script.includes('xcode-select')) {
      // console.log('Matched xcode-select script');
      return '/Applications/Xcode.app/Contents/Developer';
    }
    
    // Check if this is the Xcode launch script from ensureXcodeIsRunning
    if (script.includes('app.launch()') && script.includes('app.running()')) {
      this.state.isRunning = true;
      return 'Xcode launched successfully from /Applications/Xcode.app';
    }
    
    // Check if this is the function-based launch script from ensureXcodeIsRunning  
    if (script.includes('(function()') && script.includes('app.launch()') && script.includes('if (app.running())')) {
      this.state.isRunning = true;
      return 'Xcode launched successfully from /Applications/Xcode.app';
    }
    
    // Check if this is the Xcode launch script
    if (script.includes('launch()')) {
      this.state.isRunning = true;
      return 'Xcode launched successfully from /Applications/Xcode.app';
    }
    
    // Check if this is the Xcode running check script from ensureXcodeIsRunning
    if (script.includes('if (app.running())') && script.includes('Xcode is already running')) {
      return this.state.isRunning ? 'Xcode is already running' : 'Xcode is not running';
    }
    
    // Check if this is the Xcode running check script
    if (script.includes('if (app.running())')) {
      return this.state.isRunning ? 'Xcode is already running' : 'Xcode is not running';
    }
    
    // Parse the JXA script and simulate appropriate behavior
    if (script.includes('Application("Xcode")') || script.includes('Application(')) {
      if (script.includes('.running()')) {
        return String(this.state.isRunning);
      }
      
      if (script.includes('.activate()')) {
        this.state.isRunning = true;
        return 'true';
      }

      if (script.includes('.open(')) {
        // console.log('Matched .open() condition');
        const projectMatch = script.match(/\.open\([^)]+\)/);
        if (projectMatch) {
          // Extract the project path from the script
          const pathMatch = script.match(/\.open\(([^)]+)\)/);
          if (pathMatch) {
            let projectPath = pathMatch[1];
            // console.log('Extracted project path in .open condition:', projectPath);
            // Remove quotes if present
            projectPath = projectPath.replace(/^["']|["']$/g, '');
            // console.log('Cleaned project path in .open condition:', projectPath);
            this.state.activeProject = projectPath;
            this.state.isRunning = true;
            
            // Simulate delay for opening project
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Return different responses based on file type
            if (projectPath.endsWith('.xcodeproj')) {
              // console.log('Returning true for xcodeproj from .open condition');
              return 'true';
            } else if (projectPath.endsWith('.xcworkspace')) {
              // console.log('Returning Project opened successfully for xcworkspace from .open condition');
              return 'Project opened successfully';
            } else {
              // console.log('Returning Project opened successfully for other from .open condition');
              return 'Project opened successfully';
            }
          }
        }
      }
      
      // Handle the actual openProject script that expects "Project opened successfully"
      if (script.includes("'Project opened successfully'")) {
        // console.log('Matched openProject script condition');
        const pathMatch = script.match(/app\.open\(([^)]+)\)/);
        if (pathMatch) {
          let projectPath = pathMatch[1];
          // console.log('Extracted project path:', projectPath);
          // Remove quotes if present
          projectPath = projectPath.replace(/^["']|["']$/g, '');
          // console.log('Cleaned project path:', projectPath);
          this.state.activeProject = projectPath;
          this.state.isRunning = true;
          
          // Return different responses based on file type
          if (projectPath.endsWith('.xcodeproj')) {
            // console.log('Returning true for xcodeproj');
            return 'true';
          } else if (projectPath.endsWith('.xcworkspace')) {
            // console.log('Returning Project opened successfully for xcworkspace');
            return 'Project opened successfully';
          } else {
            // console.log('Returning Project opened successfully for other');
            return 'Project opened successfully';
          }
        }
      }
      
      // Handle the openProject script pattern more generally
      if (script.includes('const app = Application(') && script.includes('app.open(')) {
        const pathMatch = script.match(/app\.open\(([^)]+)\)/);
        if (pathMatch) {
          let projectPath = pathMatch[1];
          // Remove quotes if present
          projectPath = projectPath.replace(/^["']|["']$/g, '');
          this.state.activeProject = projectPath;
          this.state.isRunning = true;
          
          // Return different responses based on file type
          if (projectPath.endsWith('.xcodeproj')) {
            return 'true';
          } else if (projectPath.endsWith('.xcworkspace')) {
            return 'Project opened successfully';
          } else {
            return 'Project opened successfully';
          }
        }
      }

      // Handle closeProject script pattern - check for specific closeProject script structure
      if (script.includes('workspace.close') && script.includes('Project close initiated') && script.includes('activeWorkspaceDocument()')) {
        // This is the specific closeProject script from ProjectTools
        if (this.state.activeProject) {
          this.state.activeProject = null;
          this.state.activeScheme = null;
          this.state.buildInProgress = false;
          this.state.testInProgress = false;
          this.state.runInProgress = false;
          this.state.debugInProgress = false;
          return 'Project closed successfully';
        } else {
          return 'No workspace to close (already closed)';
        }
      }
      
      if (script.includes('.close()')) {
        this.state.activeProject = null;
        this.state.activeScheme = null;
        this.state.buildInProgress = false;
        this.state.testInProgress = false;
        this.state.runInProgress = false;
        this.state.debugInProgress = false;
        return 'Project close initiated';
      }
      
      // Handle specific activeWorkspaceDocument() patterns first
      if (script.includes('activeWorkspaceDocument()')) {
        if (!this.state.activeProject) {
          return 'null';
        }
        
        // Check if this is the project loading check script
        if (script.includes('JSON.stringify({ isOpen:')) {
          const pathMatch = script.match(/workspacePath === ([^)]+)/);
          if (pathMatch) {
            let expectedPath = pathMatch[1];
            expectedPath = expectedPath.replace(/^["']|["']$/g, '');
            if (expectedPath === this.state.activeProject) {
              return JSON.stringify({ isOpen: true, isLoaded: true });
            } else {
              return JSON.stringify({ isOpen: false, differentProject: this.state.activeProject });
            }
          }
        }
        
        // Check if this is the wait for load script
        if (script.includes('JSON.stringify({ loaded:')) {
          return JSON.stringify({ loaded: true, schemes: 2, destinations: 5 });
        }
        
        // If script contains schemes() or setActiveScheme, let those handlers process it
        if (script.includes('schemes()') || script.includes('setActiveScheme') || script.includes('runDestinations()')) {
          // Don't return here, let the script continue to more specific handlers
        } else {
          // Return a mock workspace document for simpler activeWorkspaceDocument() checks
          return JSON.stringify({ name: 'MockWorkspace', path: this.state.activeProject });
        }
      }

      if (script.includes('schemes()')) {
        // If this script is for setActiveScheme, let that handler deal with it
        if (script.includes('workspace.activeScheme = targetScheme')) {
          // Don't handle schemes() here, let the setActiveScheme handler take care of it
        } else {
          if (!this.state.activeProject) {
            throw new Error('No project is open');
          }
          const schemes = this.state.schemes[this.state.activeProject] || ['MyApp', 'MyAppTests'];
          
          // If this is a complex scheme query (like in getSchemes)
          if (script.includes('schemeInfo') || script.includes('scheme.name()')) {
            const schemeInfo = schemes.map((schemeName, index) => ({
              name: schemeName,
              id: `scheme-${index}`,
              isActive: index === 0 // First scheme is active
            }));
            return JSON.stringify(schemeInfo, null, 2);
          }
          
          return JSON.stringify(schemes);
        }
      }

      if (script.includes('setActiveScheme') || script.includes('workspace.activeScheme = targetScheme')) {
        if (!this.state.activeProject) {
          throw new Error('No active workspace');
        }
        
        const schemes = this.state.schemes[this.state.activeProject] || ['MyApp', 'MyAppTests'];
        
        // Handle the actual setActiveScheme script from ProjectTools
        if (script.includes('workspace.activeScheme = targetScheme')) {
          // Extract the scheme name from the scheme.name() === "SchemeName" pattern
          const schemeNameMatch = script.match(/scheme\.name\(\) === "([^"]+)"/);
          if (schemeNameMatch) {
            const schemeName = schemeNameMatch[1];
            if (schemes.includes(schemeName)) {
              this.state.activeScheme = schemeName;
              return `Active scheme set to: ${schemeName}`;
            } else {
              throw new Error(`Scheme not found. Available: ${JSON.stringify(schemes)}`);
            }
          }
        }
        
        // Fallback: try to extract from setActiveScheme function call pattern
        const schemeMatch = script.match(/setActiveScheme\("([^"]+)"/);
        if (schemeMatch) {
          const schemeName = schemeMatch[1];
          if (schemes.includes(schemeName)) {
            this.state.activeScheme = schemeName;
            return `Active scheme set to: ${schemeName}`;
          } else {
            throw new Error(`Scheme not found. Available: ${JSON.stringify(schemes)}`);
          }
        }
        
        // If we can't extract the scheme name, throw an error
        throw new Error(`Scheme not found. Available: ${JSON.stringify(schemes)}`);
      }

      if (script.includes('runDestinations()')) {
        // If this is a complex destination query (like in getRunDestinations)
        if (script.includes('destInfo') || script.includes('dest.name()')) {
          const destInfo = this.state.destinations.map((destName, index) => ({
            name: destName,
            platform: destName.includes('iPhone') ? 'iOS' : destName.includes('iPad') ? 'iOS' : 'macOS',
            architecture: destName.includes('Mac') ? 'arm64' : 'arm64',
            isActive: index === 0 // First destination is active
          }));
          return JSON.stringify(destInfo, null, 2);
        }
        
        return JSON.stringify(this.state.destinations);
      }

      if (script.includes('workspaceDocument()')) {
        if (!this.state.activeProject) {
          throw new Error('No project is open');
        }
        
        if (script.includes('.projects()')) {
          const projects = this.state.projects[this.state.activeProject] || ['MyApp'];
          return JSON.stringify(projects);
        }
        
        return JSON.stringify({
          name: 'MockWorkspace',
          path: this.state.activeProject
        });
      }

      if (script.includes('build()')) {
        if (!this.state.activeProject) {
          throw new Error('No project is open');
        }
        this.state.buildInProgress = true;
        
        // Simulate build completion
        setTimeout(() => {
          this.state.buildInProgress = false;
        }, 200);
        
        return 'true';
      }

      if (script.includes('test()')) {
        if (!this.state.activeProject) {
          throw new Error('No project is open');
        }
        this.state.testInProgress = true;
        
        // Simulate test completion
        setTimeout(() => {
          this.state.testInProgress = false;
        }, 300);
        
        return 'true';
      }

      if (script.includes('run()')) {
        if (!this.state.activeProject) {
          throw new Error('No project is open');
        }
        this.state.runInProgress = true;
        
        // Simulate run start
        setTimeout(() => {
          this.state.runInProgress = false;
        }, 150);
        
        return 'true';
      }

      if (script.includes('debug()')) {
        if (!this.state.activeProject) {
          throw new Error('No project is open');
        }
        this.state.debugInProgress = true;
        
        // Simulate debug start
        setTimeout(() => {
          this.state.debugInProgress = false;
        }, 150);
        
        return 'true';
      }

      if (script.includes('clean()')) {
        if (!this.state.activeProject) {
          throw new Error('No project is open');
        }
        
        // Simulate clean completion
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return 'true';
      }

      if (script.includes('stop()')) {
        this.state.buildInProgress = false;
        this.state.testInProgress = false;
        this.state.runInProgress = false;
        this.state.debugInProgress = false;
        return 'true';
      }
    }

    // Handle System Events for file opening
    if (script.includes('Application("System Events")') && script.includes('open location')) {
      return 'true';
    }

    // Default return for unhandled scripts
    // console.log('No condition matched, returning default true');
    return 'true';
  }

  /**
   * Create a vitest mock for JXAExecutor
   */
  static createViMock() {
    return {
      execute: vi.fn().mockImplementation(this.execute.bind(this))
    };
  }
}

/**
 * Utility to mock JXAExecutor in tests
 */
export function mockJXAExecutor() {
  const mockExecute = vi.fn().mockImplementation(MockJXAExecutor.execute.bind(MockJXAExecutor));
  
  return {
    mockExecute,
    resetState: MockJXAExecutor.resetState.bind(MockJXAExecutor),
    setState: MockJXAExecutor.setState.bind(MockJXAExecutor),
    setupMockProject: MockJXAExecutor.setupMockProject.bind(MockJXAExecutor),
    getState: MockJXAExecutor.getState.bind(MockJXAExecutor)
  };
}