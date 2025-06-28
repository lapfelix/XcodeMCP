#!/bin/bash

# Test script for MCP tools that shows output in real-time

if [ $# -lt 2 ]; then
    echo "Usage: $0 <tool_name> <json_args>"
    echo "Example: $0 xcresult_get_ui_hierarchy '{\"xcresult_path\": \"/path/to/file.xcresult\", \"test_id\": \"TestSuite/testMethod()\"}'"
    exit 1
fi

TOOL_NAME="$1"
ARGS="$2"

# Create the JSON RPC request
REQUEST="{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/call\", \"params\": {\"name\": \"$TOOL_NAME\", \"arguments\": $ARGS}}"

echo "🔧 Testing tool: $TOOL_NAME"
echo "📨 Request: $REQUEST"
echo "=" | tr '=' '-' | sed 's/./=/g' | head -c 50; echo
echo "⏳ Running (press Ctrl+C to stop)..."
echo

# Run the tool with live output - stderr goes to stderr, stdout gets processed
echo "$REQUEST" | node dist/index.js | (
    read -r response
    echo "📄 Response:"
    echo "$response" | jq . 2>/dev/null || echo "$response"
)