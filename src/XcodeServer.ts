import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { BuildTools } from './tools/BuildTools.js';
import { ProjectTools } from './tools/ProjectTools.js';
import { InfoTools } from './tools/InfoTools.js';
import { PathValidator } from './utils/PathValidator.js';
import { EnvironmentValidator } from './utils/EnvironmentValidator.js';
import { Logger } from './utils/Logger.js';
import type { 
  EnvironmentValidation, 
  ToolLimitations, 
  McpResult
} from './types/index.js';


export class XcodeServer {
  public server: Server;
  public currentProjectPath: string | null = null;
  private environmentValidation: EnvironmentValidation | null = null;
  private isValidated = false;
  private canOperateInDegradedMode = false;

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

    this.setupToolHandlers();
  }

  /**
   * Validates the environment and sets up the server accordingly
   */
  public async validateEnvironment(): Promise<EnvironmentValidation> {
    if (this.isValidated && this.environmentValidation) {
      return this.environmentValidation;
    }

    try {
      this.environmentValidation = await EnvironmentValidator.validateEnvironment();
      this.isValidated = true;
      this.canOperateInDegradedMode = this.environmentValidation.overall.canOperateInDegradedMode;

      // Log validation results
      const validationStatus = this.environmentValidation.overall.valid ? 'PASSED' : 
        this.canOperateInDegradedMode ? 'DEGRADED' : 'FAILED';
      Logger.info('Environment Validation:', validationStatus);

      if (!this.environmentValidation.overall.valid) {
        Logger.warn('Environment issues detected:');
        [...this.environmentValidation.overall.criticalFailures, 
         ...this.environmentValidation.overall.nonCriticalFailures].forEach(component => {
          const result = this.environmentValidation![component];
          if (result && 'valid' in result) {
            const validationResult = result as import('./types/index.js').EnvironmentValidationResult;
            Logger.warn(`  ${component}: ${validationResult.message || 'Status unknown'}`);
          }
        });
      }

      return this.environmentValidation;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('Environment validation failed:', errorMessage);
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
  public async validateToolOperation(toolName: string): Promise<McpResult | null> {
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
        .map(component => {
          const result = validation[component];
          if (result && 'valid' in result) {
            const validationResult = result as import('./types/index.js').EnvironmentValidationResult;
            return validationResult.message || 'Unknown failure';
          }
          return 'Unknown failure';
        })
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
          text: `❌ Cannot execute ${toolName}: ${limitations.reason}\n\nRecovery instructions:\n${limitations.instructions?.map(i => `• ${i}`).join('\n') || ''}`
        }]
      };
    }

    // Issue warning for degraded functionality but allow operation
    if (limitations.degraded) {
      Logger.warn(`${toolName} operating in degraded mode - ${limitations.reason}`);
    }

    return null; // Operation can proceed
  }

  /**
   * Determines tool limitations based on environment validation
   */
  private getToolLimitations(toolName: string, validation: EnvironmentValidation): ToolLimitations {
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
        degraded: false,
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
        degraded: false,
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
          degraded: false,
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
  public async enhanceErrorWithGuidance(error: Error | { message?: string }, _toolName: string): Promise<string | null> {
    const errorMessage = error.message || error.toString();
    
    // Import ErrorHelper for common error patterns
    const { ErrorHelper } = await import('./utils/ErrorHelper.js');
    const commonError = ErrorHelper.parseCommonErrors(error as Error);
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

  private setupToolHandlers(): void {
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

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<CallToolResult> => {
      const { name, arguments: args = {} } = request.params as { name: string; arguments?: Record<string, unknown> };

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
            const result = await ProjectTools.openProject(args.path as string);
            if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
              const textContent = result.content[0];
              if (textContent.type === 'text' && typeof textContent.text === 'string') {
                if (!textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
                  this.currentProjectPath = args.path as string;
                }
              }
            }
            return result;
          case 'xcode_build':
            return await BuildTools.build(
              args.path as string, 
              (args.scheme as string) || null, 
              (args.destination as string) || null, 
              this.openProject.bind(this)
            );
          case 'xcode_clean':
            return await BuildTools.clean(args.path as string, this.openProject.bind(this));
          case 'xcode_test':
            return await BuildTools.test(
              args.path as string, 
              (args.commandLineArguments as string[]) || [], 
              this.openProject.bind(this)
            );
          case 'xcode_run':
            return await BuildTools.run(
              args.path as string, 
              (args.commandLineArguments as string[]) || [], 
              this.openProject.bind(this)
            );
          case 'xcode_debug':
            return await BuildTools.debug(
              args.path as string, 
              args.scheme as string, 
              args.skipBuilding as boolean, 
              this.openProject.bind(this)
            );
          case 'xcode_stop':
            return await BuildTools.stop();
          case 'xcode_get_schemes':
            return await ProjectTools.getSchemes(args.path as string, this.openProject.bind(this));
          case 'xcode_get_run_destinations':
            return await ProjectTools.getRunDestinations(args.path as string, this.openProject.bind(this));
          case 'xcode_set_active_scheme':
            return await ProjectTools.setActiveScheme(
              args.path as string, 
              args.schemeName as string, 
              this.openProject.bind(this)
            );
          case 'xcode_get_workspace_info':
            return await InfoTools.getWorkspaceInfo(args.path as string, this.openProject.bind(this));
          case 'xcode_get_projects':
            return await InfoTools.getProjects(args.path as string, this.openProject.bind(this));
          case 'xcode_open_file':
            return await InfoTools.openFile(args.filePath as string, args.lineNumber as number);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        // Enhanced error handling that doesn't crash the server
        Logger.error(`Tool execution error for ${name}:`, error);
        
        // Check if it's a configuration-related error that we can provide guidance for
        const enhancedError = await this.enhanceErrorWithGuidance(error as Error, name);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }

        // For other errors, provide a helpful message but don't crash
        const errorMessage = error instanceof McpError ? error.message : 
          error instanceof Error ? `Tool execution failed: ${error.message}` : 
          `Tool execution failed: ${String(error)}`;
        
        return { 
          content: [{ 
            type: 'text', 
            text: `❌ ${name} failed: ${errorMessage}\n\n💡 If this persists, try running 'xcode_health_check' to diagnose potential configuration issues.`
          }] 
        };
      }
    });
  }

  public async openProject(projectPath: string): Promise<McpResult> {
    const result = await ProjectTools.openProject(projectPath);
    if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
      const textContent = result.content[0];
      if (textContent.type === 'text' && typeof textContent.text === 'string') {
        if (!textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
          this.currentProjectPath = projectPath;
        }
      }
    }
    return result;
  }

  public async executeJXA(script: string): Promise<string> {
    const { JXAExecutor } = await import('./utils/JXAExecutor.js');
    return JXAExecutor.execute(script);
  }

  public validateProjectPath(projectPath: string): McpResult | null {
    return PathValidator.validateProjectPath(projectPath);
  }

  public async findProjectDerivedData(projectPath: string): Promise<string | null> {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.findProjectDerivedData(projectPath);
  }

  public async getLatestBuildLog(projectPath: string) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.getLatestBuildLog(projectPath);
  }

  public async parseBuildLog(logPath: string, retryCount?: number, maxRetries?: number) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.parseBuildLog(logPath, retryCount, maxRetries);
  }

  public async canParseLog(logPath: string): Promise<boolean> {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.canParseLog(logPath);
  }

  public async getCustomDerivedDataLocationFromXcodePreferences(): Promise<string | null> {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.getCustomDerivedDataLocationFromXcodePreferences();
  }
}