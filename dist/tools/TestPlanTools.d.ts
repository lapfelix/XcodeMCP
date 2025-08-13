import type { McpResult } from '../types/index.js';
interface TestTarget {
    containerPath: string;
    identifier: string;
    name: string;
}
interface TestTargetConfig {
    target: TestTarget;
    selectedTests?: string[];
    skippedTests?: string[];
}
export declare class TestPlanTools {
    /**
     * Update an .xctestplan file to run specific tests
     */
    static updateTestPlan(testPlanPath: string, testTargets: TestTargetConfig[]): Promise<McpResult>;
    /**
     * Update test plan and automatically trigger lightweight reload
     */
    static updateTestPlanAndReload(testPlanPath: string, projectPath: string, testTargets: TestTargetConfig[]): Promise<McpResult>;
    /**
     * Attempt to trigger Xcode to reload test plan without closing project
     */
    static triggerTestPlanReload(testPlanPath: string, projectPath: string): Promise<McpResult>;
    /**
     * Scan project for all available test classes and methods
     */
    static scanAvailableTests(projectPath: string, testPlanPath?: string): Promise<McpResult>;
}
export {};
//# sourceMappingURL=TestPlanTools.d.ts.map