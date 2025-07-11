import type { BuildLogInfo, ParsedBuildResults } from '../types/index.js';
export declare class BuildLogParser {
    static findProjectDerivedData(projectPath: string): Promise<string | null>;
    static getCustomDerivedDataLocationFromXcodePreferences(): Promise<string | null>;
    static getLatestBuildLog(projectPath: string): Promise<BuildLogInfo | null>;
    static getRecentBuildLogs(projectPath: string, sinceTime: number): Promise<BuildLogInfo[]>;
    static getLatestTestLog(projectPath: string): Promise<BuildLogInfo | null>;
    static parseBuildLog(logPath: string, retryCount?: number, maxRetries?: number): Promise<ParsedBuildResults>;
    static canParseLog(logPath: string): Promise<boolean>;
    static parseTestResults(_xcresultPath: string): Promise<ParsedBuildResults>;
}
//# sourceMappingURL=BuildLogParser.d.ts.map