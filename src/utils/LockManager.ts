import { watch } from 'fs';
import type { FSWatcher } from 'fs';
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
  open,
  rename,
} from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID, createHash } from 'crypto';
import Logger from './Logger.js';

export interface LockFileData {
  filePath: string;
  fileName: string;
  path: string;
  reason: string;
  command: string;
  lockedAt: string;
  lockId: string;
  version: number;
  queueDepth: number;
  queuePosition: number;
}

export interface BlockedLockInfo extends LockFileData {
  waitedMs: number;
}

export interface LockAcquisition {
  lock: LockFileData;
  blockedBy?: BlockedLockInfo;
  footerText: string;
}

export interface ReleaseResult {
  released: boolean;
  info?: LockFileData | null;
}

export interface ReleaseAllResult {
  released: number;
  details: LockFileData[];
}

interface LockQueueEntry {
  id: string;
  reason: string;
  command: string;
  createdAt: string;
  lockedAt: string | null;
}

interface LockFileState {
  version: number;
  path: string;
  queue: LockQueueEntry[];
}

interface FooterContext {
  projectPath: string;
  lock: LockFileData;
  blockedBy?: BlockedLockInfo;
  commandName: string;
}

export default class LockManager {
  private static lockDirPromise: Promise<string> | null = null;
  private static customLockDir: string | null = null;
  private static readonly LOCK_VERSION = 2;
  private static readonly MAX_REASON_LENGTH = 160;
  private static readonly MUTEX_SUFFIX = '.mutex';

  public static getMaxReasonLength(): number {
    return this.MAX_REASON_LENGTH;
  }

  /**
   * Override lock directory (tests only)
   */
  public static setCustomLockDirectory(dir: string | null): void {
    this.customLockDir = dir ? resolve(dir) : null;
    this.lockDirPromise = null;
  }

  private static resolveLockDir(): string {
    if (this.customLockDir) {
      return this.customLockDir;
    }
    const override = process.env.XCODE_MCP_LOCK_DIR?.trim();
    if (override) {
      return resolve(override);
    }
    const home = homedir();
    if (process.platform === 'darwin') {
      return join(home, 'Library', 'Application Support', 'XcodeMCP', 'locks');
    }
    return join(home, '.xcodemcp', 'locks');
  }

  private static async ensureLockDir(): Promise<string> {
    if (!this.lockDirPromise) {
      this.lockDirPromise = (async () => {
        const dir = this.resolveLockDir();
        await mkdir(dir, { recursive: true, mode: 0o755 });
        return dir;
      })().catch(error => {
        this.lockDirPromise = null;
        throw error;
      });
    }
    return this.lockDirPromise;
  }

  private static slugify(projectPath: string): string {
    const baseName = basename(projectPath)
      .replace(/\.(xcworkspace|xcodeproj)$/i, '')
      .trim();
    const slug = baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return slug || 'xcode-project';
  }

  private static deriveDeterministicUuid(projectPath: string): string {
    const hash = createHash('sha1').update(projectPath).digest();
    const bytes = Buffer.alloc(16);
    hash.copy(bytes, 0, 0, 16);
    bytes[6] = (((bytes[6] ?? 0) & 0x0f) | 0x50) as number; // version 5
    bytes[8] = (((bytes[8] ?? 0) & 0x3f) | 0x80) as number; // variant
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  private static async getLockFilePath(projectPath: string): Promise<string> {
    const dir = await this.ensureLockDir();
    const slug = this.slugify(projectPath);
    const deterministic = this.deriveDeterministicUuid(projectPath);
    return join(dir, `${slug}-${deterministic}.yaml`);
  }

  private static async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  private static toSnapshot(
    lockFilePath: string,
    entry: LockQueueEntry,
    queuePosition: number,
    queueDepth: number,
    projectPath: string,
  ): LockFileData {
    return {
      filePath: lockFilePath,
      fileName: basename(lockFilePath),
      path: projectPath,
      reason: entry.reason,
      command: entry.command,
      lockedAt: entry.lockedAt ?? entry.createdAt,
      lockId: entry.id,
      version: this.LOCK_VERSION,
      queueDepth,
      queuePosition,
    };
  }

  private static buildSnapshot(lockFilePath: string, state: LockFileState, queuePosition: number): LockFileData {
    const entry = state.queue[queuePosition];
    if (!entry) {
      throw new Error(`Invalid queue position ${queuePosition} for lock file ${lockFilePath}`);
    }
    return this.toSnapshot(lockFilePath, entry, queuePosition, state.queue.length, state.path);
  }

  private static parseLockFile(raw: string, filePath: string): LockFileState | null {
    const lines = raw.split(/\r?\n/);
    const state: LockFileState = {
      version: this.LOCK_VERSION,
      path: '',
      queue: [],
    };

    let inQueue = false;
    let currentEntry: Partial<LockQueueEntry> | null = null;

    const flushEntry = () => {
      if (!currentEntry) return;
      if (currentEntry.id && currentEntry.reason && currentEntry.command && currentEntry.createdAt) {
        state.queue.push({
          id: currentEntry.id,
          reason: currentEntry.reason,
          command: currentEntry.command,
          createdAt: currentEntry.createdAt,
          lockedAt: currentEntry.lockedAt ?? null,
        });
      }
      currentEntry = null;
    };

    const normalizeKey = (key: string): keyof LockQueueEntry => {
      switch (key) {
        case 'created-at':
          return 'createdAt';
        case 'locked-at':
          return 'lockedAt';
        default:
          return key as keyof LockQueueEntry;
      }
    };

    for (const line of lines) {
      if (!line.trim()) continue;
      if (line.startsWith('lock-version')) {
        const [, value = ''] = line.split(':');
        state.version = Number(value.trim()) || this.LOCK_VERSION;
        continue;
      }
      if (line.startsWith('path:')) {
        const [, value = ''] = line.split(':');
        state.path = this.parseScalar(value.trim());
        continue;
      }
      if (line.startsWith('queue:')) {
        inQueue = true;
        continue;
      }
      if (!inQueue) {
        continue;
      }
      if (line.startsWith('  - ')) {
        flushEntry();
        const remainder = line.slice(4);
        const [rawKey, ...rest] = remainder.split(':');
        if (!rawKey) {
          currentEntry = null;
          continue;
        }
        currentEntry = {};
        const normalizedKey = normalizeKey(rawKey.trim());
        currentEntry[normalizedKey] = this.parseScalar(rest.join(':').trim());
        continue;
      }
      if (currentEntry && line.startsWith('    ')) {
        const trimmed = line.trim();
        const [rawKey, ...rest] = trimmed.split(':');
        if (!rawKey) {
          continue;
        }
        const normalizedKey = normalizeKey(rawKey.trim());
        currentEntry[normalizedKey] = this.parseScalar(rest.join(':').trim());
      }
    }

    flushEntry();

    if (!state.path) {
      Logger.warn(`Lock file ${filePath} missing path metadata`);
      return null;
    }

    return state;
  }

  private static parseScalar(raw: string): any {
    if (raw === 'null') return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (!raw) return '';
    if (raw.startsWith('"')) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw.slice(1, -1);
      }
    }
    if (raw.startsWith("'")) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  private static serializeState(state: LockFileState): string {
    const lines = [
      `lock-version: ${state.version}`,
      `path: ${JSON.stringify(state.path)}`,
      'queue:',
    ];
    for (const entry of state.queue) {
      lines.push(`  - id: ${JSON.stringify(entry.id)}`);
      lines.push(`    command: ${JSON.stringify(entry.command)}`);
      lines.push(`    reason: ${JSON.stringify(entry.reason)}`);
      lines.push(`    created-at: ${JSON.stringify(entry.createdAt)}`);
      lines.push(`    locked-at: ${entry.lockedAt ? JSON.stringify(entry.lockedAt) : 'null'}`);
    }
    return `${lines.join('\n')}\n`;
  }

  private static async readState(lockFilePath: string): Promise<LockFileState | null> {
    try {
      const raw = await readFile(lockFilePath, 'utf8');
      return this.parseLockFile(raw, lockFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        Logger.warn(`Failed to read lock file ${lockFilePath}: ${(error as Error).message}`);
      }
      return null;
    }
  }

  private static async writeState(lockFilePath: string, state: LockFileState): Promise<void> {
    if (state.queue.length === 0) {
      await rm(lockFilePath, { force: true });
      return;
    }
    const tempPath = `${lockFilePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, this.serializeState(state), 'utf8');
    await rename(tempPath, lockFilePath);
  }

  private static async obtainMutex(lockFilePath: string): Promise<() => Promise<void>> {
    const mutexPath = `${lockFilePath}${this.MUTEX_SUFFIX}`;
    while (true) {
      try {
        const handle = await open(mutexPath, 'wx');
        return async () => {
          await handle.close();
          await rm(mutexPath, { force: true });
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
        throw error;
      }
    }
  }

  private static async withFileMutex<T>(lockFilePath: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.obtainMutex(lockFilePath);
    try {
      return await fn();
    } finally {
      await release();
    }
  }

  private static async appendEntry(
    lockFilePath: string,
    projectPath: string,
    entry: LockQueueEntry,
  ): Promise<{ position: number; state: LockFileState }> {
    return this.withFileMutex(lockFilePath, async () => {
      let state = await this.readState(lockFilePath);
      if (!state) {
        state = {
          version: this.LOCK_VERSION,
          path: projectPath,
          queue: [],
        };
      } else if (state.path !== projectPath) {
        Logger.warn(`Lock file ${lockFilePath} path mismatch (${state.path} vs ${projectPath})`);
        state.path = projectPath;
      }

      let index = state.queue.findIndex(item => item.id === entry.id);
      if (index === -1) {
        state.queue.push({ ...entry });
        index = state.queue.length - 1;
      } else {
        state.queue[index] = { ...state.queue[index], ...entry };
      }

      const head = state.queue[0];
      if (head && !head.lockedAt) {
        head.lockedAt = new Date().toISOString();
      }

      await this.writeState(lockFilePath, state);
      return { position: index, state };
    });
  }

  private static async waitForTurn(lockFilePath: string, lockId: string): Promise<void> {
    const dir = dirname(lockFilePath);
    const target = basename(lockFilePath);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let watcher: FSWatcher | null = null;
      let safetyTimer: NodeJS.Timeout | null = null;
      const cleanup = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (safetyTimer) {
          clearInterval(safetyTimer);
        }
        if (watcher) {
          watcher.close();
        }
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const check = async () => {
        try {
          const state = await this.readState(lockFilePath);
          if (!state) {
            cleanup(new Error(`Lock file ${lockFilePath} disappeared while waiting`));
            return;
          }
          const idx = state.queue.findIndex(entry => entry.id === lockId);
          if (idx === -1) {
            cleanup(new Error(`Lock entry ${lockId} missing from queue`));
            return;
          }
          if (idx === 0) {
            cleanup();
          }
        } catch (error) {
          cleanup(error as Error);
        }
      };

      watcher = watch(dir, { persistent: true, encoding: 'utf8' }, (_eventType, filename) => {
        if (!filename) return;
        const name = filename;
        if (name === target || name === `${target}${this.MUTEX_SUFFIX}`) {
          check();
        }
      });

      safetyTimer = setInterval(() => check(), 10000);

      watcher.on('error', err => cleanup(err as Error));

      check().catch(error => cleanup(error as Error));
    });
  }

  public static async acquireLock(projectPath: string, reason: string, commandName: string): Promise<LockAcquisition> {
    const lockFilePath = await this.getLockFilePath(projectPath);
    const entry: LockQueueEntry = {
      id: randomUUID(),
      reason,
      command: commandName,
      createdAt: new Date().toISOString(),
      lockedAt: null,
    };

    let blockedBy: BlockedLockInfo | undefined;
    let waitStart: number | null = null;

    while (true) {
      const { position, state } = await this.appendEntry(lockFilePath, projectPath, entry);
      if (position === 0) {
        const snapshot = this.buildSnapshot(lockFilePath, state, 0);
        let finalBlocked: BlockedLockInfo | undefined;
        if (blockedBy && waitStart) {
          finalBlocked = { ...blockedBy, waitedMs: Date.now() - waitStart };
        } else if (blockedBy) {
          finalBlocked = blockedBy;
        }

        const footerContext: FooterContext = {
          projectPath,
          lock: snapshot,
          commandName,
        };
        if (finalBlocked) {
          footerContext.blockedBy = finalBlocked;
        }
        const footerText = this.buildFooterText(footerContext);
        const acquisition: LockAcquisition = {
          lock: snapshot,
          footerText,
        };
        if (finalBlocked) {
          acquisition.blockedBy = finalBlocked;
        }
        return acquisition;
      }

      if (!blockedBy) {
        if (state.queue.length === 0) {
          continue;
        }
        const headSnapshot = this.buildSnapshot(lockFilePath, state, 0);
        blockedBy = {
          ...headSnapshot,
          waitedMs: 0,
        };
        waitStart = Date.now();
        Logger.info(
          `Queueing for lock on ${projectPath}. Current owner "${blockedBy.reason}" (lock ${blockedBy.lockId}) has priority.`,
        );
      }

      await this.waitForTurn(lockFilePath, entry.id);
    }
  }

  private static buildFooterText(context: FooterContext): string {
    const { projectPath, lock, blockedBy, commandName } = context;
    const title =
      commandName === 'xcode_build_and_run'
        ? '🔐 Exclusive Build & Run Lock'
        : '🔐 Exclusive Build Lock';

    const lines = [
      title,
      `  • Project: ${projectPath}`,
      `  • Reason: ${lock.reason}`,
      `  • Command: ${commandName}`,
      `  • Queue depth: ${lock.queueDepth} (${lock.queueDepth === 1 ? 'no additional workers' : `${lock.queueDepth - 1} waiting`})`,
      `  • Lock ID: ${lock.lockId}`,
      `  • Locked at: ${lock.lockedAt}`,
      `  • Release via MCP: ${this.buildToolReleaseCommand(projectPath)}`,
      `  • Release via CLI: ${this.buildCliReleaseCommand(projectPath)}`,
      '  • Release immediately if you are only reviewing logs or build artifacts—idle locks block other workers.',
      'Release this lock after you finish inspecting logs or simulator state so other workers can continue.',
    ];

    if (blockedBy && blockedBy.waitedMs > 0) {
      const blockerReason = blockedBy.reason || 'unspecified work';
      lines.push(
        `⏳ Waited ${this.formatDuration(blockedBy.waitedMs)} for lock held by "${blockerReason}" (locked ${blockedBy.lockedAt}).`,
      );
    }

    return lines.join('\n');
  }

  private static formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`.trim();
    }
    return `${minutes}m ${remainingSeconds}s`.trim();
  }

  public static buildToolReleaseCommand(projectPath: string): string {
    return `xcode_release_lock({ \"xcodeproj\": ${JSON.stringify(projectPath)} })`;
  }

  public static buildCliReleaseCommand(projectPath: string): string {
    return `xcodecontrol release-lock --xcodeproj \"${projectPath}\"`;
  }

  public static appendFooter(message: string, footerText?: string | null): string {
    if (!footerText) {
      return message;
    }
    if (message.includes(footerText)) {
      return message;
    }
    return `${message}\n\n${footerText}`;
  }

  public static async releaseLock(projectPath: string): Promise<ReleaseResult> {
    const lockFilePath = await this.getLockFilePath(projectPath);
    if (!(await this.fileExists(lockFilePath))) {
      return { released: false, info: null };
    }

    return this.withFileMutex(lockFilePath, async () => {
      const state = await this.readState(lockFilePath);
      if (!state || state.queue.length === 0) {
        await rm(lockFilePath, { force: true });
        return { released: false, info: null };
      }

      const originalDepth = state.queue.length;
      const releasedEntry = state.queue.shift()!;
      const info = this.toSnapshot(lockFilePath, releasedEntry, 0, originalDepth, state.path);

      if (state.queue.length === 0) {
        await rm(lockFilePath, { force: true });
        return { released: true, info };
      }

      const nextLock = state.queue[0];
      if (nextLock) {
        nextLock.lockedAt = new Date().toISOString();
        await this.writeState(lockFilePath, state);
      } else {
        await rm(lockFilePath, { force: true });
      }
      return { released: true, info };
    });
  }

  public static async listLocks(): Promise<LockFileData[]> {
    const lockDir = await this.ensureLockDir();
    let entries: string[] = [];
    try {
      entries = await readdir(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const details: LockFileData[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.yaml')) {
        continue;
      }
      const filePath = join(lockDir, entry);
      const state = await this.readState(filePath);
      if (!state || state.queue.length === 0) {
        continue;
      }
      details.push(this.buildSnapshot(filePath, state, 0));
    }
    return details;
  }

  public static async releaseAllLocks(): Promise<ReleaseAllResult> {
    const lockDir = await this.ensureLockDir();
    let entries: string[] = [];
    try {
      entries = await readdir(lockDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { released: 0, details: [] };
      }
      throw error;
    }

    const details: LockFileData[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.yaml')) {
        continue;
      }
      const filePath = join(lockDir, entry);
      const state = await this.readState(filePath);
      if (state && state.queue.length > 0) {
        details.push(this.buildSnapshot(filePath, state, 0));
      }
      await rm(filePath, { force: true });
      await rm(`${filePath}${this.MUTEX_SUFFIX}`, { force: true }).catch(() => {});
    }

    if (details.length > 0) {
      Logger.warn(`Force released ${details.length} lock(s) via CLI emergency command.`);
    }

    return { released: details.length, details };
  }
}
