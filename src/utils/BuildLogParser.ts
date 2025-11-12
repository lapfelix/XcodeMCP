import { spawn, ChildProcess } from 'child_process';
import { readdir, stat, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import Logger from './Logger.js';
import type { BuildLogInfo, ParsedBuildResults } from '../types/index.js';

interface XCLogParserIssue {
  documentURL?: string;
  startingLineNumber?: number;
  startingColumnNumber?: number;
  title: string;
  detail?: string;
  severity?: number;
  type?: string;
}

interface XCLogParserResult {
  errors?: XCLogParserIssue[];
  warnings?: XCLogParserIssue[];
  buildStatus?: string;
}

interface XCLogParserSummaryResult {
  buildStatus?: string;
  warningCount?: number;
  errorCount?: number;
  warnings?: XCLogParserIssue[];
  errors?: XCLogParserIssue[];
  notes?: XCLogParserIssue[];
}

const FAILURE_STATUS_TOKENS = ['fail', 'error', 'cancel', 'terminate', 'abort'];

function formatIssue(issue: XCLogParserIssue): string {
  const fileName = issue.documentURL ? issue.documentURL.replace('file://', '') : 'Unknown file';
  const line = issue.startingLineNumber;
  const column = issue.startingColumnNumber;
  const detail = typeof issue.detail === 'string' ? issue.detail.replace(/\r/g, '\n').trim() : '';

  let location = fileName;
  if (line && line > 0) {
    location += `:${line}`;
    if (column && column > 0) {
      location += `:${column}`;
    }
  }
  const header = `${location}: ${issue.title}`;
  if (detail) {
    return `${header}\n${detail}`;
  }
  return header;
}

function dedupeIssues(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => typeof value === 'string' && value.trim().length > 0)));
}

function isFailureStatus(status?: string): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  if (normalized === 'stopped' || normalized === 'interrupted') {
    return false;
  }
  return FAILURE_STATUS_TOKENS.some(token => normalized.includes(token));
}

function classifyNote(note: XCLogParserIssue): 'error' | 'warning' | null {
  const severity = note.severity ?? 0;
  const type = typeof note.type === 'string' ? note.type.toLowerCase() : '';
  if (severity >= 2 || type.includes('error')) {
    return 'error';
  }
  if (severity >= 1 || type.includes('warning')) {
    return 'warning';
  }
  return null;
}

export class BuildLogParser {
  public static async findProjectDerivedData(projectPath: string): Promise<string | null> {
    const customDerivedDataLocation = await this.getCustomDerivedDataLocationFromXcodePreferences();
    
    // Extract the actual project name from .xcodeproj or .xcworkspace files
    let projectName: string;
    let actualProjectPath = projectPath;
    
    // If projectPath points to a .xcodeproj file, get its directory
    if (projectPath.endsWith('.xcodeproj') || projectPath.endsWith('.xcworkspace')) {
      actualProjectPath = path.dirname(projectPath);
      projectName = path.basename(projectPath, path.extname(projectPath));
    } else {
      // projectPath is a directory, find project files inside it
      try {
        const files = await readdir(actualProjectPath);
        const projectFile = files.find(file => file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace'));
        if (projectFile) {
          projectName = path.basename(projectFile, path.extname(projectFile));
        } else {
          // Fallback to directory name if no project files found
          projectName = path.basename(actualProjectPath, path.extname(actualProjectPath));
        }
      } catch {
        // Fallback to directory name if we can't read the directory
        projectName = path.basename(actualProjectPath, path.extname(actualProjectPath));
      }
    }
    
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
            const resolvedProjectPath = path.resolve(actualProjectPath);
            const resolvedWorkspacePath = path.resolve(workspacePath);
            
            // Check if paths match exactly, or if workspace path is inside the project directory
            if (resolvedProjectPath === resolvedWorkspacePath || 
                resolvedWorkspacePath.startsWith(resolvedProjectPath + path.sep) ||
                resolvedProjectPath.startsWith(resolvedWorkspacePath + path.sep)) {
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

  public static async getRecentBuildLogs(projectPath: string, sinceTime: number): Promise<BuildLogInfo[]> {
    const derivedData = await this.findProjectDerivedData(projectPath);
    if (!derivedData) return [];
    
    const logsDir = path.join(derivedData, 'Logs', 'Build');
    
    try {
      const files = await readdir(logsDir);
      const logFiles = files.filter(file => file.endsWith('.xcactivitylog'));
      
      if (logFiles.length === 0) return [];
      
      const recentLogs: BuildLogInfo[] = [];
      
      for (const logFile of logFiles) {
        const fullPath = path.join(logsDir, logFile);
        const stats = await stat(fullPath);
        
        // Include logs modified AFTER the test started (strict comparison, no buffer)
        // This ensures we only get logs created by the current operation
        if (stats.mtime.getTime() > sinceTime) {
          recentLogs.push({ path: fullPath, mtime: stats.mtime });
        }
      }
      
      // Sort by modification time (newest first)
      recentLogs.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      // If no recent logs found, fallback to the single most recent log
      // This handles cases where clock differences might cause issues
      if (recentLogs.length === 0) {
        Logger.warn('No recent build logs found, falling back to latest log');
        const latestLog = await this.getLatestBuildLog(projectPath);
        if (latestLog) {
          return [latestLog];
        }
      }
      
      return recentLogs;
    } catch (error) {
      return [];
    }
  }

  public static async getLatestTestLog(projectPath: string): Promise<BuildLogInfo | null> {
    const derivedData = await this.findProjectDerivedData(projectPath);
    if (!derivedData) return null;
    
    const logsDir = path.join(derivedData, 'Logs', 'Test');
    
    try {
      const files = await readdir(logsDir);
      const testResultDirs = files.filter(file => file.endsWith('.xcresult'));
      
      if (testResultDirs.length === 0) return null;
      
      let latestLog: BuildLogInfo | null = null;
      let latestTime = 0;
      
      for (const resultDir of testResultDirs) {
        const fullPath = path.join(logsDir, resultDir);
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

  public static async getLatestRunLog(projectPath: string, sinceTime?: number): Promise<BuildLogInfo | null> {
    const derivedData = await this.findProjectDerivedData(projectPath);
    if (!derivedData) return null;
    const logsDir = path.join(derivedData, 'Logs', 'Run');
    try {
      const files = await readdir(logsDir);
      const logFiles = files.filter(file => file.endsWith('.log'));
      if (logFiles.length === 0) return null;
      let latestLog: BuildLogInfo | null = null;
      let latestTime = 0;
      for (const logFile of logFiles) {
        const fullPath = path.join(logsDir, logFile);
        const stats = await stat(fullPath);
        const logTime = stats.mtime.getTime();
        if (sinceTime && logTime <= sinceTime) {
          continue;
        }
        if (logTime > latestTime) {
          latestTime = logTime;
          latestLog = { path: fullPath, mtime: stats.mtime };
        }
      }
      if (!latestLog && sinceTime) {
        return this.getLatestRunLog(projectPath);
      }
      return latestLog;
    } catch {
      return null;
    }
  }

  public static async parseBuildLog(
    logPath: string,
    retryCount = 0,
    maxRetries = 6,
    options: { timeoutMs?: number } = {},
  ): Promise<ParsedBuildResults> {
    const delays = [1000, 2000, 3000, 5000, 8000, 13000];
    return new Promise<ParsedBuildResults>((resolve) => {
      const command: ChildProcess = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
      let stdout = '';
      let stderr = '';

      const handleProcessExit = () => {
        if (command && !command.killed) {
          command.kill('SIGTERM');
        }
      };
      process.once('exit', handleProcessExit);
      process.once('SIGTERM', handleProcessExit);
      process.once('SIGINT', handleProcessExit);

      const cleanup = () => {
        process.removeListener('exit', handleProcessExit);
        process.removeListener('SIGTERM', handleProcessExit);
        process.removeListener('SIGINT', handleProcessExit);
      };

      let resolved = false;
      const resolveOnce = (result: ParsedBuildResults) => {
        if (resolved) {
          return;
        }
        resolved = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        cleanup();
        resolve(result);
      };

      const timeoutMs = options.timeoutMs ?? 0;
      const timeoutId =
        timeoutMs > 0
          ? setTimeout(() => {
              Logger.warn(
                `XCLogParser issues reporter exceeded ${timeoutMs}ms, aborting parse for ${logPath}`,
              );
              handleProcessExit();
              resolveOnce({
                errors: [
                  `XCLogParser did not finish within ${Math.round(timeoutMs / 1000)}s while parsing ${logPath}.`,
                  'Open the log in Xcode for full details.',
                ],
                warnings: [],
              });
            }, timeoutMs)
          : undefined;
      
      command.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      command.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      
      command.on('close', async (code: number | null) => {
        if (resolved) {
          return;
        }
        cleanup();
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
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
                const result = await this.parseBuildLog(logPath, retryCount + 1, maxRetries, options);
                resolveOnce(result);
              }, delays[retryCount]!);
              return;
            }
            
            Logger.error('xclogparser failed:', stderr);
            resolveOnce({
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
          
          let errors = dedupeIssues((result.errors || []).map(formatIssue));
          let warnings = dedupeIssues((result.warnings || []).map(formatIssue));
          
          const summary = await this.parseBuildSummary(logPath);
          let buildStatus: string | undefined;
          let summaryErrorCount: number | undefined;
          let summaryWarningCount: number | undefined;
          const deferredFallbackMessages: string[] = [];
          
          if (summary) {
            buildStatus = summary.buildStatus;
            summaryErrorCount = summary.errorCount;
            summaryWarningCount = summary.warningCount;
            
            if (summary.errors && summary.errors.length > 0) {
              errors = dedupeIssues([...errors, ...summary.errors.map(formatIssue)]);
            }
            
            if (summary.warnings && summary.warnings.length > 0) {
              warnings = dedupeIssues([...warnings, ...summary.warnings.map(formatIssue)]);
            }

            const summaryNotes = summary.notes ?? [];
            
            if (errors.length === 0) {
              const failureStatus = isFailureStatus(summary.buildStatus);
              const noteFailure = summaryNotes.find(note => classifyNote(note) === 'error');
              const reportedErrorCount = summary.errorCount ?? summary.errors?.length ?? 0;

              if (failureStatus || (reportedErrorCount > 0 && (!summary.errors || summary.errors.length === 0))) {
                const errorDescriptor = summary.buildStatus 
                  ? `Xcode reported build status '${summary.buildStatus}'`
                  : `Xcode reported ${reportedErrorCount} build error${reportedErrorCount === 1 ? '' : 's'} in the log summary`;
                
                const fallbackMessage = `${errorDescriptor} for log ${logPath}, but detailed issues were not available. Open the log in Xcode for full context.`;
                Logger.warn(`XCLogParser summary indicates a failure without detailed issues for ${logPath} (status=${summary.buildStatus || 'unknown'}, errors=${reportedErrorCount}).`);
                deferredFallbackMessages.push(fallbackMessage);
              } else if (noteFailure) {
                errors = dedupeIssues([...errors, formatIssue(noteFailure)]);
              }
            }

            if (warnings.length === 0 && summaryWarningCount && summaryWarningCount > 0 && summaryNotes.length > 0) {
              const warningNotes = summaryNotes
                .filter(note => classifyNote(note) === 'warning')
                .map(formatIssue);
              if (warningNotes.length > 0) {
                warnings = dedupeIssues([...warnings, ...warningNotes]);
              }
            }
          }
          
          const buildResult: ParsedBuildResults = {
            errors,
            warnings
          };
          if (buildStatus) {
            buildResult.buildStatus = buildStatus;
          } else if (result.buildStatus) {
            buildResult.buildStatus = result.buildStatus;
          }
          if (typeof summaryErrorCount === 'number') {
            buildResult.errorCount = summaryErrorCount;
          }
          if (typeof summaryWarningCount === 'number') {
            buildResult.warningCount = summaryWarningCount;
          }

          const summaryIndicatesFailure = summary
            ? isFailureStatus(summary.buildStatus) || (summary.errorCount ?? 0) > 0
            : false;
          const issuesIndicateFailure = isFailureStatus(result.buildStatus);

          if (buildResult.errors.length === 0 && (summaryIndicatesFailure || issuesIndicateFailure)) {
            const fallbackIssues = await this.parseDetailedIssues(logPath);
            if (fallbackIssues.errors.length > 0) {
              buildResult.errors = dedupeIssues([
                ...buildResult.errors,
                ...fallbackIssues.errors.map(formatIssue),
              ]);
              const currentErrorCount = buildResult.errorCount ?? 0;
              buildResult.errorCount = Math.max(currentErrorCount, fallbackIssues.errorCount);
            }
            if (fallbackIssues.warnings.length > 0) {
              buildResult.warnings = dedupeIssues([
                ...buildResult.warnings,
                ...fallbackIssues.warnings.map(formatIssue),
              ]);
              const currentWarningCount = buildResult.warningCount ?? 0;
              buildResult.warningCount = Math.max(currentWarningCount, fallbackIssues.warningCount);
            }
            if (buildResult.errors.length === 0 && fallbackIssues.notes.length > 0) {
              buildResult.errors = dedupeIssues([
                ...buildResult.errors,
                ...fallbackIssues.notes.map(formatIssue),
              ]);
            }
          }

          if (buildResult.errors.length === 0 && deferredFallbackMessages.length > 0) {
            buildResult.errors = dedupeIssues(deferredFallbackMessages);
          }

          resolveOnce(buildResult);
        } catch (parseError) {
          const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
          Logger.error('Failed to parse xclogparser output:', parseError);
          resolveOnce({
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
        if (resolved) {
          return;
        }
        cleanup();
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        Logger.error('Failed to run xclogparser:', err);
        resolveOnce({
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

  private static async parseBuildSummary(logPath: string): Promise<XCLogParserSummaryResult | null> {
    return new Promise<XCLogParserSummaryResult | null>((resolve) => {
      const command: ChildProcess = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'summaryJson']);
      let stdout = '';
      let stderr = '';

      const cleanup = () => {
        if (command && !command.killed) {
          command.kill('SIGTERM');
        }
      };
      process.once('exit', cleanup);
      process.once('SIGTERM', cleanup);
      process.once('SIGINT', cleanup);

      command.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      command.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      command.on('close', (code: number | null) => {
        process.removeListener('exit', cleanup);
        process.removeListener('SIGTERM', cleanup);
        process.removeListener('SIGINT', cleanup);

        if (code !== 0) {
          if (stderr.trim()) {
            Logger.warn(`XCLogParser summary reporter exited with code ${code}: ${stderr.trim()}`);
          }
          resolve(null);
          return;
        }

        try {
          const summary: XCLogParserSummaryResult = JSON.parse(stdout);
          resolve(summary);
        } catch (error) {
          Logger.warn('Failed to parse XCLogParser summary output:', error);
          resolve(null);
        }
      });

      command.on('error', (err: Error) => {
        process.removeListener('exit', cleanup);
        process.removeListener('SIGTERM', cleanup);
        process.removeListener('SIGINT', cleanup);
        Logger.warn('Failed to run xclogparser summary reporter:', err);
        resolve(null);
      });
    });
  }

  private static async parseDetailedIssues(logPath: string): Promise<{
    errors: XCLogParserIssue[];
    warnings: XCLogParserIssue[];
    notes: XCLogParserIssue[];
    errorCount: number;
    warningCount: number;
  }> {
    return new Promise((resolve) => {
      const command: ChildProcess = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'json']);
      let stdout = '';
      let stderr = '';

      const cleanup = () => {
        if (command && !command.killed) {
          command.kill('SIGTERM');
        }
      };
      process.once('exit', cleanup);
      process.once('SIGTERM', cleanup);
      process.once('SIGINT', cleanup);

      command.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      command.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const finish = () => {
        process.removeListener('exit', cleanup);
        process.removeListener('SIGTERM', cleanup);
        process.removeListener('SIGINT', cleanup);
      };

      command.on('close', (code: number | null) => {
        finish();
        if (code !== 0) {
          if (stderr.trim()) {
            Logger.warn(`XCLogParser JSON reporter exited with code ${code}: ${stderr.trim()}`);
          }
          resolve({
            errors: [],
            warnings: [],
            notes: [],
            errorCount: 0,
            warningCount: 0,
          });
          return;
        }

        try {
          const root = JSON.parse(stdout);

          const aggregated = {
            errors: [] as XCLogParserIssue[],
            warnings: [] as XCLogParserIssue[],
            notes: [] as XCLogParserIssue[],
          };
          let maxErrorCount = 0;
          let maxWarningCount = 0;

          const visit = (node: any): void => {
            if (!node || typeof node !== 'object') {
              return;
            }

            if (typeof node.errorCount === 'number') {
              maxErrorCount = Math.max(maxErrorCount, node.errorCount);
            }
            if (typeof node.warningCount === 'number') {
              maxWarningCount = Math.max(maxWarningCount, node.warningCount);
            }

            if (Array.isArray(node.errors)) {
              node.errors.forEach((issue: XCLogParserIssue) => aggregated.errors.push(issue));
            }

            if (Array.isArray(node.warnings)) {
              node.warnings.forEach((issue: XCLogParserIssue) => aggregated.warnings.push(issue));
            }

            if (Array.isArray(node.notes)) {
              node.notes.forEach((issue: XCLogParserIssue) => {
                aggregated.notes.push(issue);
                const classification = classifyNote(issue);
                if (classification === 'error') {
                  aggregated.errors.push(issue);
                } else if (classification === 'warning') {
                  aggregated.warnings.push(issue);
                }
              });
            }

            if (Array.isArray(node.subSteps)) {
              node.subSteps.forEach((sub: any) => visit(sub));
            }
          };

          visit(root);

          resolve({
            errors: aggregated.errors,
            warnings: aggregated.warnings,
            notes: aggregated.notes,
            errorCount: maxErrorCount,
            warningCount: maxWarningCount,
          });
        } catch (error) {
          Logger.warn('Failed to parse XCLogParser JSON output for detailed issues:', error);
          resolve({
            errors: [],
            warnings: [],
            notes: [],
            errorCount: 0,
            warningCount: 0,
          });
        }
      });

      command.on('error', (err: Error) => {
        finish();
        Logger.warn('Failed to run xclogparser JSON reporter:', err);
        resolve({
          errors: [],
          warnings: [],
          notes: [],
          errorCount: 0,
          warningCount: 0,
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

  public static async parseTestResults(_xcresultPath: string): Promise<ParsedBuildResults> {
    // For now, return a simple result indicating tests completed
    // The xcresult format is complex and the tool API has changed
    return {
      errors: [],
      warnings: [],
    };
  }
}
