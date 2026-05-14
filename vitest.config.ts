import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/__tests__/**/*.test.ts'],
    globalSetup: ['./scripts/generate-fixtures.ts'],
  },
  resolve: {
    alias: {
      src: resolve(__dirname, 'src'),
    },
  },
});
