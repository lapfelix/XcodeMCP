# XcodeMCP

[![npm version](https://img.shields.io/npm/v/xcodemcp.svg)](https://www.npmjs.com/package/xcodemcp)
[![Test Status](https://github.com/lapfelix/XcodeMCP/actions/workflows/test.yml/badge.svg)](https://github.com/lapfelix/XcodeMCP/actions/workflows/test.yml)

MCP server for Xcode build automation and log parsing.

## What it does

- Opens Xcode projects and triggers builds _in Xcode, not using xcodebuild. [^1]_
- Parses build logs to extract errors and warnings with precise line:column numbers using [XCLogParser](https://github.com/MobileNativeFoundation/XCLogParser)
- Provides MCP tools for AI assistants to interact with Xcode

[^1]: For an alternative that uses `xcodebuild`, see [XcodeBuildMCP](https://github.com/cameroncooke/XcodeBuildMCP)

> **⚠️ Warning**: This tool directly controls Xcode through JavaScript for Automation (JXA). It may interfere with your active Xcode session and trigger builds that could overwrite unsaved work. Use with caution in active development environments.

## Requirements

- macOS with Xcode installed
- Node.js 18+
- XCLogParser: `brew install xclogparser`

## Usage

### Quick Install

[<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://insiders.vscode.dev/redirect/mcp/install?name=xcodemcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22xcodemcp%40latest%22%5D%7D)
[<img alt="Install in VS Code Insiders" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5">](https://insiders.vscode.dev/redirect/mcp/install?name=xcodemcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22xcodemcp%40latest%22%5D%7D&quality=insiders)
[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" height=20 alt="Install MCP Server">](https://cursor.com/install-mcp?name=XcodeMCP&config=eyJjb21tYW5kIjoibnB4IHhjb2RlbWNwQGxhdGVzdCIsImVudiI6e319)

### Install from npm

Run directly with npx:
```bash
brew install xclogparser
npx -y xcodemcp@latest
```

Or install globally:
```bash
brew install xclogparser
npm install -g xcodemcp
```

### MCP Configuration

Add to your MCP configuration:
```json
{
  "mcpServers": {
    "xcodemcp": {
      "command": "npx",
      "args": ["-y", "xcodemcp@latest"],
      "env": {}
    }
  }
}
```

### Claude Code CLI Setup

To add XcodeMCP to Claude Code using the command line:
```bash
claude mcp add-json XcodeMCP '{
  "command": "npx",
  "args": ["-y", "xcodemcp@latest"],
  "env": {}
}'
```

Or clone locally:
```bash
git clone https://github.com/lapfelix/XcodeMCP.git
cd XcodeMCP
npm install
node index.js
```

## Available Tools

- `xcode_open_project` - Open Xcode projects and workspaces
- `xcode_build` - Build with optional scheme and destination, returns errors/warnings with line:column numbers
- `xcode_clean` - Clean build artifacts
- `xcode_test` - Run unit and UI tests with optional command line arguments
- `xcode_run` - Run the active scheme with optional command line arguments
- `xcode_debug` - Start debugging session with optional scheme
- `xcode_stop` - Stop current build/run/test operation
- `xcode_get_schemes` - List all available schemes with active status
- `xcode_set_active_scheme` - Switch between schemes
- `xcode_get_run_destinations` - List simulators and devices with platform info
- `xcode_get_workspace_info` - Get workspace details and current status
- `xcode_get_projects` - List projects in workspace
- `xcode_open_file` - Open specific files in Xcode with optional line number

## Example

```bash
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "xcode_build", "arguments": {}}}' | node index.js
```

Output:
```
❌ BUILD FAILED (1 errors)
ERRORS:
  • /path/file.swift:42:10: Expected expression

⚠️ BUILD COMPLETED WITH WARNINGS (2 warnings)
WARNINGS:  
  • /path/file.swift:25: Variable 'unused' was never mutated; consider changing to 'let' constant
  • /path/file.swift:30:5: Initialization of immutable value 'data' was never used
```
