import { describe, it, expect } from 'vitest';
import { promisify } from 'util';

const execAsync = promisify(require('child_process').exec);

describe('CLI Parameter Consistency', () => {
  it('should accept new kebab-case parameters for all affected commands', async () => {
    const commands = [
      {
        command: 'open-file --file-path /fake/file.swift --line-number 10',
        expectedError: 'File does not exist', // File not found, but parameters accepted
      },
      {
        command: 'set-active-scheme --xcodeproj /fake/project.xcodeproj --scheme-name TestScheme',
        expectedError: 'Project file does not exist', // Project not found, but parameters accepted
      },
      {
        command: 'test --xcodeproj /fake/project.xcodeproj --command-line-arguments arg1,arg2',
        expectedError: 'Project file does not exist', // Project not found, but parameters accepted
      },
      {
        command: 'run --xcodeproj /fake/project.xcodeproj --scheme TestScheme --command-line-arguments arg1',
        expectedError: 'Project file does not exist', // Project not found, but parameters accepted
      },
      {
        command: 'debug --xcodeproj /fake/project.xcodeproj --scheme TestScheme --skip-building',
        expectedError: 'Project file does not exist', // Project not found, but parameters accepted
      },
    ];

    for (const { command, expectedError } of commands) {
      const result = await execAsync(`npm run build && node dist/cli.js ${command}`, {
        cwd: process.cwd(),
        timeout: 10000
      }).catch(err => err);

      // Should not complain about unknown options or missing required parameters
      expect(result.stderr).not.toContain('unknown option');
      expect(result.stderr).not.toContain('Missing required parameter');
      
      // Should fail with expected error (file/project not found)
      expect(result.stderr).toContain(expectedError);
    }
  }, 60000);

  it('should reject old camelCase parameters', async () => {
    const commands = [
      'open-file --filePath /fake/file.swift',
      'open-file --lineNumber 10',
      'set-active-scheme --schemeName TestScheme',
      'test --commandLineArguments arg1',
      'debug --skipBuilding',
    ];

    for (const command of commands) {
      const result = await execAsync(`npm run build && node dist/cli.js ${command}`, {
        cwd: process.cwd(),
        timeout: 10000
      }).catch(err => err);

      // Should show unknown option error
      expect(result.stderr).toContain('unknown option');
    }
  }, 60000);

  it('should show correct parameter names in help text', async () => {
    const commands = [
      { command: 'open-file --help', expected: ['--file-path', '--line-number'] },
      { command: 'set-active-scheme --help', expected: ['--scheme-name'] },
      { command: 'test --help', expected: ['--command-line-arguments'] },
      { command: 'run --help', expected: ['--command-line-arguments'] },
      { command: 'debug --help', expected: ['--skip-building'] },
      { command: 'xcresult-get-ui-element --help', expected: ['--hierarchy-json-path', '--element-index'] },
      { command: 'xcresult-export-attachment --help', expected: ['--attachment-index'] },
    ];

    for (const { command, expected } of commands) {
      const result = await execAsync(`npm run build && node dist/cli.js ${command}`, {
        cwd: process.cwd(),
        timeout: 10000
      });

      for (const param of expected) {
        expect(result.stdout).toContain(param);
      }

      // Should not contain old camelCase versions
      const oldParams = expected.map(p => p.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
      for (const oldParam of oldParams) {
        expect(result.stdout).not.toContain(oldParam);
      }
    }
  }, 60000);

  it('should reference CLI command names in help text and usage instructions', async () => {
    // Test that help text references use CLI command names, not internal tool names
    const result1 = await execAsync('npm run build && node dist/cli.js xcresult-get-ui-element --help', {
      cwd: process.cwd(),
      timeout: 10000
    });
    
    expect(result1.stdout).toContain('xcresult-get-ui-hierarchy');
    expect(result1.stdout).not.toContain('xcresult_get_ui_hierarchy');

    const result2 = await execAsync('npm run build && node dist/cli.js xcresult-export-attachment --help', {
      cwd: process.cwd(),
      timeout: 10000
    });
    
    expect(result2.stdout).toContain('xcresult-list-attachments');
    expect(result2.stdout).not.toContain('xcresult_list_attachments');

    // Test find-xcresults usage instructions with a real project
    const result3 = await execAsync('npm run build && node dist/cli.js find-xcresults --xcodeproj __tests__/TestApp/TestApp.xcodeproj', {
      cwd: process.cwd(),
      timeout: 10000
    });
    
    // Should contain either usage instructions (if files found) or helpful error message (if no files)
    const hasUsageInstructions = result3.stdout.includes('xcresult-browse --xcresult-path');
    const hasNoFilesMessage = result3.stdout.includes('No XCResult files found');
    
    expect(hasUsageInstructions || hasNoFilesMessage).toBe(true);
    
    // If there are usage instructions, verify they use kebab-case
    if (hasUsageInstructions) {
      expect(result3.stdout).toContain('xcresult-browser-get-console --xcresult-path');
      expect(result3.stdout).not.toContain('xcresult_browse');
      expect(result3.stdout).not.toContain('xcresult_browser_get_console');
    }
  }, 30000);
});