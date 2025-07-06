#!/usr/bin/env node

import { spawn } from 'child_process';

function testXcodeTest() {
  console.log('🧪 Testing xcode_test via stdio...');
  
  const serverProcess = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let responseData = '';
  let hasReceivedResponse = false;

  serverProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        console.log('📨 Received:', JSON.stringify(msg, null, 2));
        
        if (msg.id === 2) { // Our xcode_test call
          hasReceivedResponse = true;
          if (msg.error) {
            console.log('❌ Received error response:', msg.error);
          } else if (msg.result && msg.result.content) {
            console.log('✅ Received result:', msg.result.content[0].text);
          }
        }
      } catch (e) {
        // Ignore non-JSON lines (log output)
        if (!line.includes('[INFO]') && !line.includes('[ERROR]') && !line.includes('[WARN]')) {
          console.log('📄 Non-JSON response:', line);
        }
      }
    }
  });

  serverProcess.stderr.on('data', (data) => {
    console.log('⚠️ stderr:', data.toString());
  });

  // Send initialization
  console.log('🔄 Sending initialize...');
  serverProcess.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" }
    }
  }) + '\n');

  // Wait a moment then send the test call
  setTimeout(() => {
    console.log('🚀 Sending xcode_test...');
    serverProcess.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "xcode_test",
        arguments: {
          xcodeproj: "/Users/felix/Gits/Transit-iOS/Transit.xcodeproj"
        }
      }
    }) + '\n');
  }, 1000);

  // Set timeout to kill if no response
  const timeout = setTimeout(() => {
    if (!hasReceivedResponse) {
      console.log('⏰ TIMEOUT: No response received after 120 seconds');
      serverProcess.kill();
      process.exit(1);
    }
  }, 120000);

  serverProcess.on('exit', (code) => {
    clearTimeout(timeout);
    console.log(`🏁 Server process exited with code: ${code}`);
    if (hasReceivedResponse) {
      console.log('✅ Test completed successfully');
      process.exit(0);
    } else {
      console.log('❌ Test failed - no response received');
      process.exit(1);
    }
  });
}

testXcodeTest();