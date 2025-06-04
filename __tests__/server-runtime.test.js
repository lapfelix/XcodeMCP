import { spawn } from 'child_process';
import { jest } from '@jest/globals';

describe('Server Runtime Tests', () => {
  test('should start server without crashing', (done) => {
    const serverProcess = spawn('node', ['index.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let hasStarted = false;
    
    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Xcode MCP server running on stdio')) {
        hasStarted = true;
        serverProcess.kill('SIGTERM');
      }
    });

    serverProcess.on('close', (code) => {
      if (hasStarted) {
        expect(code).toBe(null); // Process was killed, not crashed
        done();
      } else {
        done(new Error(`Server failed to start, exit code: ${code}`));
      }
    });

    serverProcess.on('error', (error) => {
      done(error);
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!hasStarted) {
        serverProcess.kill('SIGKILL');
        done(new Error('Server startup timeout'));
      }
    }, 5000);
  }, 10000);

  test('should validate server can handle MCP list tools request', (done) => {
    const serverProcess = spawn('node', ['index.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverReady = false;

    serverProcess.stderr.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Xcode MCP server running on stdio')) {
        serverReady = true;
        
        // Send a valid MCP request
        const listToolsRequest = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        };
        
        serverProcess.stdin.write(JSON.stringify(listToolsRequest) + '\n');
      }
    });

    let responseReceived = false;
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      try {
        const response = JSON.parse(output);
        if (response.id === 1 && response.result && response.result.tools) {
          responseReceived = true;
          expect(response.result.tools.length).toBeGreaterThan(0);
          serverProcess.kill('SIGTERM');
          done();
        }
      } catch (e) {
        // Ignore JSON parse errors, might be partial data
      }
    });

    serverProcess.on('close', () => {
      if (!responseReceived && serverReady) {
        done(new Error('No valid response received'));
      }
    });

    serverProcess.on('error', (error) => {
      done(error);
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      serverProcess.kill('SIGKILL');
      if (!responseReceived) {
        done(new Error('Test timeout'));
      }
    }, 10000);
  }, 15000);
});