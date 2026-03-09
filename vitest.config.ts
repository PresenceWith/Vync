import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@vync/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
  test: {
    // CLI tests share ~/.vync/server.pid — must not run in parallel
    fileParallelism: false,
  },
});
