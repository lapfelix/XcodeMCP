export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
  cliName?: string;
  cliAliases?: string[];
  cliHidden?: boolean;
}

/**
 * Get all tool definitions shared between CLI and MCP
 */
export function getToolDefinitions(options: { 
  includeClean?: boolean;
  preferredScheme?: string;
  preferredXcodeproj?: string;
} = { includeClean: true }): ToolDefinition[] {
  const { includeClean = true, preferredScheme, preferredXcodeproj } = options;
  const tools: ToolDefinition[] = [
    {
      name: 'xcode_build',
      description: 'Build a specific Xcode project or workspace with the specified scheme. If destination is not provided, uses the currently active destination. ⏱️ Can take minutes to hours - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file to build (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file to build (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme: {
            type: 'string',
            description: preferredScheme 
              ? `Name of the scheme to build - defaults to ${preferredScheme}`
              : 'Name of the scheme to build',
          },
          destination: {
            type: 'string',
            description: 'Build destination (optional - uses active destination if not provided)',
          },
          reason: {
            type: 'string',
            description: 'One-line reason for holding the build lock (e.g., "Working on onboarding flow").',
          },
        },
        required: [
          'reason',
          ...(!preferredXcodeproj ? ['xcodeproj'] : []),
          ...(!preferredScheme ? ['scheme'] : [])
        ],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme_name: {
            type: 'string',
            description: 'Name of the scheme to activate',
          },
        },
        required: preferredXcodeproj ? ['scheme_name'] : ['xcodeproj', 'scheme_name'],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          destination: {
            type: 'string',
            description: 'Explicit xcodebuild destination string (e.g., "platform=iOS Simulator,name=iPhone 16"). Optional when device_type/os_version are supplied.',
          },
          device_type: {
            type: 'string',
            description: 'High-level device family to target (e.g., iphone, ipad, mac, watch, tv, vision). When provided, os_version is recommended.',
          },
          os_version: {
            type: 'string',
            description: 'Desired OS version for the selected device family (e.g., 18.0, 26.0). Used with device_type.',
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
          scheme: {
            type: 'string',
            description: preferredScheme
              ? `Name of the test scheme - defaults to ${preferredScheme}`
              : 'Name of the test scheme to run',
          },
        },
        required: [
          ...(!preferredXcodeproj ? ['xcodeproj'] : []),
          ...(!preferredScheme ? ['scheme'] : [])
        ],
      },
    },
    {
      name: 'xcode_build_and_run',
      description: 'Build and run a specific project with the specified scheme. ⏱️ Can run indefinitely - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme: {
            type: 'string',
            description: preferredScheme 
              ? `Name of the scheme to run - defaults to ${preferredScheme}`
              : 'Name of the scheme to run',
          },
          command_line_arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional command line arguments',
          },
          reason: {
            type: 'string',
            description: 'One-line reason for holding the build & run lock (helps other workers coordinate).',
          },
        },
        required: [
          'reason',
          ...(!preferredXcodeproj ? ['xcodeproj'] : []),
          ...(!preferredScheme ? ['scheme'] : [])
        ],
      },
    },
    {
      name: 'xcode_release_lock',
      cliName: 'release-lock',
      description: 'Release the exclusive build/run lock for a project or workspace once you are finished inspecting the results.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj
              ? `Absolute path to the .xcodeproj or .xcworkspace whose lock you want to release - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj or .xcworkspace whose lock you want to release.',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_find_xcresults',
      description: 'Find all XCResult files for a specific project with timestamps and file information',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
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
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
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
      name: 'xcode_view_build_log',
      cliName: 'view-build-log',
      cliAliases: ['get-build-log'],
      description:
        'Display the build/run log captured for a project. Supply a log_id returned by build/run commands or a project path to view the latest log.',
      inputSchema: {
        type: 'object',
        properties: {
          log_id: {
            type: 'string',
            description: 'Log ID returned by xcode_build/xcode_build_and_run when the log was registered.',
          },
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the project/workspace. Used to locate the most recent log when log_id is not provided.',
          },
          filter: {
            type: 'string',
            description: 'Optional filter string. Matches are case-insensitive unless case_sensitive=true.',
          },
          filter_regex: {
            type: 'boolean',
            description: 'Treat filter as a JavaScript regex pattern.',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Make the filter match case-sensitive (default false).',
          },
          max_lines: {
            type: 'number',
            description: 'Maximum number of log lines to return (default 400).',
          },
          filter_globs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional glob patterns (e.g., "*error*", "??-warning") to match multiple expressions. Separate with commas when using the CLI.',
          },
          cursor: {
            type: 'string',
            description: 'Cursor returned by a previous call. When supplied, only shows new log output written since that cursor.',
          },
        },
      },
    },
    {
      name: 'xcode_view_run_log',
      cliName: 'view-run-log',
      cliAliases: ['get-run-log'],
      description:
        'Display the runtime console log captured for the most recent run. Supply a log_id returned by build-and-run or use a project path to view the latest log.',
      inputSchema: {
        type: 'object',
        properties: {
          log_id: {
            type: 'string',
            description: 'Log ID returned by xcode_build_and_run when the run log was registered.',
          },
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the project/workspace. Used to locate the most recent run log when log_id is not provided.',
          },
          filter: {
            type: 'string',
            description: 'Optional filter string. Matches are case-insensitive unless case_sensitive=true.',
          },
          filter_regex: {
            type: 'boolean',
            description: 'Treat filter as a JavaScript regex pattern.',
          },
          filter_globs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional glob patterns (e.g., "*error*", "??-warning") to match multiple expressions. Separate with commas when using the CLI.',
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Make the filter match case-sensitive (default false).',
          },
          max_lines: {
            type: 'number',
            description: 'Maximum number of log lines to return (default 400).',
          },
          cursor: {
            type: 'string',
            description: 'Cursor returned by a previous call. When supplied, only shows new log output written since that cursor.',
          },
        },
      },
    },
    {
      name: 'xcode_list_sims',
      description: 'List available iOS simulators with their states and runtime information.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'xcode_boot_sim',
      description: 'Boot an iOS simulator using its UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to boot (use list_sims to discover).',
          },
        },
        required: ['simulator_uuid'],
      },
    },
    {
      name: 'xcode_open_sim',
      description: 'Open the Simulator application.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'xcode_shutdown_sim',
      description: 'Shut down a running simulator.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to shut down.',
          },
        },
        required: ['simulator_uuid'],
      },
    },
    {
      name: 'xcode_screenshot',
      description: 'Capture a PNG screenshot from a simulator. Returns the image as base64 data.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'Optional simulator UUID (defaults to the booted simulator).',
          },
          save_path: {
            type: 'string',
            description: 'Optional path to save the screenshot on disk.',
          },
        },
      },
    },
    {
      name: 'xcode_describe_ui',
      description:
        'Return the accessibility hierarchy for the running simulator using AXe. Provides coordinates for automation.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to inspect.',
          },
        },
        required: ['simulator_uuid'],
      },
    },
    {
      name: 'xcode_tap',
      description:
        'Tap at specific coordinates using AXe. Use describe_ui first to gather accurate positions.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to interact with.',
          },
          x: {
            type: 'number',
            description: 'X coordinate in simulator points.',
          },
          y: {
            type: 'number',
            description: 'Y coordinate in simulator points.',
          },
          pre_delay: {
            type: 'number',
            description: 'Optional delay before performing the tap (seconds).',
          },
          post_delay: {
            type: 'number',
            description: 'Optional delay after performing the tap (seconds).',
          },
        },
        required: ['simulator_uuid', 'x', 'y'],
      },
    },
    {
      name: 'xcode_type_text',
      description: 'Type text into the simulator using AXe keyboard events. Focus the target field first.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to interact with.',
          },
          text: {
            type: 'string',
            description: 'Text to type (standard US keyboard characters).',
          },
        },
        required: ['simulator_uuid', 'text'],
      },
    },
    {
      name: 'xcode_swipe',
      description:
        'Swipe from one coordinate to another using AXe. Coordinates are provided in simulator points.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to interact with.',
          },
          x1: {
            type: 'number',
            description: 'Start X coordinate.',
          },
          y1: {
            type: 'number',
            description: 'Start Y coordinate.',
          },
          x2: {
            type: 'number',
            description: 'End X coordinate.',
          },
          y2: {
            type: 'number',
            description: 'End Y coordinate.',
          },
          duration: {
            type: 'number',
            description: 'Optional swipe duration in seconds.',
          },
          delta: {
            type: 'number',
            description: 'Optional sampling delta for the gesture.',
          },
          pre_delay: {
            type: 'number',
            description: 'Optional delay before performing the swipe.',
          },
          post_delay: {
            type: 'number',
            description: 'Optional delay after performing the swipe.',
          },
        },
        required: ['simulator_uuid', 'x1', 'y1', 'x2', 'y2'],
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
      name: 'xcode_xcresult_browse',
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
      name: 'xcode_xcresult_browser_get_console',
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
      name: 'xcode_xcresult_summary',
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
      name: 'xcode_xcresult_get_screenshot',
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
      name: 'xcode_xcresult_get_ui_hierarchy',
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
      name: 'xcode_xcresult_get_ui_element',
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
      name: 'xcode_xcresult_list_attachments',
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
      name: 'xcode_xcresult_export_attachment',
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
    }
  ];

  // Conditionally add the clean tool
  if (includeClean) {
    tools.splice(5, 0, {
      name: 'xcode_clean',
      description: 'Clean the build directory for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    });
  }

  return tools;
}
