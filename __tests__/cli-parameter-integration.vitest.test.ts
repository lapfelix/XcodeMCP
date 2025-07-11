import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(require('child_process').exec);

describe('CLI Parameter Integration', () => {
  it('should accept --xcresult-path parameter for xcresult-browse command', async () => {
    // This is an integration test that runs the actual CLI
    // We'll test with an invalid path to avoid needing real xcresult files
    const result = await execAsync('npm run build && node dist/cli.js xcresult-browse --xcresult-path /fake/path.xcresult', {
      cwd: process.cwd(),
      timeout: 10000
    }).catch(err => err);

    // Should fail with a file not found error, not a parameter missing error
    expect(result.stderr).not.toContain('Missing required parameter: xcresult_path');
    expect(result.stderr).toContain('XCResult file not found'); // File not found error
  }, 15000);

  it('should accept --test-id parameter for xcresult-browse command', async () => {
    const result = await execAsync('npm run build && node dist/cli.js xcresult-browse --xcresult-path /fake/path.xcresult --test-id "SomeTest"', {
      cwd: process.cwd(),
      timeout: 10000
    }).catch(err => err);

    // Should fail with file not found, not missing test-id parameter
    expect(result.stderr).not.toContain('Missing required parameter: test_id');
    expect(result.stderr).toContain('XCResult file not found');
  }, 15000);

  it('should accept --include-console boolean flag', async () => {
    const result = await execAsync('npm run build && node dist/cli.js xcresult-browse --xcresult-path /fake/path.xcresult --include-console', {
      cwd: process.cwd(), 
      timeout: 10000
    }).catch(err => err);

    // Should not complain about include-console parameter
    expect(result.stderr).not.toContain('Missing required parameter: include_console');
    expect(result.stderr).toContain('XCResult file not found');
  }, 15000);

  it('should reject old underscore parameter names', async () => {
    const result = await execAsync('npm run build && node dist/cli.js xcresult-browse --xcresult_path /fake/path.xcresult', {
      cwd: process.cwd(),
      timeout: 10000
    }).catch(err => err);

    // Should fail with unknown option error, not missing parameter
    expect(result.stderr).toContain('unknown option');
    expect(result.stderr).toContain('--xcresult_path');
    expect(result.stderr).toContain('Did you mean --xcresult-path?');
  }, 15000);

  it('should show help with correct parameter names', async () => {
    const result = await execAsync('npm run build && node dist/cli.js xcresult-browse --help', {
      cwd: process.cwd(),
      timeout: 10000
    });

    // Should show dash-separated parameter names in help
    expect(result.stdout).toContain('--xcresult-path');
    expect(result.stdout).toContain('--test-id');
    expect(result.stdout).toContain('--include-console');
    
    // Should not show underscore versions
    expect(result.stdout).not.toContain('--xcresult_path');
    expect(result.stdout).not.toContain('--test_id');
    expect(result.stdout).not.toContain('--include_console');
  }, 15000);
});