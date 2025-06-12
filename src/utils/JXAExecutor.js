import { spawn } from 'child_process';

export class JXAExecutor {
  static async execute(script) {
    return new Promise((resolve, reject) => {
      const osascript = spawn('osascript', ['-l', 'JavaScript', '-e', script]);
      let stdout = '';
      let stderr = '';

      osascript.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      osascript.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      osascript.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`JXA execution failed: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }
}