import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for pure modules (e.g. the CWL allocation engine). No DOM needed.
// The '@' alias mirrors tsconfig paths so `@/types/...` resolves under Vitest.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
