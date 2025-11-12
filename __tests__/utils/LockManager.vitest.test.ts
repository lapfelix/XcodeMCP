import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { rm } from 'fs/promises';
import LockManager from '../../src/utils/LockManager.js';

describe('LockManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xcodemcp-locks-'));
    LockManager.setCustomLockDirectory(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    LockManager.setCustomLockDirectory(null);
  });

  it('acquires and releases a lock with metadata', async () => {
    const projectPath = '/tmp/FakeApp.xcodeproj';
    const acquisition = await LockManager.acquireLock(projectPath, 'LockManager test', 'xcode_build');
    expect(acquisition.lock.path).toBe(projectPath);
    expect(acquisition.lock.reason).toBe('LockManager test');
    expect(acquisition.lock.queueDepth).toBe(1);
    expect(acquisition.footerText).toContain('release-lock');

    const release = await LockManager.releaseLock(projectPath);
    expect(release.released).toBe(true);
    expect(release.info?.reason).toBe('LockManager test');
  });

  it('records blocker info when waiting for an existing lock', async () => {
    const projectPath = '/tmp/FakeAppWait.xcodeproj';
    await LockManager.acquireLock(projectPath, 'First worker', 'xcode_build');

    const waitingPromise = LockManager.acquireLock(projectPath, 'Second worker', 'xcode_build');

    await new Promise(resolve => setTimeout(resolve, 50));
    await LockManager.releaseLock(projectPath);

    const secondLock = await waitingPromise;
    expect(secondLock.blockedBy?.reason).toBe('First worker');
    expect(secondLock.footerText).toContain('Waited');

    await LockManager.releaseLock(projectPath);
  });
});
