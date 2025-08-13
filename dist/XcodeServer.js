import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, } from '@modelcontextprotocol/sdk/types.js';
import { BuildTools } from './tools/BuildTools.js';
import { ProjectTools } from './tools/ProjectTools.js';
import { InfoTools } from './tools/InfoTools.js';
import { XCResultTools } from './tools/XCResultTools.js';
import { PathValidator } from './utils/PathValidator.js';
import { EnvironmentValidator } from './utils/EnvironmentValidator.js';
import { Logger } from './utils/Logger.js';
export class XcodeServer {
    server;
    currentProjectPath = null;
    environmentValidation = null;
    isValidated = false;
    canOperateInDegradedMode = false;
    constructor() {
        this.server = new Server({
            name: 'xcode-mcp-server',
            version: '1.0.0',
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.setupToolHandlers();
    }
    /**
     * Validates the environment and sets up the server accordingly
     */
    async validateEnvironment() {
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
                    const result = this.environmentValidation[component];
                    if (result && 'valid' in result) {
                        const validationResult = result;
                        Logger.warn(`  ${component}: ${validationResult.message || 'Status unknown'}`);
                    }
                });
            }
            return this.environmentValidation;
        }
        catch (error) {
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
                .map(component => {
                const result = validation[component];
                if (result && 'valid' in result) {
                    const validationResult = result;
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
    getToolLimitations(toolName, validation) {
        // Health check tool should never be limited
        if (toolName === 'xcode_health_check') {
            return { blocked: false, degraded: false };
        }
        const buildTools = ['xcode_build', 'xcode_test', 'xcode_run', 'xcode_debug', 'xcode_clean'];
        const xcodeTools = [...buildTools, 'xcode_open_project', 'xcode_get_schemes', 'xcode_set_active_scheme',
            'xcode_get_run_destinations', 'xcode_get_workspace_info', 'xcode_get_projects'];
        const xcresultTools = ['xcresult_browse', 'xcresult_browser_get_console', 'xcresult_summary', 'xcresult_get_screenshot', 'xcresult_get_ui_hierarchy', 'xcresult_get_ui_element', 'xcresult_list_attachments', 'xcresult_export_attachment'];
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
        // XCResult tools only need xcresulttool (part of Xcode Command Line Tools)
        if (xcresultTools.includes(toolName)) {
            // Check if we can run xcresulttool - this is included with Xcode Command Line Tools
            if (!validation.xcode?.valid) {
                return {
                    blocked: true,
                    degraded: false,
                    reason: 'XCResult tools require Xcode Command Line Tools for xcresulttool',
                    instructions: [
                        'Install Xcode Command Line Tools: xcode-select --install',
                        'Or install full Xcode from the Mac App Store'
                    ]
                };
            }
        }
        return { blocked: false, degraded: false };
    }
    /**
     * Enhances error messages with configuration guidance
     */
    async enhanceErrorWithGuidance(error, _toolName) {
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
        // Only convert actual operation timeouts, not build errors containing 'timeout:' or transport errors
        if ((errorMessage.includes(' timeout') || errorMessage.includes('timed out') || errorMessage.includes('timeout after')) &&
            !errorMessage.includes('Body Timeout Error') &&
            !errorMessage.includes('Transport error') &&
            !errorMessage.includes('SSE error') &&
            !errorMessage.includes('terminated') &&
            !errorMessage.includes("'timeout:'") &&
            !errorMessage.includes("timeout:' in call") &&
            !errorMessage.includes('argument label') &&
            !errorMessage.includes('TEST BUILD FAILED')) {
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
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_close_project',
                        description: 'Close the currently active Xcode project or workspace (automatically stops any running actions first)',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_build',
                        description: 'Build a specific Xcode project or workspace with the specified scheme. If destination is not provided, uses the currently active destination.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file to build (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                                scheme: {
                                    type: 'string',
                                    description: 'Name of the scheme to build',
                                },
                                destination: {
                                    type: 'string',
                                    description: 'Build destination (optional - uses active destination if not provided)',
                                },
                            },
                            required: ['xcodeproj', 'scheme'],
                        },
                    },
                    {
                        name: 'xcode_get_schemes',
                        description: 'Get list of available schemes for a specific project',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_set_active_scheme',
                        description: 'Set the active scheme for a specific project',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                                scheme_name: {
                                    type: 'string',
                                    description: 'Name of the scheme to activate',
                                },
                            },
                            required: ['xcodeproj', 'scheme_name'],
                        },
                    },
                    {
                        name: 'xcode_clean',
                        description: 'Clean the build directory for a specific project',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_test',
                        description: 'Run tests for a specific project',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                                command_line_arguments: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Additional command line arguments',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_run',
                        description: 'Run a specific project with the specified scheme',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                                scheme: {
                                    type: 'string',
                                    description: 'Name of the scheme to run',
                                },
                                command_line_arguments: {
                                    type: 'array',
                                    items: { type: 'string' },
                                    description: 'Additional command line arguments',
                                },
                            },
                            required: ['xcodeproj', 'scheme'],
                        },
                    },
                    {
                        name: 'xcode_debug',
                        description: 'Start debugging session for a specific project',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                                scheme: {
                                    type: 'string',
                                    description: 'Scheme name (optional)',
                                },
                                skip_building: {
                                    type: 'boolean',
                                    description: 'Whether to skip building',
                                },
                            },
                            required: ['xcodeproj'],
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
                        name: 'find_xcresults',
                        description: 'Find all XCResult files for a specific project with timestamps and file information',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_get_run_destinations',
                        description: 'Get list of available run destinations for a specific project',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_get_workspace_info',
                        description: 'Get information about a specific workspace',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_get_projects',
                        description: 'Get list of projects in a specific workspace',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcodeproj: {
                                    type: 'string',
                                    description: 'Path to the .xcodeproj file (or .xcworkspace if available) - supports both absolute (/path/to/project.xcodeproj) and relative (MyApp.xcodeproj) paths',
                                },
                            },
                            required: ['xcodeproj'],
                        },
                    },
                    {
                        name: 'xcode_open_file',
                        description: 'Open a file in Xcode',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                file_path: {
                                    type: 'string',
                                    description: 'Path to the file to open - supports both absolute (/path/to/file.swift) and relative (src/file.swift) paths',
                                },
                                line_number: {
                                    type: 'number',
                                    description: 'Optional line number to navigate to',
                                },
                            },
                            required: ['file_path'],
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
                    {
                        name: 'xcresult_browse',
                        description: 'Browse XCResult files - list all tests or show details for a specific test. Returns comprehensive test results including pass/fail status, failure details, and browsing instructions. Large console output (>20 lines or >2KB) is automatically saved to a temporary file.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                                test_id: {
                                    type: 'string',
                                    description: 'Optional test ID or index number to show details for a specific test',
                                },
                                include_console: {
                                    type: 'boolean',
                                    description: 'Whether to include console output and test activities (only used with test_id)',
                                    default: false,
                                },
                            },
                            required: ['xcresult_path'],
                        },
                    },
                    {
                        name: 'xcresult_browser_get_console',
                        description: 'Get console output and test activities for a specific test in an XCResult file. Large output (>20 lines or >2KB) is automatically saved to a temporary file.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                                test_id: {
                                    type: 'string',
                                    description: 'Test ID or index number to get console output for',
                                },
                            },
                            required: ['xcresult_path', 'test_id'],
                        },
                    },
                    {
                        name: 'xcresult_summary',
                        description: 'Get a quick summary of test results from an XCResult file',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                            },
                            required: ['xcresult_path'],
                        },
                    },
                    {
                        name: 'xcresult_get_screenshot',
                        description: 'Get screenshot from a failed test at specific timestamp - extracts frame from video attachment using ffmpeg',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                                test_id: {
                                    type: 'string',
                                    description: 'Test ID or index number to get screenshot for',
                                },
                                timestamp: {
                                    type: 'number',
                                    description: 'Timestamp in seconds when to extract the screenshot. WARNING: Use a timestamp BEFORE the failure (e.g., if failure is at 30.71s, use 30.69s) as failure timestamps often show the home screen after the app has crashed or reset.',
                                },
                            },
                            required: ['xcresult_path', 'test_id', 'timestamp'],
                        },
                    },
                    {
                        name: 'xcresult_get_ui_hierarchy',
                        description: 'Get UI hierarchy attachment from test. Returns raw accessibility tree (best for AI), slim AI-readable JSON (default), or full JSON.',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                                test_id: {
                                    type: 'string',
                                    description: 'Test ID or index number to get UI hierarchy for',
                                },
                                timestamp: {
                                    type: 'number',
                                    description: 'Optional timestamp in seconds to find the closest UI snapshot. If not provided, uses the first available UI snapshot.',
                                },
                                full_hierarchy: {
                                    type: 'boolean',
                                    description: 'Set to true to get the full hierarchy (several MB). Default is false for AI-readable slim version.',
                                },
                                raw_format: {
                                    type: 'boolean',
                                    description: 'Set to true to get the raw accessibility tree text (most AI-friendly). Default is false for JSON format.',
                                },
                            },
                            required: ['xcresult_path', 'test_id'],
                        },
                    },
                    {
                        name: 'xcresult_get_ui_element',
                        description: 'Get full details of a specific UI element by index from a previously exported UI hierarchy JSON file',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                hierarchy_json_path: {
                                    type: 'string',
                                    description: 'Absolute path to the UI hierarchy JSON file (the full version saved by xcresult-get-ui-hierarchy)',
                                },
                                element_index: {
                                    type: 'number',
                                    description: 'Index of the element to get details for (the "j" value from the slim hierarchy)',
                                },
                                include_children: {
                                    type: 'boolean',
                                    description: 'Whether to include children in the response. Defaults to false.',
                                },
                            },
                            required: ['hierarchy_json_path', 'element_index'],
                        },
                    },
                    {
                        name: 'xcresult_list_attachments',
                        description: 'List all attachments for a specific test - shows attachment names, types, and indices for export',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                                test_id: {
                                    type: 'string',
                                    description: 'Test ID or index number to list attachments for',
                                },
                            },
                            required: ['xcresult_path', 'test_id'],
                        },
                    },
                    {
                        name: 'xcresult_export_attachment',
                        description: 'Export a specific attachment by index - can convert App UI hierarchy attachments to JSON',
                        inputSchema: {
                            type: 'object',
                            properties: {
                                xcresult_path: {
                                    type: 'string',
                                    description: 'Absolute path to the .xcresult file',
                                },
                                test_id: {
                                    type: 'string',
                                    description: 'Test ID or index number that contains the attachment',
                                },
                                attachment_index: {
                                    type: 'number',
                                    description: 'Index number of the attachment to export (1-based, from xcresult-list-attachments)',
                                },
                                convert_to_json: {
                                    type: 'boolean',
                                    description: 'If true and attachment is an App UI hierarchy, convert to JSON format',
                                },
                            },
                            required: ['xcresult_path', 'test_id', 'attachment_index'],
                        },
                    },
                ],
            };
        });
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args = {} } = request.params;
            // Resolve relative paths to absolute paths
            if (args.xcodeproj && typeof args.xcodeproj === 'string') {
                const { resolvedPath, error } = PathValidator.resolveAndValidateProjectPath(args.xcodeproj, 'xcodeproj');
                if (error) {
                    return error;
                }
                args.xcodeproj = resolvedPath;
            }
            if (args.filePath && typeof args.filePath === 'string') {
                const path = await import('path');
                if (!path.default.isAbsolute(args.filePath)) {
                    args.filePath = path.default.resolve(process.cwd(), args.filePath);
                }
            }
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
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj\n\n💡 Expected: absolute path to .xcodeproj or .xcworkspace file`);
                        }
                        const result = await ProjectTools.openProject(args.xcodeproj);
                        if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
                            const textContent = result.content[0];
                            if (textContent.type === 'text' && typeof textContent.text === 'string') {
                                if (!textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
                                    this.currentProjectPath = args.xcodeproj;
                                }
                            }
                        }
                        return result;
                    case 'xcode_close_project':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        try {
                            const validationError = PathValidator.validateProjectPath(args.xcodeproj);
                            if (validationError)
                                return validationError;
                            const closeResult = await ProjectTools.closeProject(args.xcodeproj);
                            this.currentProjectPath = null;
                            return closeResult;
                        }
                        catch (closeError) {
                            // Ensure close project never crashes the server
                            Logger.error('Close project error (handled):', closeError);
                            this.currentProjectPath = null;
                            return { content: [{ type: 'text', text: 'Project close attempted - may have completed with dialogs' }] };
                        }
                    case 'xcode_build':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        if (!args.scheme) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
                        }
                        return await BuildTools.build(args.xcodeproj, args.scheme, args.destination || null, this.openProject.bind(this));
                    case 'xcode_clean':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await BuildTools.clean(args.xcodeproj, this.openProject.bind(this));
                    case 'xcode_test':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj\n\n💡 To fix this:\n• Specify the absolute path to your .xcodeproj or .xcworkspace file using the "xcodeproj" parameter\n• Example: /Users/username/MyApp/MyApp.xcodeproj\n• You can drag the project file from Finder to get the path`);
                        }
                        if (!args.destination) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: destination\n\n💡 To fix this:\n• Specify the test destination (e.g., "iPhone 15 Pro Simulator")\n• Use 'get-run-destinations' to see available destinations\n• Example: "iPad Air Simulator" or "iPhone 16 Pro"`);
                        }
                        const testOptions = {};
                        if (args.test_plan_path)
                            testOptions.testPlanPath = args.test_plan_path;
                        if (args.selected_tests)
                            testOptions.selectedTests = args.selected_tests;
                        if (args.selected_test_classes)
                            testOptions.selectedTestClasses = args.selected_test_classes;
                        if (args.test_target_identifier)
                            testOptions.testTargetIdentifier = args.test_target_identifier;
                        if (args.test_target_name)
                            testOptions.testTargetName = args.test_target_name;
                        return await BuildTools.test(args.xcodeproj, args.destination, args.command_line_arguments || [], this.openProject.bind(this), Object.keys(testOptions).length > 0 ? testOptions : undefined);
                    case 'xcode_run':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        if (!args.scheme) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
                        }
                        return await BuildTools.run(args.xcodeproj, args.scheme, args.command_line_arguments || [], this.openProject.bind(this));
                    case 'xcode_debug':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        if (!args.scheme) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
                        }
                        return await BuildTools.debug(args.xcodeproj, args.scheme, args.skip_building, this.openProject.bind(this));
                    case 'xcode_stop':
                        if (!args.xcodeproj) {
                            return { content: [{ type: 'text', text: 'Error: xcodeproj parameter is required' }] };
                        }
                        return await BuildTools.stop(args.xcodeproj);
                    case 'find_xcresults':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await BuildTools.findXCResults(args.xcodeproj);
                    case 'xcode_get_schemes':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await ProjectTools.getSchemes(args.xcodeproj, this.openProject.bind(this));
                    case 'xcode_get_run_destinations':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await ProjectTools.getRunDestinations(args.xcodeproj, this.openProject.bind(this));
                    case 'xcode_set_active_scheme':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        if (!args.scheme_name) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme_name`);
                        }
                        return await ProjectTools.setActiveScheme(args.xcodeproj, args.scheme_name, this.openProject.bind(this));
                    case 'xcode_get_workspace_info':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await InfoTools.getWorkspaceInfo(args.xcodeproj, this.openProject.bind(this));
                    case 'xcode_get_projects':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await InfoTools.getProjects(args.xcodeproj, this.openProject.bind(this));
                    case 'xcode_open_file':
                        if (!args.file_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: file_path`);
                        }
                        return await InfoTools.openFile(args.file_path, args.line_number);
                    case 'xcresult_browse':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        return await XCResultTools.xcresultBrowse(args.xcresult_path, args.test_id, args.include_console || false);
                    case 'xcresult_browser_get_console':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        if (!args.test_id) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                        }
                        return await XCResultTools.xcresultBrowserGetConsole(args.xcresult_path, args.test_id);
                    case 'xcresult_summary':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        return await XCResultTools.xcresultSummary(args.xcresult_path);
                    case 'xcresult_get_screenshot':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        if (!args.test_id) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                        }
                        if (args.timestamp === undefined) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: timestamp`);
                        }
                        return await XCResultTools.xcresultGetScreenshot(args.xcresult_path, args.test_id, args.timestamp);
                    case 'xcresult_get_ui_hierarchy':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        if (!args.test_id) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                        }
                        return await XCResultTools.xcresultGetUIHierarchy(args.xcresult_path, args.test_id, args.timestamp, args.full_hierarchy, args.raw_format);
                    case 'xcresult_get_ui_element':
                        if (!args.hierarchy_json_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: hierarchy_json_path`);
                        }
                        if (args.element_index === undefined) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: element_index`);
                        }
                        return await XCResultTools.xcresultGetUIElement(args.hierarchy_json_path, args.element_index, args.include_children);
                    case 'xcresult_list_attachments':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        if (!args.test_id) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                        }
                        return await XCResultTools.xcresultListAttachments(args.xcresult_path, args.test_id);
                    case 'xcresult_export_attachment':
                        if (!args.xcresult_path) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                        }
                        if (!args.test_id) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                        }
                        if (args.attachment_index === undefined) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: attachment_index`);
                        }
                        return await XCResultTools.xcresultExportAttachment(args.xcresult_path, args.test_id, args.attachment_index, args.convert_to_json);
                    case 'xcode_get_test_targets':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        return await ProjectTools.getTestTargets(args.xcodeproj);
                    case 'xcode_refresh_project':
                        if (!args.xcodeproj) {
                            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                        }
                        // Close and reopen the project to refresh it
                        await ProjectTools.closeProject(args.xcodeproj);
                        const refreshResult = await ProjectTools.openProjectAndWaitForLoad(args.xcodeproj);
                        return {
                            content: [{
                                    type: 'text',
                                    text: `Project refreshed: ${refreshResult.content?.[0]?.type === 'text' ? refreshResult.content[0].text : 'Completed'}`
                                }]
                        };
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
                }
            }
            catch (error) {
                // Enhanced error handling that doesn't crash the server
                Logger.error(`Tool execution error for ${name}:`, error);
                // Check if it's a configuration-related error that we can provide guidance for
                const enhancedError = await this.enhanceErrorWithGuidance(error, name);
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
                            text: `❌ ${name} failed: ${errorMessage}`
                        }]
                };
            }
        });
    }
    async openProject(projectPath) {
        const result = await ProjectTools.openProjectAndWaitForLoad(projectPath);
        if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
            const textContent = result.content[0];
            if (textContent.type === 'text' && typeof textContent.text === 'string') {
                if (!textContent.text.includes('❌') && !textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
                    this.currentProjectPath = projectPath;
                }
            }
        }
        return result;
    }
    async executeJXA(script) {
        const { JXAExecutor } = await import('./utils/JXAExecutor.js');
        return JXAExecutor.execute(script);
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
    // Direct method interfaces for testing/CLI compatibility
    async build(projectPath, schemeName = 'Debug', destination = null) {
        const { BuildTools } = await import('./tools/BuildTools.js');
        return BuildTools.build(projectPath, schemeName, destination, this.openProject.bind(this));
    }
    async clean(projectPath) {
        const { BuildTools } = await import('./tools/BuildTools.js');
        return BuildTools.clean(projectPath, this.openProject.bind(this));
    }
    async test(projectPath, destination, commandLineArguments = []) {
        const { BuildTools } = await import('./tools/BuildTools.js');
        return BuildTools.test(projectPath, destination, commandLineArguments, this.openProject.bind(this));
    }
    async run(projectPath, commandLineArguments = []) {
        const { BuildTools } = await import('./tools/BuildTools.js');
        return BuildTools.run(projectPath, 'Debug', commandLineArguments, this.openProject.bind(this));
    }
    async debug(projectPath, scheme, skipBuilding = false) {
        const { BuildTools } = await import('./tools/BuildTools.js');
        return BuildTools.debug(projectPath, scheme, skipBuilding, this.openProject.bind(this));
    }
    async stop(projectPath) {
        if (!projectPath) {
            return { content: [{ type: 'text', text: 'Error: projectPath parameter is required' }] };
        }
        const { BuildTools } = await import('./tools/BuildTools.js');
        return BuildTools.stop(projectPath);
    }
    async getSchemes(projectPath) {
        const { ProjectTools } = await import('./tools/ProjectTools.js');
        return ProjectTools.getSchemes(projectPath, this.openProject.bind(this));
    }
    async getRunDestinations(projectPath) {
        const { ProjectTools } = await import('./tools/ProjectTools.js');
        return ProjectTools.getRunDestinations(projectPath, this.openProject.bind(this));
    }
    async setActiveScheme(projectPath, schemeName) {
        const { ProjectTools } = await import('./tools/ProjectTools.js');
        return ProjectTools.setActiveScheme(projectPath, schemeName, this.openProject.bind(this));
    }
    async getWorkspaceInfo(projectPath) {
        const { InfoTools } = await import('./tools/InfoTools.js');
        return InfoTools.getWorkspaceInfo(projectPath, this.openProject.bind(this));
    }
    async getProjects(projectPath) {
        const { InfoTools } = await import('./tools/InfoTools.js');
        return InfoTools.getProjects(projectPath, this.openProject.bind(this));
    }
    async openFile(filePath, lineNumber) {
        const { InfoTools } = await import('./tools/InfoTools.js');
        return InfoTools.openFile(filePath, lineNumber);
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
    /**
     * Call a tool directly without going through the MCP protocol
     * This is used by the CLI to bypass the JSON-RPC layer
     */
    async callToolDirect(name, args = {}) {
        // This is essentially the same logic as the CallToolRequestSchema handler
        // Resolve relative paths to absolute paths (this is actually handled by CLI now, but keep for safety)
        if (args.xcodeproj && typeof args.xcodeproj === 'string') {
            const { resolvedPath, error } = PathValidator.resolveAndValidateProjectPath(args.xcodeproj, 'xcodeproj');
            if (error) {
                return error;
            }
            args.xcodeproj = resolvedPath;
        }
        if (args.filePath && typeof args.filePath === 'string') {
            const path = await import('path');
            if (!path.default.isAbsolute(args.filePath)) {
                args.filePath = path.default.resolve(process.cwd(), args.filePath);
            }
        }
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
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj\n\n💡 Expected: absolute path to .xcodeproj or .xcworkspace file`);
                    }
                    const result = await ProjectTools.openProject(args.xcodeproj);
                    if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
                        const textContent = result.content[0];
                        if (textContent.type === 'text' && typeof textContent.text === 'string') {
                            if (!textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
                                this.currentProjectPath = args.xcodeproj;
                            }
                        }
                    }
                    return result;
                case 'xcode_close_project':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    try {
                        const validationError = PathValidator.validateProjectPath(args.xcodeproj);
                        if (validationError)
                            return validationError;
                        const closeResult = await ProjectTools.closeProject(args.xcodeproj);
                        this.currentProjectPath = null;
                        return closeResult;
                    }
                    catch (closeError) {
                        // Ensure close project never crashes the server
                        Logger.error('Close project error (handled):', closeError);
                        this.currentProjectPath = null;
                        return { content: [{ type: 'text', text: 'Project close attempted - may have completed with dialogs' }] };
                    }
                case 'xcode_build':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    if (!args.scheme) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
                    }
                    return await BuildTools.build(args.xcodeproj, args.scheme, args.destination || null, this.openProject.bind(this));
                case 'xcode_clean':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await BuildTools.clean(args.xcodeproj, this.openProject.bind(this));
                case 'xcode_test':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj\n\n💡 To fix this:\n• Specify the absolute path to your .xcodeproj or .xcworkspace file using the "xcodeproj" parameter\n• Example: /Users/username/MyApp/MyApp.xcodeproj\n• You can drag the project file from Finder to get the path`);
                    }
                    if (!args.destination) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: destination\n\n💡 To fix this:\n• Specify the test destination (e.g., "iPhone 15 Pro Simulator")\n• Use 'get-run-destinations' to see available destinations\n• Example: "iPad Air Simulator" or "iPhone 16 Pro"`);
                    }
                    return await BuildTools.test(args.xcodeproj, args.destination, args.command_line_arguments || [], this.openProject.bind(this));
                case 'xcode_run':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    if (!args.scheme) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
                    }
                    return await BuildTools.run(args.xcodeproj, args.scheme, args.command_line_arguments || [], this.openProject.bind(this));
                case 'xcode_debug':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    if (!args.scheme) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
                    }
                    return await BuildTools.debug(args.xcodeproj, args.scheme, args.skip_building, this.openProject.bind(this));
                case 'xcode_stop':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await BuildTools.stop(args.xcodeproj);
                case 'find_xcresults':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await BuildTools.findXCResults(args.xcodeproj);
                case 'xcode_get_schemes':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await ProjectTools.getSchemes(args.xcodeproj, this.openProject.bind(this));
                case 'xcode_get_run_destinations':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await ProjectTools.getRunDestinations(args.xcodeproj, this.openProject.bind(this));
                case 'xcode_set_active_scheme':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    if (!args.scheme_name) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme_name`);
                    }
                    return await ProjectTools.setActiveScheme(args.xcodeproj, args.scheme_name, this.openProject.bind(this));
                case 'xcode_get_workspace_info':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await InfoTools.getWorkspaceInfo(args.xcodeproj, this.openProject.bind(this));
                case 'xcode_get_projects':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await InfoTools.getProjects(args.xcodeproj, this.openProject.bind(this));
                case 'xcode_open_file':
                    if (!args.file_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: file_path`);
                    }
                    return await InfoTools.openFile(args.file_path, args.line_number);
                case 'xcresult_browse':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    return await XCResultTools.xcresultBrowse(args.xcresult_path, args.test_id, args.include_console || false);
                case 'xcresult_browser_get_console':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    if (!args.test_id) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                    }
                    return await XCResultTools.xcresultBrowserGetConsole(args.xcresult_path, args.test_id);
                case 'xcresult_summary':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    return await XCResultTools.xcresultSummary(args.xcresult_path);
                case 'xcresult_get_screenshot':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    if (!args.test_id) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                    }
                    if (args.timestamp === undefined) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: timestamp`);
                    }
                    return await XCResultTools.xcresultGetScreenshot(args.xcresult_path, args.test_id, args.timestamp);
                case 'xcresult_get_ui_hierarchy':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    if (!args.test_id) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                    }
                    return await XCResultTools.xcresultGetUIHierarchy(args.xcresult_path, args.test_id, args.timestamp, args.full_hierarchy, args.raw_format);
                case 'xcresult_get_ui_element':
                    if (!args.hierarchy_json_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: hierarchy_json_path`);
                    }
                    if (args.element_index === undefined) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: element_index`);
                    }
                    return await XCResultTools.xcresultGetUIElement(args.hierarchy_json_path, args.element_index, args.include_children);
                case 'xcresult_list_attachments':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    if (!args.test_id) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                    }
                    return await XCResultTools.xcresultListAttachments(args.xcresult_path, args.test_id);
                case 'xcresult_export_attachment':
                    if (!args.xcresult_path) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
                    }
                    if (!args.test_id) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
                    }
                    if (args.attachment_index === undefined) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: attachment_index`);
                    }
                    return await XCResultTools.xcresultExportAttachment(args.xcresult_path, args.test_id, args.attachment_index, args.convert_to_json);
                case 'xcode_get_test_targets':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    return await ProjectTools.getTestTargets(args.xcodeproj);
                case 'xcode_refresh_project':
                    if (!args.xcodeproj) {
                        throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
                    }
                    // Close and reopen the project to refresh it
                    await ProjectTools.closeProject(args.xcodeproj);
                    const refreshResult = await ProjectTools.openProjectAndWaitForLoad(args.xcodeproj);
                    return {
                        content: [{
                                type: 'text',
                                text: `Project refreshed: ${refreshResult.content?.[0]?.type === 'text' ? refreshResult.content[0].text : 'Completed'}`
                            }]
                    };
                default:
                    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
            }
        }
        catch (error) {
            // Enhanced error handling that doesn't crash the server
            Logger.error(`Tool execution error for ${name}:`, error);
            // Check if it's a configuration-related error that we can provide guidance for
            const enhancedError = await this.enhanceErrorWithGuidance(error, name);
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
    }
}
//# sourceMappingURL=XcodeServer.js.map