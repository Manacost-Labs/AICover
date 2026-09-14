import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'server/**/*.test.js'],
    exclude: ['server/bria-rmbg.test.js'],
    globals: false,
  },
});
