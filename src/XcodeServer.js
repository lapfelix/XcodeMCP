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
    this.setupToolHandlers();
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
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
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
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error.message}`
        );
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