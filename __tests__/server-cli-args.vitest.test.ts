import { beforeAll, describe, expect, it } from 'vitest';

let findUnsupportedServerArgs: (args: string[]) => string[];

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  ({ findUnsupportedServerArgs } = await import('../src/index.js'));
});

describe('xcodemcp CLI argument validation', () => {
  it('allows supported flags and prefixes', () => {
    const args = [
      '--no-clean',
      '--preferred-scheme=ManabiReader',
      '--preferred-xcodeproj=/tmp/ManabiReader.xcodeproj',
      '--port=8080'
    ];

    expect(findUnsupportedServerArgs(args)).toEqual([]);
  });

  it('flags positional commands as unsupported', () => {
    const args = ['build', 'test'];
    expect(findUnsupportedServerArgs(args)).toEqual(args);
  });

  it('flags a mix of unsupported and supported args', () => {
    const args = ['--no-clean', '--preferred-scheme=Foo', 'build'];
    expect(findUnsupportedServerArgs(args)).toEqual(['build']);
  });
});
