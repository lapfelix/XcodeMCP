import { spawn } from 'child_process';
import { readdir, stat, readFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { Logger } from './Logger.js';
export class BuildLogParser {
    static async findProjectDerivedData(projectPath) {
        const customDerivedDataLocation = await this.getCustomDerivedDataLocationFromXcodePreferences();
        // Extract the actual project name from .xcodeproj or .xcworkspace files
        let projectName;
        let actualProjectPath = projectPath;
        // If projectPath points to a .xcodeproj file, get its directory
        if (projectPath.endsWith('.xcodeproj') || projectPath.endsWith('.xcworkspace')) {
            actualProjectPath = path.dirname(projectPath);
            projectName = path.basename(projectPath, path.extname(projectPath));
        }
        else {
            // projectPath is a directory, find project files inside it
            try {
                const files = await readdir(actualProjectPath);
                const projectFile = files.find(file => file.endsWith('.xcodeproj') || file.endsWith('.xcworkspace'));
                if (projectFile) {
                    projectName = path.basename(projectFile, path.extname(projectFile));
                }
                else {
                    // Fallback to directory name if no project files found
                    projectName = path.basename(actualProjectPath, path.extname(actualProjectPath));
                }
            }
            catch {
                // Fallback to directory name if we can't read the directory
                projectName = path.basename(actualProjectPath, path.extname(actualProjectPath));
            }
        }
        let derivedDataPath;
        if (!customDerivedDataLocation) {
            derivedDataPath = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
        }
        else if (customDerivedDataLocation.startsWith('/')) {
            derivedDataPath = customDerivedDataLocation;
        }
        else {
            const localProjectPath = path.dirname(projectPath);
            derivedDataPath = path.join(localProjectPath, customDerivedDataLocation);
        }
        try {
            const dirs = await readdir(derivedDataPath);
            const matches = dirs.filter(dir => dir.startsWith(`${projectName}-`));
            if (matches.length === 0)
                return null;
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
                }
                catch (plistError) {
                    // Continue to next match if info.plist can't be read
                    continue;
                }
            }
            return null;
        }
        catch (error) {
            return null;
        }
    }
    static async getCustomDerivedDataLocationFromXcodePreferences() {
        return new Promise((resolve) => {
            const defaults = spawn('defaults', ['read', 'com.apple.dt.Xcode', 'IDECustomDerivedDataLocation']);
            let stdout = '';
            let stderr = '';
            defaults.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            defaults.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            defaults.on('close', (code) => {
                if (code === 0 && stdout.trim()) {
                    resolve(stdout.trim());
                }
                else {
                    resolve(null);
                }
            });
            defaults.on('error', () => {
                resolve(null);
            });
        });
    }
    static async getLatestBuildLog(projectPath) {
        const derivedData = await this.findProjectDerivedData(projectPath);
        if (!derivedData)
            return null;
        const logsDir = path.join(derivedData, 'Logs', 'Build');
        try {
            const files = await readdir(logsDir);
            const logFiles = files.filter(file => file.endsWith('.xcactivitylog'));
            if (logFiles.length === 0)
                return null;
            let latestLog = null;
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
        }
        catch (error) {
            return null;
        }
    }
    static async getRecentBuildLogs(projectPath, sinceTime) {
        const derivedData = await this.findProjectDerivedData(projectPath);
        if (!derivedData)
            return [];
        const logsDir = path.join(derivedData, 'Logs', 'Build');
        try {
            const files = await readdir(logsDir);
            const logFiles = files.filter(file => file.endsWith('.xcactivitylog'));
            if (logFiles.length === 0)
                return [];
            const recentLogs = [];
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
        }
        catch (error) {
            return [];
        }
    }
    static async getLatestTestLog(projectPath) {
        const derivedData = await this.findProjectDerivedData(projectPath);
        if (!derivedData)
            return null;
        const logsDir = path.join(derivedData, 'Logs', 'Test');
        try {
            const files = await readdir(logsDir);
            const testResultDirs = files.filter(file => file.endsWith('.xcresult'));
            if (testResultDirs.length === 0)
                return null;
            let latestLog = null;
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
        }
        catch (error) {
            return null;
        }
    }
    static async parseBuildLog(logPath, retryCount = 0, maxRetries = 6) {
        const delays = [1000, 2000, 3000, 5000, 8000, 13000];
        return new Promise((resolve) => {
            const command = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
            let stdout = '';
            let stderr = '';
            // Ensure child process cleanup on exit
            const cleanup = () => {
                if (command && !command.killed) {
                    command.kill('SIGTERM');
                }
            };
            process.once('exit', cleanup);
            process.once('SIGTERM', cleanup);
            process.once('SIGINT', cleanup);
            command.stdout?.on('data', (data) => {
                stdout += data.toString();
            });
            command.stderr?.on('data', (data) => {
                stderr += data.toString();
            });
            command.on('close', (code) => {
                // Remove cleanup handlers once process closes
                process.removeListener('exit', cleanup);
                process.removeListener('SIGTERM', cleanup);
                process.removeListener('SIGINT', cleanup);
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
                            }, delays[retryCount]);
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
                    const result = JSON.parse(stdout);
                    const errors = [...new Set((result.errors || []).map(error => {
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
                        }))];
                    const warnings = [...new Set((result.warnings || []).map(warning => {
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
                        }))];
                    const buildResult = {
                        errors,
                        warnings
                    };
                    if (result.buildStatus) {
                        buildResult.buildStatus = result.buildStatus;
                    }
                    resolve(buildResult);
                }
                catch (parseError) {
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
            command.on('error', (err) => {
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
    static async canParseLog(logPath) {
        return new Promise((resolve) => {
            const command = spawn('xclogparser', ['parse', '--file', logPath, '--reporter', 'issues']);
            let hasOutput = false;
            command.stdout?.on('data', () => {
                hasOutput = true;
            });
            command.on('close', (code) => {
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
    static async parseTestResults(_xcresultPath) {
        // For now, return a simple result indicating tests completed
        // The xcresult format is complex and the tool API has changed
        return {
            errors: [],
            warnings: [],
        };
    }
}
//# sourceMappingURL=BuildLogParser.js.map