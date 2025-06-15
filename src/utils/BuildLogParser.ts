import { spawn, ChildProcess } from 'child_process';
import { readdir, stat, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { Logger } from './Logger.js';
import type { BuildLogInfo, ParsedBuildResults } from '../types/index.js';

interface XCLogParserIssue {
  documentURL?: string;
  startingLineNumber?: number;
  startingColumnNumber?: number;
  title: string;
}

interface XCLogParserResult {
  errors?: XCLogParserIssue[];
  warnings?: XCLogParserIssue[];
}

export class BuildLogParser {
  public static async findProjectDerivedData(projectPath: string): Promise<string | null> {
    const customDerivedDataLocation = await this.getCustomDerivedDataLocationFromXcodePreferences();
    const projectName = path.basename(projectPath, path.extname(projectPath));
    let derivedDataPath: string;
    
    if (!customDerivedDataLocation) {
      derivedDataPath = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
    } else if (customDerivedDataLocation.startsWith('/')) {
      derivedDataPath = customDerivedDataLocation;
    } else {
      const localProjectPath = path.dirname(projectPath);
      derivedDataPath = path.join(localProjectPath, customDerivedDataLocation);
    }

    try {
      const dirs = await readdir(derivedDataPath);
      const matches = dirs.filter(dir => dir.startsWith(`${projectName}-`));
      
      if (matches.length === 0) return null;
      
      // Find the correct DerivedData folder by verifying WorkspacePath in info.plist
      for (const match of matches) {
        const fullPath = path.join(derivedDataPath, match);
        const infoPlistPath = path.join(fullPath, 'info.plist');
        
        try {
          const plistContent = await readFile(infoPlistPath, 'utf8');
          const workspacePathMatch = plistContent.match(/<key>WorkspacePath<\/key>\s*<string>(.*?)<\/string>/);
          
          if (workspacePathMatch && workspacePathMatch[1]) {
            const workspacePath = workspacePathMatch[1];
            // Resolve both paths to absolute paths for comparison
            const resolvedProjectPath = path.resolve(projectPath);
            const resolvedWorkspacePath = path.resolve(workspacePath);
            
            if (resolvedProjectPath === resolvedWorkspacePath) {
              return fullPath;
            }
          }
        } catch (plistError) {
          // Continue to next match if info.plist can't be read
          continue;
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  public static async getCustomDerivedDataLocationFromXcodePreferences(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const defaults: ChildProcess = spawn('defaults', ['read', 'com.apple.dt.Xcode', 'IDECustomDerivedDataLocation']);
      let stdout = '';
      let stderr = '';

      defaults.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      defaults.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      defaults.on('close', (code: number | null) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve(null);
        }
      });

      defaults.on('error', () => {
        resolve(null);
      });
    });
  }

  public static async getLatestBuildLog(projectPath: string): Promise<BuildLogInfo | null> {
    const derivedData = await this.findProjectDerivedData(projectPath);
    if (!derivedData) return null;
    
    const logsDir = path.join(derivedData, 'Logs', 'Build');
    
    try {
      const files = await readdir(logsDir);
      const logFiles = files.filter(file => file.endsWith('.xcactivitylog'));
      
      if (logFiles.length === 0) return null;
      
      let latestLog: BuildLogInfo | null = null;
      let latestTime = 0;
      
      for (const logFile of logFiles) {
        const fullPath = path.join(logsDir, logFile);
        const stats = await stat(fullPath);
        if (stats.mtime.getTime() > latestTime) {
          latestTime = stats.mtime.getTime();
          latestLog = { path: fullPath, mtime: stats.mtime };
        }
      }
      
      return latestLog;
    } catch (error) {
      return null;
    }
  }

  public static async parseBuildLog(logPath: string, retryCount = 0, maxRetries = 6): Promise<ParsedBuildResults> {
    const delays = [1000, 2000, 3000, 5000, 8000, 13000];
    return new Promise<ParsedBuildResults>((resolve) => {
      const command: ChildProcess = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
      let stdout = '';
      let stderr = '';
      
      command.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      command.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      
      command.on('close', (code: number | null) => {
        if (code !== 0) {
          const errorMessage = stderr.trim() || 'No error details available';
          
          if (errorMessage.includes('not a valid SLF log') || 
              errorMessage.includes('not a valid xcactivitylog file') ||
              errorMessage.includes('corrupted') || 
              errorMessage.includes('incomplete') ||
              errorMessage.includes('Error while parsing') ||
              errorMessage.includes('Failed to parse')) {
            
            if (retryCount < maxRetries) {
              Logger.warn(`XCLogParser failed (attempt ${retryCount + 1}/${maxRetries + 1}): ${errorMessage}`);
              Logger.debug(`Retrying in ${delays[retryCount]}ms...`);
              
              setTimeout(async () => {
                const result = await this.parseBuildLog(logPath, retryCount + 1, maxRetries);
                resolve(result);
              }, delays[retryCount]!);
              return;
            }
            
            Logger.error('xclogparser failed:', stderr);
            resolve({
              errors: [
                'XCLogParser failed to parse the build log.',
                '',
                'This may indicate:',
                '• The log file is corrupted or incomplete',
                '• An unsupported Xcode version was used',
                '• XCLogParser needs to be updated',
                '',
                `Error details: ${errorMessage}`
              ],
              warnings: []
            });
            return;
          }
        }
        
        try {
          const result: XCLogParserResult = JSON.parse(stdout);
          
          const errors = (result.errors || []).map(error => {
            const fileName = error.documentURL ? error.documentURL.replace('file://', '') : 'Unknown file';
            const line = error.startingLineNumber;
            const column = error.startingColumnNumber;
            
            let location = fileName;
            if (line && line > 0) {
              location += `:${line}`;
              if (column && column > 0) {
                location += `:${column}`;
              }
            }
            
            return `${location}: ${error.title}`;
          });
          
          const warnings = (result.warnings || []).map(warning => {
            const fileName = warning.documentURL ? warning.documentURL.replace('file://', '') : 'Unknown file';
            const line = warning.startingLineNumber;
            const column = warning.startingColumnNumber;
            
            let location = fileName;
            if (line && line > 0) {
              location += `:${line}`;
              if (column && column > 0) {
                location += `:${column}`;
              }
            }
            
            return `${location}: ${warning.title}`;
          });
          
          resolve({
            errors,
            warnings
          });
        } catch (parseError) {
          const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
          Logger.error('Failed to parse xclogparser output:', parseError);
          resolve({
            errors: [
              'Failed to parse XCLogParser JSON output.',
              '',
              'This may indicate:',
              '• XCLogParser returned unexpected output format',
              '• The build log contains unusual data',
              '• XCLogParser version incompatibility',
              '',
              `Parse error: ${errorMessage}`
            ],
            warnings: []
          });
        }
      });
      
      command.on('error', (err: Error) => {
        Logger.error('Failed to run xclogparser:', err);
        resolve({
          errors: [
            'XCLogParser is required to parse Xcode build logs but is not installed.',
            '',
            'Please install XCLogParser using one of these methods:',
            '• Homebrew: brew install xclogparser',
            '• From source: https://github.com/MobileNativeFoundation/XCLogParser',
            '',
            'XCLogParser is a professional tool for parsing Xcode\'s binary log format.'
          ],
          warnings: []
        });
      });
    });
  }

  public static async canParseLog(logPath: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const command: ChildProcess = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
      let hasOutput = false;
      
      command.stdout?.on('data', () => {
        hasOutput = true;
      });
      
      command.on('close', (code: number | null) => {
        resolve(code === 0 && hasOutput);
      });
      
      command.on('error', () => {
        resolve(false);
      });
      
      const timeoutId = setTimeout(() => {
        command.kill();
        resolve(false);
      }, 5000);

      command.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }
}