import { describe, it, expect } from 'vitest';
import { BuildTools } from '../../src/tools/BuildTools.js';

describe('BuildTools private helpers', () => {
  describe('_detectSimulatorCloneFailure', () => {
    it('detects simulator clone failures and returns device name', () => {
      const output = "Test target ManabiReaderTests encountered an error (Failed to clone device named 'iPhone 16e (26.0)'. (Underlying Error: The operation couldn’t be completed. Device was allocated but was stuck in creation state.  Check CoreSimulator.log for more information.))";
      const result = (BuildTools as any)._detectSimulatorCloneFailure(output);
      expect(result).toEqual({ matched: true, deviceName: 'iPhone 16e (26.0)' });
    });

    it('returns matched=false when message is absent', () => {
      const result = (BuildTools as any)._detectSimulatorCloneFailure('All tests passed.');
      expect(result).toEqual({ matched: false });
    });
  });

  describe('_hasArgument', () => {
    it('detects arguments provided as separate tokens', () => {
      const args = ['-parallel-testing-enabled', 'NO', '-only-testing:Target/Test'];
      expect((BuildTools as any)._hasArgument(args, '-parallel-testing-enabled')).toBe(true);
      expect((BuildTools as any)._hasArgument(args, '-maximum-concurrent-test-simulator-destinations')).toBe(false);
    });

    it('detects arguments provided as single token with value', () => {
      const args = ['-maximum-concurrent-test-simulator-destinations 2'];
      expect((BuildTools as any)._hasArgument(args, '-maximum-concurrent-test-simulator-destinations')).toBe(true);
    });
  });
});
