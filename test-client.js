#!/usr/bin/env node

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const server = spawn('node', ['dist/index.js'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'MCP> '
});

// Handle server output
server.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(line => line.trim());
  lines.forEach(line => {
    try {
      const parsed = JSON.parse(line);
      console.log('Server response:', JSON.stringify(parsed, null, 2));
    } catch {
      console.log('Server log:', line);
    }
  });
  rl.prompt();
});

// Initialize connection
const initMessage = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" }
  }
});

server.stdin.write(initMessage + '\n');

console.log('MCP Test Client - Type commands or "help" for examples');
rl.prompt();

rl.on('line', (input) => {
  const cmd = input.trim();
  
  if (cmd === 'help') {
    console.log('Examples:');
    console.log('  list - List all tools');
    console.log('  health - Check Xcode health');
    console.log('  quit - Exit');
  } else if (cmd === 'list') {
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/list"
    });
    server.stdin.write(msg + '\n');
  } else if (cmd === 'health') {
    const msg = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "xcode_health",
        arguments: {}
      }
    });
    server.stdin.write(msg + '\n');
  } else if (cmd === 'quit') {
    server.kill();
    process.exit(0);
  } else if (cmd.startsWith('{')) {
    // Raw JSON input
    server.stdin.write(cmd + '\n');
  } else {
    console.log('Unknown command. Type "help" for examples.');
  }
  
  rl.prompt();
});

rl.on('close', () => {
  server.kill();
  process.exit(0);
});