import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XcodeServer } from '../src/XcodeServer.js';
import { SimulatorTools } from '../src/tools/SimulatorTools.js';
import { SimulatorUiTools, resetAxeCacheForTesting } from '../src/tools/SimulatorUiTools.js';
import * as fsPromises from 'fs/promises';

describe('Simulator tool integration', () => {
  let server: XcodeServer;

  beforeEach(() => {
    server = new XcodeServer();
    vi.spyOn(server, 'validateToolOperation').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns validation error when boot_sim is missing simulator_uuid', async () => {
    const result = await server.callToolDirect('xcode_boot_sim', {});
    const text = result.content?.[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('simulator_uuid');
    expect(result.isError ?? false).toBeFalsy();
  });

  it('delegates boot_sim to SimulatorTools', async () => {
    const mockResult = { content: [{ type: 'text', text: 'booted' }] } as const;
    vi.spyOn(SimulatorTools, 'bootSimulator').mockResolvedValue(mockResult as any);
    const result = await server.callToolDirect('xcode_boot_sim', { simulator_uuid: 'ABCDE' });
    expect(SimulatorTools.bootSimulator).toHaveBeenCalledWith('ABCDE');
    expect(result.content?.[0]?.type).toBe('text');
    expect(result.content?.[0]?.text).toBe('booted');
  });

  it('surfaces helpful message when AXe is unavailable', async () => {
    const originalAxePath = process.env.XCODEMCP_AXE_PATH;
    const originalPathEnv = process.env.PATH;
    process.env.XCODEMCP_AXE_PATH = '/nonexistent/axe';
    process.env.PATH = '';
    resetAxeCacheForTesting();
    const accessSpy = vi.spyOn(fsPromises, 'access').mockRejectedValue(new Error('ENOENT'));
    const response = await SimulatorUiTools.describeUI('00000000-0000-0000-0000-000000000000');
    const text = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
    expect(text).toContain('AXe binary');
    accessSpy.mockRestore();
    process.env.XCODEMCP_AXE_PATH = originalAxePath;
    process.env.PATH = originalPathEnv;
    resetAxeCacheForTesting();
  });
});
