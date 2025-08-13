import { spawn } from 'child_process';
export class JXAExecutor {
    /**
     * Execute a JavaScript for Automation (JXA) script
     * @param script - The JXA script to execute
     * @param timeoutMs - Timeout in milliseconds (default: 30 seconds)
     * @returns Promise that resolves with the script output or rejects with an error
     */
    static async execute(script, timeoutMs = 30000) {
        return new Promise((resolve, reject) => {
            try {
                const osascript = spawn('osascript', ['-l', 'JavaScript', '-e', script]);
                let stdout = '';
                let stderr = '';
                // Add cleanup handlers to prevent process leaks
                const cleanup = () => {
                    if (osascript && !osascript.killed) {
                        try {
                            osascript.kill('SIGTERM');
                        }
                        catch (killError) {
                            // Ignore kill errors
                        }
                    }
                };
                // Set a timeout to prevent hanging
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error(`JXA execution timed out after ${timeoutMs / 1000} seconds`));
                }, timeoutMs);
                osascript.stdout?.on('data', (data) => {
                    stdout += data.toString();
                });
                osascript.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });
                osascript.on('close', (code) => {
                    clearTimeout(timeout);
                    try {
                        if (code !== 0) {
                            reject(new Error(`JXA execution failed: ${stderr}`));
                        }
                        else {
                            resolve(stdout.trim());
                        }
                    }
                    catch (handlerError) {
                        // Prevent any handler errors from crashing
                        reject(new Error(`JXA handler error: ${handlerError}`));
                    }
                });
                osascript.on('error', (error) => {
                    clearTimeout(timeout);
                    cleanup();
                    reject(new Error(`Failed to spawn osascript: ${error.message}`));
                });
            }
            catch (spawnError) {
                reject(new Error(`Failed to create JXA process: ${spawnError}`));
            }
        });
    }
}
//# sourceMappingURL=JXAExecutor.js.map