import { randomUUID } from 'crypto';
import Path from 'path';
import Logger from './Logger.js';

export type BuildLogStatus = 'active' | 'completed' | 'failed';
export type BuildLogAction = 'build' | 'run' | 'test';
export type BuildLogKind = 'build' | 'run';

export interface BuildLogRecord {
  id: string;
  projectPath: string;
  logPath: string;
  schemeName?: string | null;
  destination?: string | null;
  action: BuildLogAction;
  logKind: BuildLogKind;
  status: BuildLogStatus;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  buildStatus?: string | null;
}

export class BuildLogStore {
  private static readonly MAX_LOGS_PER_PROJECT = 10;
  private static logs = new Map<string, BuildLogRecord>();
  private static projectIndex = new Map<string, string[]>();

  public static registerLog(params: {
    projectPath: string;
    logPath: string;
    schemeName?: string | null;
    destination?: string | null;
    action?: BuildLogAction;
    logKind?: BuildLogKind;
  }): BuildLogRecord {
    const id = randomUUID();
    const now = Date.now();
    const record: BuildLogRecord = {
      id,
      projectPath: params.projectPath,
      logPath: params.logPath,
      schemeName: params.schemeName ?? null,
      destination: params.destination ?? null,
      action: params.action ?? 'build',
      logKind: params.logKind ?? 'build',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    this.logs.set(id, record);
    this.indexProjectLog(record.projectPath, id);
    Logger.debug(
      `Registered ${record.logKind} log ${id} for ${Path.basename(record.projectPath)} (${record.action}) -> ${record.logPath}`,
    );
    return record;
  }

  public static updateStatus(
    logId: string | null | undefined,
    status: BuildLogStatus,
    extras?: Partial<Pick<BuildLogRecord, 'buildStatus'>>,
  ): void {
    if (!logId) return;
    const record = this.logs.get(logId);
    if (!record) return;
    record.status = status;
    record.updatedAt = Date.now();
    if (status !== 'active') {
      record.completedAt = record.updatedAt;
    }
    if (extras?.buildStatus !== undefined) {
      record.buildStatus = extras.buildStatus;
    }
    Logger.debug(
      `Updated log ${logId}: status=${status}${record.buildStatus ? `, buildStatus=${record.buildStatus}` : ''}`,
    );
  }

  public static getLog(logId: string): BuildLogRecord | undefined {
    return this.logs.get(logId);
  }

  public static getLatestLogForProject(projectPath: string, logKind?: BuildLogKind): BuildLogRecord | undefined {
    const ids = this.projectIndex.get(projectPath);
    if (!ids) return undefined;
    for (const id of ids) {
      const record = this.logs.get(id);
      if (record && (!logKind || record.logKind === logKind)) {
        return record;
      }
    }
    return undefined;
  }

  public static listLogsForProject(projectPath: string, logKind?: BuildLogKind): BuildLogRecord[] {
    const ids = this.projectIndex.get(projectPath);
    if (!ids) return [];
    const records = ids
      .map(id => this.logs.get(id))
      .filter((record): record is BuildLogRecord => Boolean(record));
    return logKind ? records.filter(record => record.logKind === logKind) : records;
  }

  private static indexProjectLog(projectPath: string, logId: string): void {
    const existing = this.projectIndex.get(projectPath) ?? [];
    existing.unshift(logId);
    while (existing.length > this.MAX_LOGS_PER_PROJECT) {
      const removedId = existing.pop();
      if (removedId) {
        this.logs.delete(removedId);
      }
    }
    this.projectIndex.set(projectPath, existing);
  }
}

export default BuildLogStore;
