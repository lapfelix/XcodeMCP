#!/bin/bash

# Test script for MCP tools that shows both logs and JSON response

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

# Run the tool and capture both stdout and stderr
TEMP_OUT=$(mktemp)
TEMP_ERR=$(mktemp)

echo "$REQUEST" | node dist/index.js > "$TEMP_OUT" 2> "$TEMP_ERR"

echo "📋 Logs:"
cat "$TEMP_ERR"
echo
echo "📄 Response:"
head -1 "$TEMP_OUT" | jq . 2>/dev/null || head -1 "$TEMP_OUT"

# Cleanup
rm "$TEMP_OUT" "$TEMP_ERR"