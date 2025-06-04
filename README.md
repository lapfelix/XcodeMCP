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

Run directly from GitHub:
```bash
brew install xclogparser
npx github:lapfelix/XcodeMCP
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