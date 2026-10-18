import { defineConfig, devices } from '@playwright/test'
import { HARNESS_PORT } from './vite.config'

// Runs browser/smoke.spec.ts in headless Chromium (no GPU needed) against:
//   default            the production build (`pnpm harness:build` → dist/) via
//                      `vite preview` — what a consumer's built app ships
//   HARNESS_SERVER=dev the Vite dev server (consumer dev mode, no build step)
const server = process.env.HARNESS_SERVER === 'dev' ? 'pnpm exec vite' : 'pnpm exec vite preview'

export default defineConfig({
  testDir: './browser',
  testMatch: '*.spec.ts',
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${HARNESS_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: server,
    url: `http://localhost:${HARNESS_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
