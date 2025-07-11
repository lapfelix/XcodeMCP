/**
 * Configurable logging system for XcodeMCP
 * Supports log levels: DEBUG, INFO, WARN, ERROR, SILENT
 * Logs to stderr by default, with optional file logging
 * Environment variables:
 * - LOG_LEVEL: Sets the minimum log level (default: INFO)
 * - XCODEMCP_LOG_FILE: Optional file path for logging
 * - XCODEMCP_CONSOLE_LOGGING: Enable/disable console output (default: true)
 */
export declare class Logger {
    static readonly LOG_LEVELS: {
        readonly SILENT: 0;
        readonly ERROR: 1;
        readonly WARN: 2;
        readonly INFO: 3;
        readonly DEBUG: 4;
    };
    static readonly LOG_LEVEL_NAMES: Record<number, string>;
    private static instance;
    private logLevel;
    private consoleLogging;
    private logFile;
    private fileStream;
    constructor();
    /**
     * Get or create the singleton logger instance
     */
    static getInstance(): Logger;
    /**
     * Parse log level from string (case insensitive)
     */
    private parseLogLevel;
    /**
     * Setup file logging if specified
     */
    private setupFileLogging;
    /**
     * Format log message with timestamp and level
     */
    private formatMessage;
    /**
     * Write log message to configured outputs
     */
    private writeLog;
    /**
     * Log at DEBUG level
     */
    debug(message: string, ...args: unknown[]): void;
    /**
     * Log at INFO level
     */
    info(message: string, ...args: unknown[]): void;
    /**
     * Log at WARN level
     */
    warn(message: string, ...args: unknown[]): void;
    /**
     * Log at ERROR level
     */
    error(message: string, ...args: unknown[]): void;
    /**
     * Flush any pending log writes (important for process exit)
     */
    flush(): Promise<void>;
    /**
     * Get current log level as string
     */
    getLogLevel(): string;
    /**
     * Check if a log level is enabled
     */
    isLevelEnabled(level: number): boolean;
    static debug(message: string, ...args: unknown[]): void;
    static info(message: string, ...args: unknown[]): void;
    static warn(message: string, ...args: unknown[]): void;
    static error(message: string, ...args: unknown[]): void;
    static flush(): Promise<void>;
    static getLogLevel(): string;
    static isLevelEnabled(level: number): boolean;
}
//# sourceMappingURL=Logger.d.ts.map