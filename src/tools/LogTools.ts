import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import type { McpResult } from '../types/index.js';
import BuildLogStore, { BuildLogRecord, type BuildLogKind } from '../utils/BuildLogStore.js';
import { BuildLogParser } from '../utils/BuildLogParser.js';
import PathValidator from '../utils/PathValidator.js';
import Logger from '../utils/Logger.js';

interface BuildLogViewParams {
  logPath: string;
  projectPath: string;
  logRecord?: BuildLogRecord;
  hint?: string;
  filter?: string;
  filter_globs?: string[];
  filter_regex?: boolean;
  case_sensitive?: boolean;
  max_lines?: number;
  cursor?: string;
  logType?: BuildLogKind;
}

interface LogCursorPayload {
  v: 1;
  logPath: string;
  logId?: string;
  byteOffset: number;
  mtimeMs: number;
}

export class LogTools {
  public static async getBuildLog(params: {
    log_id?: string;
    xcodeproj?: string;
    filter?: string;
    filter_regex?: boolean;
    case_sensitive?: boolean;
    max_lines?: number;
    cursor?: string;
    filter_globs?: string[];
    log_type?: 'build' | 'run';
  }): Promise<McpResult> {
    const { log_id, xcodeproj, filter, filter_regex = false, case_sensitive = false } = params;
    const logType: BuildLogKind = params.log_type === 'run' ? 'run' : 'build';
    let { max_lines } = params;
    const filterGlobs = Array.isArray(params.filter_globs)
      ? params.filter_globs.filter(pattern => typeof pattern === 'string' && pattern.trim().length > 0)
      : undefined;
    const cursor = typeof params.cursor === 'string' && params.cursor.length > 0 ? params.cursor : undefined;

    if (!log_id && !xcodeproj) {
      return {
        content: [
          {
            type: 'text',
            text: '❌ Provide either log_id (preferred) or xcodeproj to identify which build/run log to show.',
          },
        ],
        isError: true,
      };
    }

    let record = log_id ? BuildLogStore.getLog(log_id) : undefined;
    if (record && record.logKind !== logType) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Log ID ${log_id} refers to a ${record.logKind} log, but this command expects a ${logType} log.`,
          },
        ],
        isError: true,
      };
    }

    if (!record && xcodeproj) {
      const { resolvedPath, error } = PathValidator.resolveAndValidateProjectPath(xcodeproj, 'xcodeproj');
      if (error) {
        return error;
      }
      record = BuildLogStore.getLatestLogForProject(resolvedPath, logType);
      if (!record) {
        const latestLog =
          logType === 'run'
            ? await BuildLogParser.getLatestRunLog(resolvedPath)
            : await BuildLogParser.getLatestBuildLog(resolvedPath);
        if (latestLog) {
          const responseParams: BuildLogViewParams = {
            logPath: latestLog.path,
            projectPath: resolvedPath,
            hint:
              logType === 'run'
                ? 'Latest run log from DerivedData (not tracked by MCP log store)'
                : 'Latest build log from DerivedData (not tracked by MCP log store)',
            filter_regex,
            case_sensitive,
            logType,
          };
          if (typeof filter === 'string') {
            responseParams.filter = filter;
          }
          if (filterGlobs && filterGlobs.length > 0) {
            responseParams.filter_globs = filterGlobs;
          }
          if (typeof max_lines === 'number' && Number.isFinite(max_lines) && max_lines > 0) {
            responseParams.max_lines = max_lines;
          }
          if (cursor) {
            responseParams.cursor = cursor;
          }
          return this.buildResponseFromPath(responseParams);
        }
      }
    }

    if (!record) {
      const scope = log_id ? `log ID ${log_id}` : `project ${basename(xcodeproj ?? 'unknown')}`;
      return {
        content: [{ type: 'text', text: `❌ Could not find a ${logType} log associated with ${scope}.` }],
        isError: true,
      };
    }

    const responseParams: BuildLogViewParams = {
      logPath: record.logPath,
      projectPath: record.projectPath,
      logRecord: record,
      filter_regex,
      case_sensitive,
      logType,
    };
    if (typeof filter === 'string') {
      responseParams.filter = filter;
    }
    if (filterGlobs && filterGlobs.length > 0) {
      responseParams.filter_globs = filterGlobs;
    }
    if (typeof max_lines === 'number' && Number.isFinite(max_lines) && max_lines > 0) {
      responseParams.max_lines = max_lines;
    }
    if (cursor) {
      responseParams.cursor = cursor;
    }
    return this.buildResponseFromPath(responseParams);
  }

  private static async buildResponseFromPath(params: BuildLogViewParams): Promise<McpResult> {
    const {
      logPath,
      projectPath,
      logRecord,
      hint,
      filter,
      filter_regex = false,
      case_sensitive = false,
    } = params;
    let { max_lines } = params;

    max_lines = typeof max_lines === 'number' && max_lines > 0 ? Math.floor(max_lines) : 400;

    try {
      const fileStats = await stat(logPath);
      const fileBuffer = await readFile(logPath);

      let cursorPayload: LogCursorPayload | null = null;
      let startOffset = 0;
      if (params.cursor) {
        cursorPayload = this.decodeCursor(params.cursor);
        if (!cursorPayload) {
          return {
            content: [{ type: 'text', text: '❌ Invalid cursor format. Please re-run without --cursor.' }],
            isError: true,
          };
        }
        if (cursorPayload.logPath !== logPath) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Cursor belongs to a different log file. Use the cursor that was returned with this log.',
              },
            ],
            isError: true,
          };
        }
        if (cursorPayload.logId && logRecord?.id && cursorPayload.logId !== logRecord.id) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Cursor is tied to a different build/run session. Please use the most recent cursor for this log.',
              },
            ],
            isError: true,
          };
        }
        if (cursorPayload.byteOffset > fileBuffer.length) {
          return {
            content: [
              {
                type: 'text',
                text: '❌ Cursor is no longer valid because the log file rotated or shrank. Re-run without --cursor to start over.',
              },
            ],
            isError: true,
          };
        }
        startOffset = cursorPayload.byteOffset;
      }

      const slicedBuffer = startOffset > 0 ? fileBuffer.slice(startOffset) : fileBuffer;
      const slicedText = slicedBuffer.toString('utf8');
      let lines =
        slicedText.length === 0
          ? []
          : slicedText.split(/\r?\n/).filter((line, idx, arr) => !(line === '' && idx === arr.length - 1));

      const matchers: Array<(line: string) => boolean> = [];
      const globFilters = params.filter_globs;
      if (filter && filter.length > 0) {
        if (filter_regex) {
          try {
            const flags = case_sensitive ? '' : 'i';
            const regex = new RegExp(filter, flags);
            matchers.push((line: string) => regex.test(line));
          } catch (error) {
            Logger.warn(`Invalid regex filter "${filter}": ${error instanceof Error ? error.message : error}`);
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Invalid filter regex "${filter}": ${error instanceof Error ? error.message : error}`,
                },
              ],
              isError: true,
            };
          }
        } else {
          const needle = case_sensitive ? filter : filter.toLowerCase();
          matchers.push((line: string) => {
            const haystack = case_sensitive ? line : line.toLowerCase();
            return haystack.includes(needle);
          });
        }
      }
      if (globFilters && globFilters.length > 0) {
        for (const glob of globFilters) {
          const regex = this.globToRegex(glob, case_sensitive);
          if (!regex) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Invalid filter glob "${glob}". Use * and ? wildcards only.`,
                },
              ],
              isError: true,
            };
          }
          matchers.push((line: string) => regex.test(line));
        }
      }

      let filteredLines =
        matchers.length > 0 ? lines.filter(line => matchers.some(matcher => matcher(line))) : lines;
      const truncated = filteredLines.length > max_lines;
      if (truncated) {
        filteredLines = filteredLines.slice(filteredLines.length - max_lines);
      }

      if (filteredLines.length === 0) {
        filteredLines = ['(no matching lines in this range)'];
      }

      const logLabel = logRecord?.logKind ?? params.logType ?? 'build';
      const headerLines = [
        `🪵 ${logLabel === 'run' ? 'Run' : 'Build/Run'} Log: ${basename(projectPath)}`,
        `  • Path: ${logPath}`,
        `  • Type: ${logLabel === 'run' ? 'Run Log' : 'Build Log'}`,
      ];
      if (logRecord?.id) {
        headerLines.push(`  • Log ID: ${logRecord.id}`);
      }
      if (logRecord?.status) {
        headerLines.push(`  • Status: ${logRecord.status}${logRecord.buildStatus ? ` (${logRecord.buildStatus})` : ''}`);
      } else if (hint) {
        headerLines.push(`  • Source: ${hint}`);
      }
      if (cursorPayload) {
        headerLines.push(
          `  • Showing lines appended after cursor offset ${cursorPayload.byteOffset.toLocaleString('en-US')}`,
        );
      }
      if (filter) {
        headerLines.push(`  • Filter: ${filter_regex ? `regex /${filter}/` : `"${filter}"`} (${case_sensitive ? 'case-sensitive' : 'case-insensitive'})`);
      }
      if (globFilters && globFilters.length > 0) {
        headerLines.push(`  • Filter Globs: ${globFilters.join(', ')}`);
      }
      if (truncated) {
        headerLines.push(`  • Showing last ${max_lines} matching line${max_lines === 1 ? '' : 's'} (truncated)`);
      } else {
        headerLines.push(`  • Showing ${filteredLines.length} line${filteredLines.length === 1 ? '' : 's'}`);
      }

      const newCursorPayload: LogCursorPayload = {
        v: 1,
        logPath,
        byteOffset: fileBuffer.length,
        mtimeMs: fileStats.mtimeMs,
      };
      if (logRecord?.id) {
        newCursorPayload.logId = logRecord.id;
      }
      const newCursor = this.encodeCursor(newCursorPayload);
      headerLines.push(`  • Cursor: ${newCursor}`);
      headerLines.push('    (Supply this cursor next time to stream only new log output.)');

      const message = `${headerLines.join('\n')}\n\n${filteredLines.join('\n')}`;
      return { content: [{ type: 'text', text: message }] };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: `❌ Failed to read log file (${logPath}): ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  private static encodeCursor(payload: LogCursorPayload): string {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  private static decodeCursor(cursor: string): LogCursorPayload | null {
    try {
      const json = Buffer.from(cursor, 'base64url').toString('utf8');
      const parsed = JSON.parse(json);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.v !== 1 ||
        typeof parsed.logPath !== 'string' ||
        typeof parsed.byteOffset !== 'number' ||
        parsed.byteOffset < 0
      ) {
        return null;
      }
      return parsed as LogCursorPayload;
    } catch {
      return null;
    }
  }

  private static globToRegex(pattern: string, caseSensitive: boolean): RegExp | null {
    if (typeof pattern !== 'string' || pattern.length === 0) {
      return null;
    }
    const escaped = pattern.replace(/([.+^${}()|[\]\\])/g, '\\$1').replace(/\*/g, '.*').replace(/\?/g, '.');
    try {
      return new RegExp(escaped, caseSensitive ? '' : 'i');
    } catch {
      return null;
    }
  }
}

export default LogTools;
