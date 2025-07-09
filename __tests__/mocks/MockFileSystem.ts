import { vi } from 'vitest';

export interface MockFileSystem {
  createMockProject(path: string, name: string, type: string, schemes: string[]): void;
  reset(): void;
}

export function mockFileSystem(): MockFileSystem {
  return {
    createMockProject: vi.fn(),
    reset: vi.fn()
  };
}