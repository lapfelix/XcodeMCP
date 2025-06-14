import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';

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
  static LOG_LEVELS = {
    SILENT: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4
  };

  static LOG_LEVEL_NAMES = {
    0: 'SILENT',
    1: 'ERROR',
    2: 'WARN',
    3: 'INFO',
    4: 'DEBUG'
  };

  static instance = null;
  static initialized = false;

  constructor() {
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'INFO');
    this.consoleLogging = process.env.XCODEMCP_CONSOLE_LOGGING !== 'false';
    this.logFile = process.env.XCODEMCP_LOG_FILE;
    this.fileStream = null;
    this.setupFileLogging();
  }

  /**
   * Get or create the singleton logger instance
   */
  static getInstance() {
    if (!Logger.instance) {
      Logger.instance = new Logger();
      Logger.initialized = true;
    }
    return Logger.instance;
  }

  /**
   * Parse log level from string (case insensitive)
   */
  parseLogLevel(levelStr) {
    const level = levelStr.toUpperCase();
    return Logger.LOG_LEVELS[level] !== undefined ? Logger.LOG_LEVELS[level] : Logger.LOG_LEVELS.INFO;
  }

  /**
   * Setup file logging if specified
   */
  async setupFileLogging() {
    if (!this.logFile) {
      return;
    }

    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(this.logFile);
      await mkdir(dir, { recursive: true });
      
      // Create write stream
      this.fileStream = createWriteStream(this.logFile, { flags: 'a' });
      
      this.fileStream.on('error', (error) => {
        // Fallback to stderr if file logging fails
        if (this.consoleLogging) {
          process.stderr.write(`Logger: Failed to write to log file: ${error.message}\n`);
        }
      });
    } catch (error) {
      // Fallback to stderr if file setup fails
      if (this.consoleLogging) {
        process.stderr.write(`Logger: Failed to setup log file: ${error.message}\n`);
      }
    }
  }

  /**
   * Format log message with timestamp and level
   */
  formatMessage(level, message, ...args) {
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
  writeLog(level, message, ...args) {
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
  debug(message, ...args) {
    this.writeLog(Logger.LOG_LEVELS.DEBUG, message, ...args);
  }

  /**
   * Log at INFO level
   */
  info(message, ...args) {
    this.writeLog(Logger.LOG_LEVELS.INFO, message, ...args);
  }

  /**
   * Log at WARN level
   */
  warn(message, ...args) {
    this.writeLog(Logger.LOG_LEVELS.WARN, message, ...args);
  }

  /**
   * Log at ERROR level
   */
  error(message, ...args) {
    this.writeLog(Logger.LOG_LEVELS.ERROR, message, ...args);
  }

  /**
   * Flush any pending log writes (important for process exit)
   */
  async flush() {
    return new Promise((resolve) => {
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
  getLogLevel() {
    return Logger.LOG_LEVEL_NAMES[this.logLevel];
  }

  /**
   * Check if a log level is enabled
   */
  isLevelEnabled(level) {
    return level <= this.logLevel;
  }

  // Static convenience methods
  static debug(message, ...args) {
    Logger.getInstance().debug(message, ...args);
  }

  static info(message, ...args) {
    Logger.getInstance().info(message, ...args);
  }

  static warn(message, ...args) {
    Logger.getInstance().warn(message, ...args);
  }

  static error(message, ...args) {
    Logger.getInstance().error(message, ...args);
  }

  static async flush() {
    if (Logger.instance) {
      await Logger.instance.flush();
    }
  }

  static getLogLevel() {
    return Logger.getInstance().getLogLevel();
  }

  static isLevelEnabled(level) {
    return Logger.getInstance().isLevelEnabled(level);
  }
}

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