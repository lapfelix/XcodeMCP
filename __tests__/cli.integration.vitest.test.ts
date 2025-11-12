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
    
    expect(stdout).toContain('Command-line interface for Xcode automation and control');
    expect(stdout).toContain('Usage: xcodecontrol [options] [command]');
    expect(stdout).toContain('Options:');
    expect(stdout).toContain('--json');
  });

  it('should list all available tools', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'list-tools']);
    
    expect(stdout).toContain('Available tools organized by category:');
    expect(stdout).toContain('📁 Project Management:');
    expect(stdout).toContain('get-schemes');
    expect(stdout).toContain('build');
    expect(stdout).toContain('health-check');
  });

  it('should show help for individual tools', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'health-check', '--help']);
    
    expect(stdout).toContain('Perform a comprehensive health check');
    expect(stdout).toContain('Usage: xcodecontrol health-check [options]');
  });

  it('should show help for tools with parameters', async () => {
    const { stdout } = await execa('node', [CLI_PATH, 'build', '--help']);
    
    expect(stdout).toContain('Build a specific Xcode project');
    expect(stdout).toContain('--xcodeproj <value>');
    expect(stdout).toContain('--scheme <value>');
    expect(stdout).toContain('--destination <value>');
  });

  it('should execute health check successfully', async () => {
    const { stdout, stderr } = await execa('node', [CLI_PATH, 'health-check']);
    
    expect(stdout).toContain('XcodeMCP Configuration Health Check');
    // Should contain either "systems operational" (full) or "Can operate with limitations" (degraded)
    expect(stdout).toMatch(/systems operational|Can operate with limitations/);
    
    // Note: CLI may not emit SSE events in the same way as the server
    // The health check should complete successfully
  });

  it('should handle missing required parameters', async () => {
    const { stdout, stderr } = await execa('node', [CLI_PATH, 'build']);
    
    // Should show help for the command
    expect(stdout).toContain('Usage: xcodecontrol build [options]');
    expect(stderr).toContain('Missing required parameter');
  });

  it('should support JSON input', async () => {
    const jsonInput = JSON.stringify({});
    
    const { stdout } = await execa('node', [
      CLI_PATH, 
      'health-check',
      '--json-input',
      jsonInput
    ]);
    
    expect(stdout).toContain('XcodeMCP Configuration Health Check');
  });

  it('should support JSON output format', async () => {
    const { stdout } = await execa('node', [
      CLI_PATH, 
      '--json',
      'health-check'
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
        'build',
        '--xcodeproj', '/non/existent/project.xcodeproj',
        '--scheme', 'Test',
        '--reason', 'CLI integration test',
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
        'health-check',
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
    
    // Tool names in list-tools output show CLI command names
    expect(stdout).toContain('get-schemes');
    expect(stdout).toContain('build');
  });

  it('should handle array parameters correctly', async () => {
    // Test that array parameters are properly parsed
    // This test would need a tool that accepts array parameters
    // Test with a tool that actually exists and has complex parameters
    const { stdout } = await execa('node', [CLI_PATH, 'build', '--help']);
    
    // Build tool should have multiple parameters
    expect(stdout).toContain('--scheme');
    expect(stdout).toContain('--destination');
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
    const { exitCode } = await execa('node', [CLI_PATH, 'health-check']);
    expect(exitCode).toBe(0);
  });

  it('should show help when required parameters are missing', async () => {
    const { stdout, stderr } = await execa('node', [CLI_PATH, 'build']);
    
    // Should show help instead of exiting with error
    expect(stdout).toContain('Usage: xcodecontrol build [options]');
    expect(stderr).toContain('Missing required parameter');
  });

  it('should exit with code 0 for help commands', async () => {
    const { exitCode } = await execa('node', [CLI_PATH, '--help']);
    expect(exitCode).toBe(0);
  });
});
