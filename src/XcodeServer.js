import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { BuildTools } from './tools/BuildTools.js';
import { ProjectTools } from './tools/ProjectTools.js';
import { InfoTools } from './tools/InfoTools.js';
import { PathValidator } from './utils/PathValidator.js';
import { EnvironmentValidator } from './utils/EnvironmentValidator.js';

export class XcodeServer {
  constructor() {
    this.server = new Server(
      {
        name: 'xcode-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.currentProjectPath = null;
    this.environmentValidation = null;
    this.isValidated = false;
    this.canOperateInDegradedMode = false;
    this.setupToolHandlers();
  }

  /**
   * Validates the environment and sets up the server accordingly
   */
  async validateEnvironment() {
    if (this.isValidated) {
      return this.environmentValidation;
    }

    try {
      this.environmentValidation = await EnvironmentValidator.validateEnvironment();
      this.isValidated = true;
      this.canOperateInDegradedMode = this.environmentValidation.overall.canOperateInDegradedMode;

      // Log validation results to stderr for debugging (won't interfere with MCP protocol)
      console.error('XcodeMCP Environment Validation:', 
        this.environmentValidation.overall.valid ? 'PASSED' : 
        this.canOperateInDegradedMode ? 'DEGRADED' : 'FAILED');

      if (!this.environmentValidation.overall.valid) {
        console.error('Environment issues detected:');
        [...this.environmentValidation.overall.criticalFailures, 
         ...this.environmentValidation.overall.nonCriticalFailures].forEach(component => {
          const result = this.environmentValidation[component];
          console.error(`  ${component}: ${result.message}`);
        });
      }

      return this.environmentValidation;
    } catch (error) {
      console.error('Environment validation failed:', error.message);
      // Create minimal validation result for graceful degradation
      this.environmentValidation = {
        overall: { 
          valid: false, 
          canOperateInDegradedMode: false,
          criticalFailures: ['validation'],
          nonCriticalFailures: []
        }
      };
      this.isValidated = true;
      return this.environmentValidation;
    }
  }

  /**
   * Checks if a tool operation should be blocked due to environment issues
   */
  async validateToolOperation(toolName) {
    // Health check tool should never be blocked
    if (toolName === 'xcode_health_check') {
      return null;
    }

    const validation = await this.validateEnvironment();
    
    if (validation.overall.valid) {
      return null; // All good
    }

    // Check for critical failures that prevent all operations
    if (!validation.overall.canOperateInDegradedMode) {
      const criticalFailures = validation.overall.criticalFailures
        .map(component => validation[component]?.message)
        .filter(Boolean)
        .join(', ');
      
      return {
        content: [{
          type: 'text',
          text: `❌ Cannot execute ${toolName}: Critical environment failures detected.\n\n${criticalFailures}\n\nPlease run the 'xcode_health_check' tool for detailed recovery instructions.`
        }]
      };
    }

    // Check for specific tool limitations in degraded mode
    const limitations = this.getToolLimitations(toolName, validation);
    if (limitations.blocked) {
      return {
        content: [{
          type: 'text',
          text: `❌ Cannot execute ${toolName}: ${limitations.reason}\n\nRecovery instructions:\n${limitations.instructions.map(i => `• ${i}`).join('\n')}`
        }]
      };
    }

    // Issue warning for degraded functionality but allow operation
    if (limitations.degraded) {
      console.error(`Warning: ${toolName} operating in degraded mode - ${limitations.reason}`);
    }

    return null; // Operation can proceed
  }

  /**
   * Determines tool limitations based on environment validation
   */
  getToolLimitations(toolName, validation) {
    // Health check tool should never be limited
    if (toolName === 'xcode_health_check') {
      return { blocked: false, degraded: false };
    }

    const buildTools = ['xcode_build', 'xcode_test', 'xcode_run', 'xcode_debug', 'xcode_clean'];
    const xcodeTools = [...buildTools, 'xcode_open_project', 'xcode_get_schemes', 'xcode_set_active_scheme', 
                       'xcode_get_run_destinations', 'xcode_get_workspace_info', 'xcode_get_projects'];

    // Check Xcode availability
    if (xcodeTools.includes(toolName) && !validation.xcode?.valid) {
      return {
        blocked: true,
        reason: 'Xcode is not properly installed or accessible',
        instructions: validation.xcode?.recoveryInstructions || [
          'Install Xcode from the Mac App Store',
          'Launch Xcode once to complete installation'
        ]
      };
    }

    // Check osascript availability  
    if (xcodeTools.includes(toolName) && !validation.osascript?.valid) {
      return {
        blocked: true,
        reason: 'JavaScript for Automation (JXA) is not available',
        instructions: validation.osascript?.recoveryInstructions || [
          'This tool requires macOS',
          'Ensure osascript is available'
        ]
      };
    }

    // Build tools have additional dependencies and warnings
    if (buildTools.includes(toolName)) {
      if (!validation.xclogparser?.valid) {
        return {
          blocked: false,
          degraded: true,
          reason: 'XCLogParser not available - build results will have limited detail',
          instructions: validation.xclogparser?.recoveryInstructions || [
            'Install XCLogParser with: brew install xclogparser'
          ]
        };
      }

      if (!validation.permissions?.valid && 
          !validation.permissions?.degradedMode?.available) {
        return {
          blocked: true,
          reason: 'Automation permissions not granted',
          instructions: validation.permissions?.recoveryInstructions || [
            'Grant automation permissions in System Preferences'
          ]
        };
      }
    }

    return { blocked: false, degraded: false };
  }

  /**
   * Enhances error messages with configuration guidance
   */
  async enhanceErrorWithGuidance(error, toolName) {
    const errorMessage = error.message || error.toString();
    
    // Import ErrorHelper for common error patterns
    const { ErrorHelper } = await import('./utils/ErrorHelper.js');
    const commonError = ErrorHelper.parseCommonErrors(error);
    if (commonError) {
      return commonError;
    }

    // Additional configuration-specific error patterns
    if (errorMessage.includes('command not found')) {
      if (errorMessage.includes('xclogparser')) {
        return `❌ XCLogParser not found\n\n💡 To fix this:\n• Install XCLogParser: brew install xclogparser\n• Or download from: https://github.com/MobileNativeFoundation/XCLogParser\n\nNote: Build operations will work but with limited error details.`;
      }
      if (errorMessage.includes('osascript')) {
        return `❌ macOS scripting tools not available\n\n💡 This indicates a critical system issue:\n• This MCP server requires macOS\n• Ensure you're running on a Mac with system tools available\n• Try restarting your terminal`;
      }
    }

    if (errorMessage.includes('No such file or directory')) {
      if (errorMessage.includes('Xcode.app')) {
        return `❌ Xcode application not found\n\n💡 To fix this:\n• Install Xcode from the Mac App Store\n• Ensure Xcode is in /Applications/Xcode.app\n• Launch Xcode once to complete installation`;
      }
    }

    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return `❌ Operation timed out\n\n💡 This might indicate:\n• Xcode is not responding (try restarting Xcode)\n• System performance issues\n• Large project taking longer than expected\n• Network issues if downloading dependencies`;
    }

    return null; // No specific guidance available
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'xcode_open_project',
            description: 'Open an Xcode project or workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_build',
            description: 'Build a specific Xcode project or workspace. If scheme is not provided, builds the currently active scheme. If destination is not provided, uses the currently active destination.',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file to build',
                },
                scheme: {
                  type: 'string',
                  description: 'Name of the scheme to build (optional - uses active scheme if not provided)',
                },
                destination: {
                  type: 'string',
                  description: 'Build destination (optional - uses active destination if not provided)',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_get_schemes',
            description: 'Get list of available schemes for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_set_active_scheme',
            description: 'Set the active scheme for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                schemeName: {
                  type: 'string',
                  description: 'Name of the scheme to activate',
                },
              },
              required: ['path', 'schemeName'],
            },
          },
          {
            name: 'xcode_clean',
            description: 'Clean the build directory for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_test',
            description: 'Run tests for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                commandLineArguments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional command line arguments',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_run',
            description: 'Run a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                commandLineArguments: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Additional command line arguments',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_debug',
            description: 'Start debugging session for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
                scheme: {
                  type: 'string',
                  description: 'Scheme name (optional)',
                },
                skipBuilding: {
                  type: 'boolean',
                  description: 'Whether to skip building',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_stop',
            description: 'Stop the current scheme action',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'xcode_get_run_destinations',
            description: 'Get list of available run destinations for a specific project',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_get_workspace_info',
            description: 'Get information about a specific workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_get_projects',
            description: 'Get list of projects in a specific workspace',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Absolute path to the .xcodeproj or .xcworkspace file',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'xcode_open_file',
            description: 'Open a file in Xcode',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Absolute path to the file to open',
                },
                lineNumber: {
                  type: 'number',
                  description: 'Optional line number to navigate to',
                },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'xcode_health_check',
            description: 'Perform a comprehensive health check of the XcodeMCP environment and configuration',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        // Handle health check tool first (no environment validation needed)
        if (name === 'xcode_health_check') {
          const report = await EnvironmentValidator.createHealthCheckReport();
          return { content: [{ type: 'text', text: report }] };
        }

        // Validate environment for all other tools
        const validationError = await this.validateToolOperation(name);
        if (validationError) {
          return validationError;
        }

        switch (name) {
          case 'xcode_open_project':
            const result = await ProjectTools.openProject(args.path);
            if (result && !result.content?.[0]?.text?.includes('Error') && !result.content?.[0]?.text?.includes('does not exist')) {
              this.currentProjectPath = args.path;
            }
            return result;
          case 'xcode_build':
            return await BuildTools.build(args.path, args.scheme, args.destination, this.openProject.bind(this));
          case 'xcode_clean':
            return await BuildTools.clean(args.path, this.openProject.bind(this));
          case 'xcode_test':
            return await BuildTools.test(args.path, args.commandLineArguments, this.openProject.bind(this));
          case 'xcode_run':
            return await BuildTools.run(args.path, args.commandLineArguments, this.openProject.bind(this));
          case 'xcode_debug':
            return await BuildTools.debug(args.path, args.scheme, args.skipBuilding, this.openProject.bind(this));
          case 'xcode_stop':
            return await BuildTools.stop();
          case 'xcode_get_schemes':
            return await ProjectTools.getSchemes(args.path, this.openProject.bind(this));
          case 'xcode_get_run_destinations':
            return await ProjectTools.getRunDestinations(args.path, this.openProject.bind(this));
          case 'xcode_set_active_scheme':
            return await ProjectTools.setActiveScheme(args.path, args.schemeName, this.openProject.bind(this));
          case 'xcode_get_workspace_info':
            return await InfoTools.getWorkspaceInfo(args.path, this.openProject.bind(this));
          case 'xcode_get_projects':
            return await InfoTools.getProjects(args.path, this.openProject.bind(this));
          case 'xcode_open_file':
            return await InfoTools.openFile(args.filePath, args.lineNumber);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        // Enhanced error handling that doesn't crash the server
        console.error(`XcodeMCP tool execution error for ${name}:`, error);
        
        // Check if it's a configuration-related error that we can provide guidance for
        const enhancedError = await this.enhanceErrorWithGuidance(error, name);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }

        // For other errors, provide a helpful message but don't crash
        const errorMessage = error instanceof McpError ? error.message : 
          `Tool execution failed: ${error.message}`;
        
        return { 
          content: [{ 
            type: 'text', 
            text: `❌ ${name} failed: ${errorMessage}\n\n💡 If this persists, try running 'xcode_health_check' to diagnose potential configuration issues.`
          }] 
        };
      }
    });
  }

  async openProject(projectPath) {
    const result = await ProjectTools.openProject(projectPath);
    if (result && !result.content?.[0]?.text?.includes('Error') && !result.content?.[0]?.text?.includes('does not exist')) {
      this.currentProjectPath = projectPath;
    }
    return result;
  }

  async executeJXA(script) {
    const { JXAExecutor } = await import('./utils/JXAExecutor.js');
    return JXAExecutor.execute(script);
  }

  async build(projectPath) {
    return BuildTools.build(projectPath, arguments[1], arguments[2], this.openProject.bind(this));
  }

  async clean(projectPath) {
    return BuildTools.clean(projectPath, this.openProject.bind(this));
  }

  async test(projectPath) {
    return BuildTools.test(projectPath, arguments[1], this.openProject.bind(this));
  }

  async run(projectPath) {
    return BuildTools.run(projectPath, arguments[1], this.openProject.bind(this));
  }

  async debug(projectPath, scheme) {
    return BuildTools.debug(projectPath, scheme, arguments[2], this.openProject.bind(this));
  }

  async stop() {
    return BuildTools.stop();
  }

  async getSchemes(projectPath) {
    return ProjectTools.getSchemes(projectPath, this.openProject.bind(this));
  }

  async setActiveScheme(projectPath, schemeName) {
    return ProjectTools.setActiveScheme(projectPath, schemeName, this.openProject.bind(this));
  }

  async getRunDestinations(projectPath) {
    return ProjectTools.getRunDestinations(projectPath, this.openProject.bind(this));
  }

  async getWorkspaceInfo(projectPath) {
    return InfoTools.getWorkspaceInfo(projectPath, this.openProject.bind(this));
  }

  async getProjects(projectPath) {
    return InfoTools.getProjects(projectPath, this.openProject.bind(this));
  }

  async openFile(filePath, lineNumber) {
    return InfoTools.openFile(filePath, lineNumber);
  }

  validateProjectPath(projectPath) {
    return PathValidator.validateProjectPath(projectPath);
  }

  async findProjectDerivedData(projectPath) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.findProjectDerivedData(projectPath);
  }

  async getLatestBuildLog(projectPath) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.getLatestBuildLog(projectPath);
  }

  async parseBuildLog(logPath, retryCount, maxRetries) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.parseBuildLog(logPath, retryCount, maxRetries);
  }

  async canParseLog(logPath) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.canParseLog(logPath);
  }

  async getCustomDerivedDataLocationFromXcodePreferences() {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.getCustomDerivedDataLocationFromXcodePreferences();
  }
}