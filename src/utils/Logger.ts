import { createWriteStream, WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';

/**
 * Configurable logging system for XcodeMCP
 * Supports log levels: DEBUG, INFO, WARN, ERROR, SILENT
 * Logs to stderr by default, with optional file logging
 * Environment variables:
 * - LOG_LEVEL: Sets the minimum log level (default: INFO)
 * - XCODEMCP_LOG_FILE: Optional file path for logging
 * - XCODEMCP_CONSOLE_LOGGING: Enable/disable console output (default: true)
 */
export class Logger {
  public static readonly LOG_LEVELS = {
    SILENT: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4
  } as const;

  public static readonly LOG_LEVEL_NAMES: Record<number, string> = {
    0: 'SILENT',
    1: 'ERROR',
    2: 'WARN',
    3: 'INFO',
    4: 'DEBUG'
  };

  private static instance: Logger | null = null;

  private logLevel: number;
  private consoleLogging: boolean;
  private logFile: string | undefined;
  private fileStream: WriteStream | null = null;

  constructor() {
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'INFO');
    this.consoleLogging = process.env.XCODEMCP_CONSOLE_LOGGING !== 'false';
    this.logFile = process.env.XCODEMCP_LOG_FILE;
    this.setupFileLogging();
  }

  /**
   * Get or create the singleton logger instance
   */
  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Parse log level from string (case insensitive)
   */
  private parseLogLevel(levelStr: string): number {
    const level = levelStr.toUpperCase();
    const logLevelValue = Logger.LOG_LEVELS[level as keyof typeof Logger.LOG_LEVELS];
    return logLevelValue !== undefined ? logLevelValue : Logger.LOG_LEVELS.INFO;
  }

  /**
   * Setup file logging if specified
   */
  private async setupFileLogging(): Promise<void> {
    if (!this.logFile) {
      return;
    }

    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(this.logFile);
      await mkdir(dir, { recursive: true });
      
      // Create write stream
      this.fileStream = createWriteStream(this.logFile, { flags: 'a' });
      
      this.fileStream.on('error', (error: Error) => {
        // Fallback to stderr if file logging fails
        if (this.consoleLogging) {
          process.stderr.write(`Logger: Failed to write to log file: ${error.message}\n`);
        }
      });
    } catch (error) {
      // Fallback to stderr if file setup fails
      if (this.consoleLogging) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Logger: Failed to setup log file: ${errorMessage}\n`);
      }
    }
  }

  /**
   * Format log message with timestamp and level
   */
  private formatMessage(level: number, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const levelName = Logger.LOG_LEVEL_NAMES[level];
    const formattedArgs = args.length > 0 ? ' ' + args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ') : '';
    
    return `[${timestamp}] [${levelName}] XcodeMCP: ${message}${formattedArgs}`;
  }

  /**
   * Write log message to configured outputs
   */
  private writeLog(level: number, message: string, ...args: unknown[]): void {
    if (level > this.logLevel) {
      return; // Skip if below configured log level
    }

    const formattedMessage = this.formatMessage(level, message, ...args);

    // Always write to stderr for MCP protocol compatibility (unless console logging disabled)
    if (this.consoleLogging) {
      process.stderr.write(formattedMessage + '\n');
    }

    // Write to file if configured
    if (this.fileStream && this.fileStream.writable) {
      this.fileStream.write(formattedMessage + '\n');
    }
  }

  /**
   * Log at DEBUG level
   */
  public debug(message: string, ...args: unknown[]): void {
    this.writeLog(Logger.LOG_LEVELS.DEBUG, message, ...args);
  }

  /**
   * Log at INFO level
   */
  public info(message: string, ...args: unknown[]): void {
    this.writeLog(Logger.LOG_LEVELS.INFO, message, ...args);
  }

  /**
   * Log at WARN level
   */
  public warn(message: string, ...args: unknown[]): void {
    this.writeLog(Logger.LOG_LEVELS.WARN, message, ...args);
  }

  /**
   * Log at ERROR level
   */
  public error(message: string, ...args: unknown[]): void {
    this.writeLog(Logger.LOG_LEVELS.ERROR, message, ...args);
  }

  /**
   * Flush any pending log writes (important for process exit)
   */
  public async flush(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.fileStream && this.fileStream.writable) {
        this.fileStream.end(resolve);
      } else {
        resolve();
      }
    });
  }

  /**
   * Get current log level as string
   */
  public getLogLevel(): string {
    return Logger.LOG_LEVEL_NAMES[this.logLevel] || 'UNKNOWN';
  }

  /**
   * Check if a log level is enabled
   */
  public isLevelEnabled(level: number): boolean {
    return level <= this.logLevel;
  }

  // Static convenience methods
  public static debug(message: string, ...args: unknown[]): void {
    Logger.getInstance().debug(message, ...args);
  }

  public static info(message: string, ...args: unknown[]): void {
    Logger.getInstance().info(message, ...args);
  }

  public static warn(message: string, ...args: unknown[]): void {
    Logger.getInstance().warn(message, ...args);
  }

  public static error(message: string, ...args: unknown[]): void {
    Logger.getInstance().error(message, ...args);
  }

  public static async flush(): Promise<void> {
    if (Logger.instance) {
      await Logger.instance.flush();
    }
  }

  public static getLogLevel(): string {
    return Logger.getInstance().getLogLevel();
  }

  public static isLevelEnabled(level: number): boolean {
    return Logger.getInstance().isLevelEnabled(level);
  }
}

export default Logger;

// Ensure proper cleanup on process exit
process.on('exit', async () => {
  await Logger.flush();
});

process.on('SIGINT', async () => {
  await Logger.flush();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await Logger.flush();
  process.exit(0);
});
