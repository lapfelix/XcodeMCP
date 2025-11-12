import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

const spawnMock = vi.hoisted(() => vi.fn()) as ReturnType<typeof vi.fn>;

vi.mock('child_process', () => ({
  spawn: spawnMock,
  execFile: vi.fn((...args: any[]) => {
    const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    if (callback) {
      callback(null, '', '');
    }
    return { pid: 123 };
  }),
}));

import { BuildLogParser } from '../../src/utils/BuildLogParser.js';

class MockChildProcess extends EventEmitter {
  public stdout: EventEmitter;
  public stderr: EventEmitter;
  public killed = false;

  constructor(private readonly stdoutData: string, private readonly stderrData = '', private readonly exitCode = 0) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.scheduleEmit();
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  private scheduleEmit(): void {
    setImmediate(() => {
      if (this.stdoutData) {
        this.stdout.emit('data', Buffer.from(this.stdoutData));
      }
      if (this.stderrData) {
        this.stderr.emit('data', Buffer.from(this.stderrData));
      }
      this.emit('close', this.exitCode);
    });
  }
}

describe('BuildLogParser.parseBuildLog', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('recovers errors from JSON reporter when issues reporter misses them', async () => {
    spawnMock.mockImplementation((_command: string, args: string[]) => {
      const reporterIndex = args.indexOf('--reporter');
      const reporter = reporterIndex >= 0 ? args[reporterIndex + 1] : 'issues';

      if (reporter === 'summaryJson') {
        return new MockChildProcess(JSON.stringify({
          buildStatus: 'failed',
          errorCount: 0,
          warnings: [],
          errors: [],
          notes: []
        }));
      }

      if (reporter === 'json') {
        return new MockChildProcess(JSON.stringify({
          errorCount: 1,
          warningCount: 0,
          errors: [],
          warnings: [],
          notes: [],
          subSteps: [
            {
              errorCount: 1,
              warningCount: 0,
              errors: [],
              warnings: [],
              notes: [
                {
                  title: "Type 'Void' cannot conform to 'View'",
                  documentURL: 'file:///path/to/TextsList.swift',
                  startingLineNumber: 235,
                  startingColumnNumber: 18,
                  detail: "/path/to/TextsList.swift:235:18: error: type 'Void' cannot conform to 'View'",
                  severity: 2,
                  type: 'swiftError'
                }
              ],
              subSteps: []
            }
          ]
        }));
      }

      return new MockChildProcess(JSON.stringify({
        errors: [],
        warnings: []
      }));
    });

    const result = await BuildLogParser.parseBuildLog('/mock/path/to/log.xcactivitylog');

    expect(spawnMock).toHaveBeenCalledTimes(3);
    expect(result.buildStatus).toBe('failed');
    expect(result.errorCount).toBe(1);
    expect(result.errors).not.toHaveLength(0);
    expect(result.errors[0]).toContain("TextsList.swift:235");
    expect(result.errors[0]).toContain("Type 'Void' cannot conform to 'View'");
  });
});
