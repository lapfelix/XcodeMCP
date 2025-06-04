# XcodeMCP

MCP server for Xcode build automation and log parsing.

## What it does

- Opens Xcode projects and triggers builds
- Parses build logs to extract errors and warnings using [XCLogParser](https://github.com/MobileNativeFoundation/XCLogParser)
- Provides MCP tools for AI assistants to interact with Xcode

## Requirements

- macOS with Xcode installed
- Node.js 18+
- XCLogParser: `brew install xclogparser`

## Usage

### Quick Install

For a quick install, you can use the following links:

- [<img src="https://img.shields.io/badge/VS_Code-VS_Code?style=flat-square&label=Install%20Server&color=0098FF" alt="Install in VS Code">](https://insiders.vscode.dev/redirect/mcp/install?name=xcodemcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22github%3Alapfelix%2FXcodeMCP%22%5D%7D)
- [<img alt="Install in VS Code Insiders" src="https://img.shields.io/badge/VS_Code_Insiders-VS_Code_Insiders?style=flat-square&label=Install%20Server&color=24bfa5">](https://insiders.vscode.dev/redirect/mcp/install?name=xcodemcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22github%3Alapfelix%2FXcodeMCP%22%5D%7D&quality=insiders)

### Manual Setup

Run directly from GitHub:
```bash
brew install xclogparser
npx github:lapfelix/XcodeMCP
```

Or add to your MCP configuration:
```json
{
  "mcpServers": {
    "xcodemcp": {
      "command": "npx",
      "args": ["github:lapfelix/XcodeMCP"],
      "env": {}
    }
  }
}
```

Or clone locally:
```bash
git clone https://github.com/lapfelix/XcodeMCP.git
cd XcodeMCP
npm install
node index.js
```

## Available Tools

- `xcode_open_project` - Open Xcode projects
- `xcode_build` - Build and get errors/warnings  
- `xcode_clean` - Clean build
- `xcode_test` - Run tests
- `xcode_run` - Run app
- Other standard Xcode operations

## Example

```bash
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "xcode_build", "arguments": {}}}' | node index.js
```

Output:
```
❌ BUILD FAILED (1 errors)
ERRORS:
  • /path/file.swift: 'SomeType' file not found
```