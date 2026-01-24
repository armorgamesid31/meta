import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    hookTimeout: 30000, // Increase hook timeout for beforeAll/afterAll
    testTimeout: 10000, // Increase test timeout for individual tests
  },
});