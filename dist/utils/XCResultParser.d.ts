import type { TestAttachment } from '../types/index.js';
export interface TestResultsSummary {
    devicesAndConfigurations: DeviceConfiguration[];
    environmentDescription: string;
    expectedFailures: number;
    failedTests: number;
    finishTime: number;
    passedTests: number;
    result: string;
    skippedTests: number;
    startTime: number;
    testFailures: TestFailure[];
    title: string;
    totalTestCount: number;
    statistics: any[];
    topInsights: any[];
}
export interface DeviceConfiguration {
    device: Device;
    expectedFailures: number;
    failedTests: number;
    passedTests: number;
    skippedTests: number;
    testPlanConfiguration: TestPlanConfiguration;
}
export interface Device {
    architecture: string;
    deviceId: string;
    deviceName: string;
    modelName: string;
    osBuildNumber: string;
    osVersion: string;
    platform: string;
}
export interface TestPlanConfiguration {
    configurationId: string;
    configurationName: string;
}
export interface TestFailure {
    failureText: string;
    targetName: string;
    testIdentifier: number;
    testIdentifierString: string;
    testIdentifierURL: string;
    testName: string;
}
export interface TestResults {
    devices: Device[];
    testNodes: TestNode[];
    testPlanConfigurations: TestPlanConfiguration[];
}
export interface TestNode {
    children?: TestNode[];
    duration?: string;
    durationInSeconds?: number;
    name: string;
    nodeIdentifier?: string;
    nodeIdentifierURL?: string;
    nodeType: string;
    result: string;
}
export interface XCResultAnalysis {
    summary: TestResultsSummary;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    passRate: number;
    duration: string;
}
export declare class XCResultParser {
    private xcresultPath;
    constructor(xcresultPath: string);
    /**
     * Check if xcresult file exists and is readable
     */
    static isXCResultReadable(xcresultPath: string): boolean;
    /**
     * Wait for xcresult to be fully written and readable with robust checks
     * Uses proportional timeouts based on test duration - longer tests need more patience
     */
    static waitForXCResultReadiness(xcresultPath: string, testDurationMs?: number): Promise<boolean>;
    /**
     * Get test results summary
     */
    getTestResultsSummary(): Promise<TestResultsSummary>;
    /**
     * Get detailed test results
     */
    getTestResults(): Promise<TestResults>;
    /**
     * Analyze xcresult and provide comprehensive summary
     */
    analyzeXCResult(): Promise<XCResultAnalysis>;
    /**
     * Extract individual test details from test results
     */
    extractTestDetails(): Promise<{
        failed: Array<{
            name: string;
            id: string;
        }>;
        passed: Array<{
            name: string;
            id: string;
        }>;
        skipped: Array<{
            name: string;
            id: string;
        }>;
    }>;
    /**
     * Format test results summary with optional individual test details
     */
    formatTestResultsSummary(includeIndividualTests?: boolean, maxPassedTests?: number): Promise<string>;
    /**
     * Get console output for a specific test
     */
    getConsoleOutput(testId?: string): Promise<string>;
    /**
     * Get test activities for a specific test
     */
    getTestActivities(testId: string): Promise<string>;
    /**
     * Get test attachments for a specific test from activities output
     */
    getTestAttachments(testId: string): Promise<TestAttachment[]>;
    /**
     * Export an attachment to a temporary directory
     */
    exportAttachment(attachmentId: string, filename?: string): Promise<string>;
    /**
     * Find a test node by ID or index
     */
    findTestNode(testIdOrIndex: string): Promise<TestNode | null>;
    /**
     * Format test list with indices
     */
    formatTestList(): Promise<string>;
    /**
     * Format detailed test information
     */
    formatTestDetails(testIdOrIndex: string, includeConsole?: boolean): Promise<string>;
    private static runXCResultTool;
    private cleanJSONFloats;
    private formatDuration;
    private formatTestActivities;
    private formatActivity;
    private formatTestHierarchy;
    private calculateTestCounts;
    private countTestCases;
    private searchTestNodeById;
    private findTestNodeByIndex;
    private getStatusIcon;
    /**
     * Extract attachments from activities JSON recursively
     */
    private extractAttachmentsFromActivities;
    /**
     * Find the test start time from the activities JSON to enable relative timestamp calculation
     */
    private findTestStartTime;
}
//# sourceMappingURL=XCResultParser.d.ts.map