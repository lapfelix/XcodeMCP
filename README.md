# XcodeMCP

[![npm version](https://img.shields.io/npm/v/xcodemcp.svg)](https://www.npmjs.com/package/xcodemcp)
[![Test Status](https://github.com/lapfelix/XcodeMCP/actions/workflows/test.yml/badge.svg)](https://github.com/lapfelix/XcodeMCP/actions/workflows/test.yml)

Model Context Protocol (MCP) server that controls Xcode directly through JavaScript for Automation (JXA). Available as both an MCP server and a standalone CLI.

## What it does

- Controls Xcode directly through JavaScript for Automation (not xcodebuild CLI)
- Opens projects, builds, runs, tests, and debugs from within Xcode
- Parses build logs with precise error locations using [XCLogParser](https://github.com/MobileNativeFoundation/XCLogParser)
- Provides comprehensive environment validation and health checks
- Adds simulator tooling: list/boot/shutdown, capture live logs, grab screenshots, and drive UI automation with [AXe](https://github.com/cameroncooke/axe) without touching the `xcodebuild` CLI
- Supports graceful degradation when optional dependencies are missing
- **NEW**: Includes a full-featured CLI with 100% MCP server feature parity
- **NEW**: Coordinates multi-worker build queues with exclusive locks and explicit release commands

## Requirements

- macOS with Xcode installed
- Node.js 18+
- XCLogParser (recommended): `brew install xclogparser`

## Usage

XcodeMCP can be used in two ways:
1. **MCP Server**: Integrate with Claude Desktop, VS Code, or other MCP clients
2. **CLI Tool**: Run commands directly from the terminal with `xcodecontrol`

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
  }
}'
```

#### Without the clean build folder tool

To add XcodeMCP to Claude Code using the command line:
```bash
claude mcp add-json XcodeMCP '{
  "command": "npx",
  "args": ["-y", "xcodemcp@latest", "--no-clean"],
  "env": {
  }
}'
```

#### Using Preferred Values for Single Project Workflows

For projects where you're working with a single xcodeproj and scheme, you can configure preferred values to make tool parameters optional:

```bash
claude mcp add-json XcodeMCP '{
  "command": "npx",
  "args": ["-y", "xcodemcp@latest"],
  "env": {
    "XCODE_MCP_PREFERRED_SCHEME": "MyApp",
    "XCODE_MCP_PREFERRED_XCODEPROJ": "MyApp.xcodeproj"
  }
}'
```

With preferred values configured:
- Tool parameters become optional instead of required
- Tool descriptions show default values (e.g., "defaults to MyApp.xcodeproj")
- You can still override defaults by providing explicit parameters
- Reduces repetition when working with a single project

#### Troubleshooting

If `/mcp` in Claude Code indicates the MCP failed, try running it from the project folder manually to see what the output is: `npx -y xcodemcp@latest`

### Development Setup

For local development:
```bash
git clone https://github.com/lapfelix/XcodeMCP.git
cd XcodeMCP
npm install

# Run in development mode (TypeScript)
npm run dev:ts

# Or build and run compiled version
npm run build
npm start
```

## CLI Usage

XcodeMCP includes a powerful CLI that provides 100% feature parity with the MCP server, allowing you to run any tool as a one-shot command:

### Installation

Install globally to use the CLI:
```bash
npm install -g xcodemcp
```

### Basic Usage

```bash
# Show help and available tools
xcodecontrol --help

# Run a tool with flags  
xcodecontrol build \
  --xcodeproj /path/to/Project.xcodeproj \
  --scheme MyScheme \
  --reason "Working on onboarding flow"
# Run tests and wait for completion (default)
xcodecontrol test --xcodeproj /path/to/Project.xcodeproj --scheme MyScheme --device-type iphone --os-version 18.0

# Get help for a specific tool
xcodecontrol build --help

# Use JSON input instead of flags
xcodecontrol build --json-input '{"xcodeproj": "/path/to/Project.xcodeproj", "scheme": "MyScheme"}'

# Output results in JSON format
xcodecontrol --json health-check
```

### Simulator & UI Automation Tools

XcodeMCP now includes simulator management and UI automation commands that do **not** rely on `xcodebuild`. Everything runs through the existing JXA powered `xcode_build_and_run` workflow, so you can boot, launch, and interact with the simulator from the same toolchain.

> **Note:** UI automation commands use [AXe](https://github.com/cameroncooke/axe). Install it with `brew install cameroncooke/axe/axe` or set the `XCODEMCP_AXE_PATH` environment variable to an existing binary.

```bash
# List and boot simulators
xcodecontrol list-sims
xcodecontrol boot-sim --simulator-uuid "<UUID>"
xcodecontrol open-sim

# Capture a screenshot from the currently booted simulator
xcodecontrol screenshot --save-path /tmp/screenshot.png

# Drive the UI with AXe (describe → tap → type)
xcodecontrol describe-ui --simulator-uuid "<UUID>"
xcodecontrol tap --simulator-uuid "<UUID>" --x 180 --y 420
xcodecontrol type-text --simulator-uuid "<UUID>" --text "Hello world!"
```

These tools are also available through any MCP client. Refer to `xcode_list_sims`, `xcode_boot_sim`, `xcode_describe_ui`, `xcode_tap`, `xcode_type_text`, `xcode_swipe`, and `xcode_screenshot` in your client's tool list.

### Exclusive Build Locks

Build- and run-style commands now coordinate through a shared lock directory (default: `~/Library/Application Support/XcodeMCP/locks`). Every time you run `xcodecontrol build` or `xcodecontrol build-and-run`, you **must** supply a short `--reason` that summarizes the part of the app you're touching. The command will wait (via file system events, no busy polling) until it's your turn, then print a footer reminding you to release the lock when you're finished inspecting logs or simulator state.

```bash
# Acquire the lock and build
xcodecontrol build \
  --xcodeproj /path/to/App.xcodeproj \
  --scheme Debug \
  --reason "Tweaking settings tab navigation"

# Once you've finished reviewing the results, release your slot
xcodecontrol release-lock --xcodeproj /path/to/App.xcodeproj

# Emergency: clear every outstanding lock (CLI-only safety valve)
xcodecontrol release-all-locks
```

The same release command is exposed to MCP clients as `xcode_release_lock`. Locks are represented as YAML files per project/workspace so multiple workers (or multiple MCP servers) can coordinate safely across processes and sandboxes.

### Inspect Build & Run Logs

Each `xcode_build` / `build-and-run` command now reports a **Log ID** and filesystem path for the associated `.xcactivitylog`. Use the new viewer to inspect it (optionally while the build is still running):

```bash
# Show the exact log returned by your last build command
xcodecontrol view-build-log --log-id "<LOG_ID_FROM_BUILD>"

# Or grab the latest log for a project/workspace and filter for errors
xcodecontrol view-build-log \
  --xcodeproj /Users/me/ManabiReader/ManabiReader.xcodeproj \
  --filter "error" \
  --max-lines 200

# Match multiple patterns with glob syntax (case-insensitive by default)
xcodecontrol view-build-log \
  --log-id "<LOG_ID>" \
  --filter-globs "*error*,*warning*,type-check failed"

# Resume where you left off using the cursor returned from the previous command
xcodecontrol view-build-log --log-id "<LOG_ID>" --cursor "<CURSOR>" --filter "warning"

# Use regex / case-sensitive filters if needed
xcodecontrol view-build-log --log-id "<LOG_ID>" --filter "The compiler.*type-check" --filter-regex --case-sensitive

# Inspect the runtime console log (same filters & cursor support)
xcodecontrol build-and-run --xcodeproj ... --scheme ...
# ...after it finishes:
xcodecontrol view-run-log --log-id "<LOG_ID_FROM_RUN_SECTION>" --filter-globs "*# DETENTS*"
```

These are exposed as the `xcode_view_build_log` and `xcode_view_run_log` MCP tools (`filter_globs` accepts an array of glob expressions).

### Path Resolution

The CLI supports both absolute and relative paths for convenience:

```bash
# Absolute paths (traditional)
xcodecontrol build --xcodeproj /Users/dev/MyApp/MyApp.xcodeproj --scheme MyApp

# Relative paths (NEW in v2.0.0)
xcodecontrol build --xcodeproj MyApp.xcodeproj --scheme MyApp
xcodecontrol build --xcodeproj ../OtherProject/OtherProject.xcodeproj --scheme OtherApp

# Works with file paths too
xcodecontrol open-file --filePath src/ViewController.swift --lineNumber 42
```

Relative paths are resolved from your current working directory, making the CLI much more convenient to use when working within project directories.

### Verbosity Control

Control logging output with verbosity flags:

```bash
# Verbose mode (shows INFO and DEBUG logs)
xcodecontrol -v build --xcodeproj /path/to/Project.xcodeproj --scheme MyScheme

# Quiet mode (only errors)
xcodecontrol -q test --xcodeproj /path/to/Project.xcodeproj

# Default mode (warnings and errors only)
xcodecontrol run --xcodeproj /path/to/Project.xcodeproj --scheme MyScheme
```

### Quick Examples

```bash
# Check system health
xcodecontrol health-check

# Build a project
xcodecontrol build --xcodeproj /Users/dev/MyApp/MyApp.xcodeproj --scheme MyApp

# Run the app
xcodecontrol run --xcodeproj /Users/dev/MyApp/MyApp.xcodeproj --scheme MyApp

# Run tests
xcodecontrol test --xcodeproj /Users/dev/MyApp/MyApp.xcodeproj

# Clean build directory
xcodecontrol clean --xcodeproj /Users/dev/MyApp/MyApp.xcodeproj

# Browse XCResult files
xcodecontrol xcresult-browse --xcresult-path /path/to/result.xcresult

# Get UI hierarchy from test failure
xcodecontrol xcresult-get-ui-hierarchy --xcresult-path /path/to/result.xcresult --test-id "MyTest/testMethod()" --timestamp 30.5
```

### Tool Name Mapping

CLI commands use kebab-case instead of underscores:
- `xcode_build` → `build`
- `xcode_test` → `test`  
- `xcode_build_and_run` → `build-and-run`
- `xcode_health_check` → `health-check`
- `xcresult_browse` → `xcresult-browse`
- `xcode_find_xcresults` → `find-xcresults`

## Available Tools

**Project Management:**
- `xcode_get_workspace_info` - Get workspace status and details
- `xcode_get_projects` - List projects in workspace
- `xcode_open_file` - Open files with optional line number

**Build Operations:**
- `xcode_build` - Build with detailed error parsing
- `xcode_clean` - Clean build artifacts
- `xcode_test` - Run tests with optional arguments
- `xcode_build_and_run` - Build and run the active scheme
- `xcode_stop` - Stop current operation

**Configuration:**
- `xcode_get_schemes` - List available schemes
- `xcode_set_active_scheme` - Switch active scheme
- `xcode_get_run_destinations` - List simulators and devices

**XCResult Analysis:**
- `xcresult_browse` - Browse test results and analyze failures
- `xcresult_browser_get_console` - Get console output for specific tests
- `xcresult_summary` - Quick overview of test results
- `xcresult_get_screenshot` - Extract screenshots from test failures
- `xcresult_get_ui_hierarchy` - Get UI hierarchy as AI-readable JSON with timestamp selection
- `xcresult_get_ui_element` - Get detailed properties of specific UI elements by index
- `xcresult_list_attachments` - List all attachments for a test
- `xcresult_export_attachment` - Export specific attachments from test results

**Diagnostics:**
- `xcode_health_check` - Environment validation and troubleshooting

## XCResult Analysis Features

XcodeMCP provides comprehensive tools for analyzing Xcode test results (.xcresult files), making it easy to debug test failures and extract valuable information:

### Test Result Analysis
- **Browse Results**: Navigate through test hierarchies, view pass/fail status, and examine detailed test information
- **Console Logs**: Extract console output and test activities with precise timestamps for debugging
- **Quick Summaries**: Get overview statistics including pass rates, failure counts, and duration

### Visual Debugging
- **Screenshot Extraction**: Extract PNG screenshots from test failures using ffmpeg frame extraction from video attachments
- **Timestamp Precision**: Specify exact timestamps to capture UI state at specific moments during test execution

### UI Hierarchy Analysis
- **AI-Readable Format**: Extract UI hierarchies as compressed JSON with single-letter properties (`t`=type, `l`=label, `f`=frame, `c`=children, `j`=index)
- **Timestamp Selection**: Automatically find the closest UI hierarchy capture to any specified timestamp
- **Element Deep-Dive**: Use index references to get full details of any UI element, including accessibility properties and frame information
- **Size Optimization**: 75%+ size reduction compared to full hierarchy data while maintaining all essential information

### Attachment Management
- **Complete Inventory**: List all attachments (screenshots, videos, debug descriptions, UI hierarchies) for any test
- **Selective Export**: Export specific attachments by index or type
- **Smart Detection**: Automatically identify and categorize different attachment types

### Usage Examples

```bash
# Browse test results
xcresult_browse "/path/to/TestResults.xcresult"

# Get console output to find failure timestamps
xcresult_browser_get_console "/path/to/TestResults.xcresult" "MyTest/testMethod()"

# Get UI hierarchy at specific timestamp (AI-readable slim version)
xcresult_get_ui_hierarchy "/path/to/TestResults.xcresult" "MyTest/testMethod()" 45.25

# Get full UI hierarchy (with size warning)
xcresult_get_ui_hierarchy "/path/to/TestResults.xcresult" "MyTest/testMethod()" 45.25 true

# Get detailed properties of a specific UI element
xcresult_get_ui_element "/path/to/ui_hierarchy_full.json" 15

# Extract screenshot at failure point
xcresult_get_screenshot "/path/to/TestResults.xcresult" "MyTest/testMethod()" 30.71
```

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
