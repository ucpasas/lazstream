import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts so the lib build (dts plugin, publicDir) stays out of tests.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
})
