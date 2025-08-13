import type { EnvironmentValidation } from '../types/index.js';
export declare class EnvironmentValidator {
    private static validationResults;
    /**
     * Validates the entire environment and returns detailed results
     */
    static validateEnvironment(): Promise<EnvironmentValidation>;
    /**
     * Validates macOS environment
     */
    private static validateOS;
    /**
     * Validates Xcode installation
     */
    private static validateXcode;
    /**
     * Validates XCLogParser installation
     */
    private static validateXCLogParser;
    /**
     * Validates osascript availability
     */
    private static validateOSAScript;
    /**
     * Get the actual Xcode application path
     */
    private static getXcodePath;
    /**
     * Validates automation permissions
     */
    private static validatePermissions;
    /**
     * Gets Xcode version
     */
    private static getXcodeVersion;
    /**
     * Executes a command and returns stdout
     */
    private static executeCommand;
    /**
     * Generates a human-readable validation summary
     */
    private static generateValidationSummary;
    /**
     * Checks if the environment can operate in degraded mode
     */
    static canOperateInDegradedMode(results?: EnvironmentValidation | null): boolean;
    /**
     * Gets the list of features unavailable in current environment
     */
    static getUnavailableFeatures(results?: EnvironmentValidation | null): string[];
    /**
     * Gets the version from package.json
     */
    private static getVersion;
    /**
     * Creates a configuration health check report
     */
    static createHealthCheckReport(): Promise<string>;
}
//# sourceMappingURL=EnvironmentValidator.d.ts.map