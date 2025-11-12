import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { promises as fsPromises } from 'fs';
import type { McpResult } from '../types/index.js';
import Logger from '../utils/Logger.js';

const execFileAsync = promisify(execFile);

interface SimulatorDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable?: boolean;
  runtime?: string;
}

export class SimulatorTools {
  public static async listSimulators(): Promise<McpResult> {
    try {
      const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '--json']);
      const parsed = JSON.parse(stdout) as { devices?: Record<string, SimulatorDevice[]> };
      const deviceMap = parsed.devices ?? {};

      let response = 'Available iOS Simulators:\n\n';
      const lines: string[] = [];

      for (const [runtime, devices] of Object.entries(deviceMap)) {
        const available = devices.filter((device) => device.isAvailable ?? true);
        if (!available.length) continue;
        lines.push(`${runtime}:`);
        for (const device of available) {
          const status = device.state === 'Booted' ? ' [Booted]' : '';
          lines.push(`- ${device.name} (${device.udid})${status}`);
        }
        lines.push('');
      }

      if (!lines.length) {
        response += 'No available simulators were returned by simctl.';
      } else {
        response += `${lines.join('\n')}\nNext Steps:\n- Boot a simulator: xcode_boot_sim({ simulator_uuid: 'UUID_FROM_ABOVE' })\n- Open the simulator UI: xcode_open_sim({})`;
      }

      return {
        content: [
          {
            type: 'text',
            text: response,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('Failed to list simulators', error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list simulators: ${message}`,
          },
        ],
        isError: true,
      };
    }

  }
  public static async bootSimulator(simulatorUuid: string): Promise<McpResult> {
    try {
      await execFileAsync('xcrun', ['simctl', 'boot', simulatorUuid]);
      return {
        content: [
          {
            type: 'text',
            text: `✅ Simulator ${simulatorUuid} booted successfully.\n\nNext Steps:\n- Make sure the Simulator UI is visible: xcode_open_sim({})\n- Launch your app with xcode_build_and_run or install it manually.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error(`Failed to boot simulator ${simulatorUuid}`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to boot simulator ${simulatorUuid}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  public static async openSimulator(): Promise<McpResult> {
    try {
      await execFileAsync('open', ['-a', 'Simulator']);
      return {
        content: [
          {
            type: 'text',
            text: 'Simulator app opened successfully.',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error('Failed to open Simulator app', error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to open Simulator app: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }

  public static async captureScreenshot(
    simulatorUuid?: string,
    savePath?: string,
  ): Promise<McpResult> {
    const target = simulatorUuid ?? 'booted';
    const args = ['simctl', 'io', target, 'screenshot', '--type=png', '-'];

    return new Promise((resolve) => {
      const child = spawn('xcrun', args);
      const chunks: Buffer[] = [];
      const errorChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));

      child.on('close', async (code) => {
        if (code !== 0 || chunks.length === 0) {
          const errorMessage =
            errorChunks.length > 0
              ? Buffer.concat(errorChunks).toString('utf8')
              : `simctl exited with code ${code}`;
          Logger.error(`Screenshot capture failed for ${target}: ${errorMessage}`);
          resolve({
            content: [
              {
                type: 'text',
                text: `Failed to capture screenshot: ${errorMessage.trim()}`,
              },
            ],
            isError: true,
          });
          return;
        }

        const pngBuffer = Buffer.concat(chunks);
        let savedTo: string | undefined;

        if (savePath) {
          try {
            await fsPromises.writeFile(savePath, pngBuffer);
            savedTo = savePath;
          } catch (writeError) {
            const message = writeError instanceof Error ? writeError.message : String(writeError);
            Logger.warn(`Failed to write screenshot to ${savePath}: ${message}`);
          }
        }

        resolve({
          content: [
            {
              type: 'image',
              data: pngBuffer.toString('base64'),
              mimeType: 'image/png',
            },
            ...(savedTo
              ? [
                  {
                    type: 'text' as const,
                    text: `Screenshot saved to ${savedTo}`,
                  },
                ]
              : []),
          ],
        });
      });
    });
  }

  public static async shutdownSimulator(simulatorUuid: string): Promise<McpResult> {
    try {
      await execFileAsync('xcrun', ['simctl', 'shutdown', simulatorUuid]);
      return {
        content: [
          {
            type: 'text',
            text: `Simulator ${simulatorUuid} has been shut down.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Logger.error(`Failed to shutdown simulator ${simulatorUuid}`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Failed to shutdown simulator ${simulatorUuid}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
}

export default SimulatorTools;
