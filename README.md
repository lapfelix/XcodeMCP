# Xcode MCP Server

An MCP (Model Context Protocol) server that provides automation capabilities for Xcode through JavaScript for Automation (JXA). This server wraps Xcode's AppleScript dictionary to enable programmatic control of Xcode projects, builds, testing, and debugging.

## Features

- **Project Management**: Open Xcode projects and workspaces
- **Build Operations**: Build, clean, and stop build processes
- **Testing**: Run test suites with optional command line arguments
- **Debugging**: Start and control debugging sessions
- **Scheme Management**: List, get, and set active build schemes
- **Device Management**: List and manage run destinations
- **File Operations**: Open files with optional line navigation
- **Workspace Information**: Get detailed workspace and project information

## Installation

```bash
npm install
```

## Usage

### As MCP Server

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "xcode": {
      "command": "node",
      "args": ["/path/to/XcodeMCP/index.js"]
    }
  }
}
```

### Direct Usage

```bash
npm start
```

## Available Tools

### Project Operations
- `xcode_open_project` - Open an Xcode project or workspace
- `xcode_open_file` - Open a specific file in Xcode with optional line navigation

### Build Operations  
- `xcode_build` - Build the active workspace
- `xcode_clean` - Clean the active workspace
- `xcode_stop` - Stop the current scheme action

### Testing & Running
- `xcode_test` - Run tests with optional command line arguments
- `xcode_run` - Run the active scheme with optional arguments
- `xcode_debug` - Start debugging session with optional scheme and build settings

### Information & Management
- `xcode_get_schemes` - List all available schemes
- `xcode_get_run_destinations` - List available run destinations (devices/simulators)
- `xcode_set_active_scheme` - Set the active build scheme
- `xcode_get_workspace_info` - Get workspace information
- `xcode_get_projects` - List projects in the workspace

## Requirements

- macOS with Xcode installed
- Node.js 18+
- Accessibility permissions for Terminal/your MCP client to control Xcode

## Examples

### Open a project and build
```javascript
// Open project
await callTool('xcode_open_project', { path: '/path/to/MyApp.xcodeproj' });

// Build the project
await callTool('xcode_build', {});
```

### Run tests with arguments
```javascript
await callTool('xcode_test', { 
  commandLineArguments: ['-v', '--parallel-testing-enabled', 'YES'] 
});
```

### Switch scheme and run
```javascript
// List available schemes
await callTool('xcode_get_schemes', {});

// Set active scheme
await callTool('xcode_set_active_scheme', { schemeName: 'MyApp-Release' });

// Run with scheme
await callTool('xcode_run', {});
```

## Technical Details

This server uses JavaScript for Automation (JXA) to communicate with Xcode through its AppleScript interface. All operations are asynchronous and return appropriate status messages or structured data.

The server implements the MCP (Model Context Protocol) specification, making it compatible with various AI assistants and automation tools that support MCP.

## Error Handling

The server includes comprehensive error handling for common scenarios:
- No active workspace
- Invalid scheme names
- File not found errors
- Xcode not running
- Build/test failures

## License

MIT