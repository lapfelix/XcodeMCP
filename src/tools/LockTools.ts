import path from 'path';
import type { McpResult } from '../types/index.js';
import LockManager from '../utils/LockManager.js';
import ErrorHelper from '../utils/ErrorHelper.js';

export class LockTools {
  private static validateTarget(projectPath: string): McpResult | null {
    if (!projectPath || typeof projectPath !== 'string') {
      return {
        content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance('Missing required parameter: xcodeproj', '• Supply the absolute path to the project/workspace whose lock you want to release.\n• Example: /Users/name/MyApp/MyApp.xcodeproj') }],
      };
    }
    if (!path.isAbsolute(projectPath)) {
      return {
        content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance(`Project path must be absolute, got: ${projectPath}`, '• Provide a path starting with /\n• Example: /Users/name/MyApp/MyApp.xcodeproj') }],
      };
    }
    if (!projectPath.endsWith('.xcodeproj') && !projectPath.endsWith('.xcworkspace')) {
      return {
        content: [{ type: 'text', text: ErrorHelper.createErrorWithGuidance('Lock release path must end in .xcodeproj or .xcworkspace', '• Example: /Users/name/MyApp/MyApp.xcodeproj\n• Example: /Users/name/MyApp/MyApp.xcworkspace') }],
      };
    }
    return null;
  }

  public static async release(projectPath: string): Promise<McpResult> {
    const validationError = this.validateTarget(projectPath);
    if (validationError) {
      return validationError;
    }

    const { released, info } = await LockManager.releaseLock(projectPath);
    if (!released) {
      return {
        content: [{ type: 'text', text: `No active lock found for ${projectPath}. It may have already been released.` }],
      };
    }

    const previousReason = info?.reason ? ` Previous reason: "${info.reason}".` : '';
    const lockId = info?.lockId ? ` (Lock ID: ${info.lockId})` : '';
    const waitingCount = info ? Math.max(0, info.queueDepth - 1) : 0;
    const waitingText = waitingCount > 0 ? ` ${waitingCount} worker${waitingCount === 1 ? '' : 's'} can proceed now.` : ' No other workers were waiting.';
    return {
      content: [
        {
          type: 'text',
          text: `Released lock for ${projectPath}${lockId}.${previousReason}${waitingText}`,
        },
      ],
    };
  }
}

export default LockTools;
