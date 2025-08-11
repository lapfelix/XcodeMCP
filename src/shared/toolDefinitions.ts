export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
}

/**
 * Get all tool definitions shared between CLI and MCP
 */
export function getToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'xcode_open_project',
      description: 'Open an Xcode project or workspace',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: ['xcodeproj'],
      },
    },
    {
      name: 'xcode_build',
      description: 'Build a specific Xcode project or workspace with the specified scheme. If destination is not provided, uses the currently active destination. ⏱️ Can take minutes to hours - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file to build (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: ['xcodeproj'],
      },
    },
    {
      name: 'xcode_test',
      description: 'Run tests for a specific project. Optionally run only specific tests or test classes by temporarily modifying the test plan (automatically restored after completion). ⏱️ Can take minutes to hours - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          destination: {
            type: 'string',
            description: 'Test destination (required for predictable test environments) - e.g., "iPhone 15 Pro Simulator", "iPad Air Simulator"',
          },
          command_line_arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional command line arguments',
          },
          test_plan_path: {
            type: 'string',
            description: 'Optional: Absolute path to .xctestplan file to temporarily modify for selective test execution',
          },
          selected_tests: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Array of specific test identifiers to run. Format depends on test framework: XCTest: "TestAppUITests/testExample" (no parentheses), Swift Testing: "TestAppTests/example". Requires test_plan_path.',
          },
          selected_test_classes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Array of test class names to run (e.g., ["TestAppTests", "TestAppUITests"]). This runs ALL tests in the specified classes. Requires test_plan_path.',
          },
          test_target_identifier: {
            type: 'string',
            description: 'Optional: Target identifier for the test target (required when using test filtering). Can be found in project.pbxproj.',
          },
          test_target_name: {
            type: 'string',
            description: 'Optional: Target name for the test target (alternative to test_target_identifier). Example: "TestAppTests".',
          },
        },
        required: ['xcodeproj', 'destination'],
      },
    },
    {
      name: 'xcode_run',
      description: 'Run a specific project with the specified scheme. ⏱️ Can run indefinitely - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
      description: 'Start debugging session for a specific project. ⏱️ Can run indefinitely - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
      description: 'Stop the current scheme action for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: ['xcodeproj'],
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
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
            description: 'Absolute path to the file to open',
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
    {
      name: 'xcode_refresh_project',
      description: 'Refresh/reload an Xcode project by closing and reopening it to pick up external changes like modified .xctestplan files',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) to refresh',
          },
        },
        required: ['xcodeproj'],
      },
    },
    {
      name: 'xcode_get_test_targets',
      description: 'Get information about test targets in a project, including names and identifiers',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available)',
          },
        },
        required: ['xcodeproj'],
      },
    },
  ];
}