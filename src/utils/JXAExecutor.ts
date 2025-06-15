import { spawn, ChildProcess } from 'child_process';

export class JXAExecutor {
  /**
   * Execute a JavaScript for Automation (JXA) script
   * @param script - The JXA script to execute
   * @returns Promise that resolves with the script output or rejects with an error
   */
  public static async execute(script: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const osascript: ChildProcess = spawn('osascript', ['-l', 'JavaScript', '-e', script]);
      let stdout = '';
      let stderr = '';

      osascript.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      osascript.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      osascript.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(new Error(`JXA execution failed: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      osascript.on('error', (error: Error) => {
        reject(new Error(`Failed to spawn osascript: ${error.message}`));
      });
    });
  }
}