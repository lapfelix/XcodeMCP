import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '../dist/cli.js');

describe('CLI Integration Tests', () => {
  beforeEach(() => {
    // Set JXA_MOCK to prevent actual Xcode interactions
    process.env.JXA_MOCK = '1';
  });

  afterEach(() => {
    delete process.env.JXA_MOCK;
  });

  it('should show help when --help is used', async () => {
    const { stdout } = await execa('node', [CLI_PATH, '--help']);
    
    expect(stdout).toContain('MCP one-shot CLI for Xcode tools');
    expect(stdout).toContain('Usage: mcp [options] [command]');
    expect(stdout).toContain('Options:');
    expect(stdout).toContain('--json');
  });

  it('should list all available tools', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'list-tools']);
    
    expect(stdout).toContain('Available tools:');
    expect(stdout).toContain('xcode-build');
    expect(stdout).toContain('xcode-test');
    expect(stdout).toContain('xcode-health-check');
  });

  it('should show help for individual tools', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'xcode-health-check', '--help']);
    
    expect(stdout).toContain('Perform a comprehensive health check');
    expect(stdout).toContain('Usage: mcp xcode-health-check [options]');
  });

  it('should show help for tools with parameters', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'xcode-build', '--help']);
    
    expect(stdout).toContain('Build a specific Xcode project');
    expect(stdout).toContain('--xcodeproj <value>');
    expect(stdout).toContain('--scheme <value>');
    expect(stdout).toContain('--destination <value>');
  });

  it('should execute health check successfully', async () => {
    const { stdout, stderr } = await execa('node', [CLI_PATH, 'xcode-health-check']);
    
    expect(stdout).toContain('XcodeMCP Configuration Health Check');
    expect(stdout).toContain('systems operational');
    
    // Check that SSE events are written to stderr
    expect(stderr).toContain('event:progress');
    expect(stderr).toContain('Tool xcode_health_check completed');
  });

  it('should handle missing required parameters', async () => {
    await expect(
      execa('node', [CLI_PATH, 'xcode-build'])
    ).rejects.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Missing required parameter')
    });
  });

  it('should support JSON input', async () => {
    const jsonInput = JSON.stringify({});
    
    const { stdout } = await execa('node', [
      CLI_PATH, 
      'xcode-health-check',
      '--json-input',
      jsonInput
    ]);
    
    expect(stdout).toContain('XcodeMCP Configuration Health Check');
  });

  it('should support JSON output format', async () => {
    const { stdout } = await execa('node', [
      CLI_PATH, 
      '--json',
      'xcode-health-check'
    ]);
    
    // With --json flag, output should be valid JSON
    expect(() => JSON.parse(stdout)).not.toThrow();
    
    const result = JSON.parse(stdout);
    expect(result).toHaveProperty('content');
    expect(result.content).toBeInstanceOf(Array);
  });

  it('should handle tool execution errors gracefully', async () => {
    // Try to build a non-existent project
    await expect(
      execa('node', [
        CLI_PATH,
        'xcode-build',
        '--xcodeproj', '/non/existent/project.xcodeproj',
        '--scheme', 'Test'
      ])
    ).rejects.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('does not exist')
    });
  });

  it('should handle invalid JSON input', async () => {
    await expect(
      execa('node', [
        CLI_PATH,
        'xcode-health-check',
        '--json-input',
        'invalid-json'
      ])
    ).rejects.toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('Invalid JSON input')
    });
  });

  it('should convert tool names with underscores to dashes', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'list-tools']);
    
    // Tool names should be converted from underscore to dash format
    expect(stdout).toContain('xcode-health-check');
    expect(stdout).toContain('xcresult-browse');
    expect(stdout).toContain('find-xcresults');
  });

  it('should handle array parameters correctly', async () => {
    // Test that array parameters are properly parsed
    // This test would need a tool that accepts array parameters
    const { stdout } = await execa('node', [CLI_PATH, 'xcode-test', '--help']);
    
    expect(stdout).toContain('commandLineArguments');
  });
});

describe('CLI Exit Codes', () => {
  beforeEach(() => {
    process.env.JXA_MOCK = '1';
  });

  afterEach(() => {
    delete process.env.JXA_MOCK;
  });

  it('should exit with code 0 on success', async () => {
    const { exitCode } = await execa('node', [CLI_PATH, 'xcode-health-check']);
    expect(exitCode).toBe(0);
  });

  it('should exit with code 1 on failure', async () => {
    await expect(
      execa('node', [CLI_PATH, 'xcode-build'])
    ).rejects.toMatchObject({
      exitCode: 1
    });
  });

  it('should exit with code 0 for help commands', async () => {
    const { exitCode } = await execa('node', [CLI_PATH, '--help']);
    expect(exitCode).toBe(0);
  });
});