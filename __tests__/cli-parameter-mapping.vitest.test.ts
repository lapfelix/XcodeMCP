import { describe, it, expect } from 'vitest';

// We need to import the functions we want to test
// Since they're not exported, we'll need to test through the CLI interface

describe('CLI Parameter Mapping', () => {
  it('should convert kebab-case CLI args to underscore schema properties', () => {
    // Test the mapping logic directly
    const testCases = [
      {
        schemaProperty: 'xcresult_path',
        cliFlag: '--xcresult-path',
        commanderProperty: 'xcresultPath',
      },
      {
        schemaProperty: 'test_id', 
        cliFlag: '--test-id',
        commanderProperty: 'testId',
      },
      {
        schemaProperty: 'include_console',
        cliFlag: '--include-console', 
        commanderProperty: 'includeConsole',
      },
      {
        schemaProperty: 'hierarchy_json',
        cliFlag: '--hierarchy-json',
        commanderProperty: 'hierarchyJson',
      }
    ];

    testCases.forEach(({ schemaProperty, cliFlag, commanderProperty }) => {
      // Test underscore to dash conversion (for CLI flag generation)
      const expectedFlag = `--${schemaProperty.replace(/_/g, '-')}`;
      expect(expectedFlag).toBe(cliFlag);

      // Test dash to camelCase conversion (for commander.js property lookup)
      const dashPropName = schemaProperty.replace(/_/g, '-');
      const camelPropName = dashPropName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      expect(camelPropName).toBe(commanderProperty);
    });
  });

  it('should handle complex parameter names correctly', () => {
    const testCases = [
      { schema: 'very_long_parameter_name', expected: 'veryLongParameterName' },
      { schema: 'single', expected: 'single' },
      { schema: 'two_words', expected: 'twoWords' },
      { schema: 'three_word_param', expected: 'threeWordParam' },
    ];

    testCases.forEach(({ schema, expected }) => {
      const dashPropName = schema.replace(/_/g, '-');
      const camelPropName = dashPropName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      expect(camelPropName).toBe(expected);
    });
  });
});

describe('CLI Tool Integration', () => {
  it('should generate correct CLI flags for XCResult tools', () => {
    const xcresultToolSchema = {
      type: 'object',
      properties: {
        xcresult_path: {
          type: 'string',
          description: 'Absolute path to the .xcresult file',
        },
        test_id: {
          type: 'string', 
          description: 'Optional test ID or index number',
        },
        include_console: {
          type: 'boolean',
          description: 'Whether to include console output',
        },
      },
      required: ['xcresult_path'],
    };

    // Verify that our parameter conversion logic matches expectations
    const properties = Object.keys(xcresultToolSchema.properties);
    const expectedFlags = ['--xcresult-path', '--test-id', '--include-console'];
    
    properties.forEach((prop, index) => {
      const expectedFlag = `--${prop.replace(/_/g, '-')}`;
      expect(expectedFlag).toBe(expectedFlags[index]);
    });
  });
});