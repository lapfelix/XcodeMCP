import { vi } from 'vitest';

// Suppress console.error during tests
const originalConsoleError = console.error;
console.error = vi.fn();

// Mock file system operations that might not be available in test environment
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true), // Default to file exists
  };
});

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    stat: vi.fn().mockResolvedValue({ size: 1000, mtime: new Date() }),
  };
});

// Clean up after tests
afterAll(() => {
  console.error = originalConsoleError;
});