# XcodeMCP

A Model Context Protocol (MCP) server that provides programmatic access to Xcode build automation and log parsing.

## Features

- **Xcode Automation**: Open projects, trigger builds, run tests, and more via JXA (JavaScript for Automation)
- **Build Log Parsing**: Extract compilation errors and warnings from Xcode's binary `.xcactivitylog` files  
- **Real-time Build Monitoring**: Track build progress and get results as soon as builds complete
- **Professional Log Analysis**: Uses [XCLogParser](https://github.com/MobileNativeFoundation/XCLogParser) for accurate parsing of Apple's proprietary log format

## Requirements

- **macOS**: Required for Xcode automation
- **Node.js**: For running the MCP server
- **Xcode**: Must be installed and accessible
- **XCLogParser**: Required for parsing build logs
  ```bash
  brew install xclogparser
  ```

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Install XCLogParser:
   ```bash
   brew install xclogparser
   ```

## Usage

### As MCP Server

Start the server in stdio mode:
```bash
node index.js
```

The server provides these MCP tools:

- `xcode_open_project` - Open an Xcode project or workspace
- `xcode_build` - Build the active workspace and parse results
- `xcode_clean` - Clean the active workspace  
- `xcode_test` - Run tests for the active workspace
- `xcode_run` - Run the active scheme
- `xcode_debug` - Start debugging session
- `xcode_stop` - Stop current scheme action
- `xcode_get_schemes` - List available schemes
- `xcode_get_run_destinations` - List available run destinations
- `xcode_set_active_scheme` - Set the active scheme
- `xcode_get_workspace_info` - Get workspace information
- `xcode_get_projects` - List projects in workspace
- `xcode_open_file` - Open a file in Xcode

### Direct Testing

You can test individual tools using JSON-RPC:

```bash
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "xcode_open_project", "arguments": {"path": "/path/to/Project.xcodeproj"}}}' | node index.js
```

### Build Error Parsing

The server automatically:
1. Monitors DerivedData for new build logs
2. Uses XCLogParser to extract compilation errors and warnings
3. Returns formatted results with file paths and error messages

Example build output:
```
❌ BUILD FAILED (1 errors)

ERRORS:
  • /path/to/file.swift: 'SomeType' file not found
```

## Architecture

- **JXA Integration**: Uses Apple's JavaScript for Automation to control Xcode
- **Log Monitoring**: Watches DerivedData directories for new `.xcactivitylog` files
- **Professional Parsing**: Leverages XCLogParser for reliable extraction from binary logs
- **MCP Protocol**: Implements Model Context Protocol for seamless AI assistant integration

## Error Handling

The server provides helpful error messages when dependencies are missing:

- Clear installation instructions for XCLogParser
- Guidance for Xcode automation permissions
- Detailed error context for debugging

## Development

Run tests:
```bash
npm test
```

The project includes several utility scripts for testing specific functionality:
- `xclogparser_test.js` - Test XCLogParser integration
- `comprehensive_log_parser.js` - Test various parsing approaches
- `test_missing_xclogparser.js` - Test error handling

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Related Projects

- [XCLogParser](https://github.com/MobileNativeFoundation/XCLogParser) - Professional Xcode log parser
- [Model Context Protocol](https://modelcontextprotocol.io) - Protocol for AI assistant integrations