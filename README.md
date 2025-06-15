# XcodeMCP

[![npm version](https://img.shields.io/npm/v/xcodemcp.svg)](https://www.npmjs.com/package/xcodemcp)
[![Test Status](https://github.com/lapfelix/XcodeMCP/actions/workflows/test.yml/badge.svg)](https://github.com/lapfelix/XcodeMCP/actions/workflows/test.yml)

Model Context Protocol (MCP) server that controls Xcode directly through JavaScript for Automation (JXA).

<a href="https://glama.ai/mcp/servers/@lapfelix/XcodeMCP">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@lapfelix/XcodeMCP/badge" alt="XcodeMCP MCP server" />
</a>

## What it does

- Controls Xcode directly through JavaScript for Automation (not xcodebuild CLI)
- Opens projects, builds, runs, tests, and debugs from within Xcode
- Parses build logs with precise error locations using [XCLogParser](https://github.com/MobileNativeFoundation/XCLogParser)
- Provides comprehensive environment validation and health checks
- Supports graceful degradation when optional dependencies are missing

> **⚠️ Warning**: This tool directly controls Xcode through JavaScript for Automation (JXA). It may interfere with your active Xcode session and trigger builds that could overwrite unsaved work. Use with caution in active development environments.

## Requirements

- macOS with Xcode installed
- Node.js 18+
- XCLogParser (recommended): `brew install xclogparser`

## Usage

### Quick Install

[<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://insiders.vscode.dev/redirect/mcp/install?name=xcodemcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22xcodemcp%40latest%22%5D%7D)
[<img alt="Install in VS Code Insiders" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5">](https://insiders.vscode.dev/redirect/mcp/install?name=xcodemcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22xcodemcp%40latest%22%5D%7D&quality=insiders)
[<img src="https://cursor.com/deeplink/mcp-install-dark.svg" height=20 alt="Install MCP Server">](https://cursor.com/install-mcp?name=XcodeMCP&config=eyJjb21tYW5kIjoibnB4IHhjb2RlbWNwQGxhdGVzdCIsImVudiI6e319)

XCLogParser is recommended but optional:
```bash
brew install xclogparser
```

### Install from npm

Run directly with npx:
```bash
npx -y xcodemcp@latest
```

Or install globally:
```bash
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
      "env": {
        "LOG_LEVEL": "INFO"
      }
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
  "env": {
    "LOG_LEVEL": "INFO"
  }
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

**Project Management:**
- `xcode_open_project` - Open projects and workspaces
- `xcode_get_workspace_info` - Get workspace status and details
- `xcode_get_projects` - List projects in workspace
- `xcode_open_file` - Open files with optional line number

**Build Operations:**
- `xcode_build` - Build with detailed error parsing
- `xcode_clean` - Clean build artifacts
- `xcode_test` - Run tests with optional arguments
- `xcode_run` - Run the active scheme
- `xcode_debug` - Start debugging session
- `xcode_stop` - Stop current operation

**Configuration:**
- `xcode_get_schemes` - List available schemes
- `xcode_set_active_scheme` - Switch active scheme
- `xcode_get_run_destinations` - List simulators and devices

**Diagnostics:**
- `xcode_health_check` - Environment validation and troubleshooting

## Configuration

### Logging Configuration

XcodeMCP supports configurable logging to help with debugging and monitoring:

#### Environment Variables

- **`LOG_LEVEL`**: Controls logging verbosity (default: `INFO`)
  - `SILENT`: No logging output
  - `ERROR`: Only error messages
  - `WARN`: Warnings and errors
  - `INFO`: General operational information (recommended)
  - `DEBUG`: Detailed diagnostic information

- **`XCODEMCP_LOG_FILE`**: Optional file path for logging
  - Logs are written to the specified file in addition to stderr
  - Parent directories are created automatically
  - Example: `/tmp/xcodemcp.log` or `~/Library/Logs/xcodemcp.log`

- **`XCODEMCP_CONSOLE_LOGGING`**: Enable/disable console output (default: `true`)
  - Set to `false` to disable stderr logging (useful when using file logging only)

#### Examples

**Debug logging with file output:**
```json
{
  "mcpServers": {
    "xcodemcp": {
      "command": "npx",
      "args": ["-y", "xcodemcp@latest"],
      "env": {
        "LOG_LEVEL": "DEBUG",
        "XCODEMCP_LOG_FILE": "~/Library/Logs/xcodemcp.log"
      }
    }
  }
}
```

**Silent mode (no logging):**
```json
{
  "mcpServers": {
    "xcodemcp": {
      "command": "npx", 
      "args": ["-y", "xcodemcp@latest"],
      "env": {
        "LOG_LEVEL": "SILENT"
      }
    }
  }
}
```

**File-only logging:**
```json
{
  "mcpServers": {
    "xcodemcp": {
      "command": "npx",
      "args": ["-y", "xcodemcp@latest"], 
      "env": {
        "LOG_LEVEL": "INFO",
        "XCODEMCP_LOG_FILE": "/tmp/xcodemcp.log",
        "XCODEMCP_CONSOLE_LOGGING": "false"
      }
    }
  }
}
```

All logs are properly formatted with timestamps and log levels, and stderr output maintains compatibility with the MCP protocol.

## Troubleshooting

### XCLogParser Not Found

If you see a warning that XCLogParser is not found even though it's installed:

1. **Verify installation:**
   ```bash
   which xclogparser
   xclogparser version
   ```

2. **Common issues and solutions:**
   - **PATH issue**: If `which xclogparser` returns nothing, add the installation directory to your PATH:
     ```bash
     # For Homebrew on Intel Macs
     export PATH="/usr/local/bin:$PATH"
     
     # For Homebrew on Apple Silicon Macs
     export PATH="/opt/homebrew/bin:$PATH"
     ```
   
   - **Wrong command**: Older documentation may reference `xclogparser --version`, but the correct command is `xclogparser version` (without dashes)
   
   - **Permission issue**: Ensure xclogparser is executable:
     ```bash
     chmod +x $(which xclogparser)
     ```

3. **Environment validation**: Run the health check to get detailed diagnostics:
   ```bash
   echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "xcode_health_check", "arguments": {}}}' | npx xcodemcp
   ```

**Note**: XcodeMCP can operate without XCLogParser, but build error parsing will be limited.

## Example Output

**Build with errors:**
```
❌ BUILD FAILED (2 errors)

ERRORS:
  • /path/HandsDownApp.swift:7:18: Expected 'func' keyword in instance method declaration
  • /path/MenuBarManager.swift:98:13: Invalid redeclaration of 'toggleItem'
```

**Health check:**
```
✅ All systems operational

✅ OS: macOS environment detected
✅ XCODE: Xcode found at /Applications/Xcode.app (version 16.4)
✅ XCLOGPARSER: XCLogParser found (XCLogParser 0.2.41)
✅ OSASCRIPT: JavaScript for Automation (JXA) is available
✅ PERMISSIONS: Xcode automation permissions are working
```