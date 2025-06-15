import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    setupFiles: ['./test-setup.js'],
    include: ['__tests__/**/*.vitest.test.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '__tests__/',
        'test-setup.js',
        'vitest.config.js',
        'dist/'
      ]
    }
  },
  esbuild: {
    target: 'es2022'
  }
});