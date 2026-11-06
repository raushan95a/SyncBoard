import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (docs/08). One worker: the tests share one server, and one of them restarts it.
 * The web server builds the client and serves it from the API's origin (production shape).
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4100',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run build -w client && node e2e/server.js',
    url: 'http://localhost:4100/api/healthz',
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'pipe',
  },
});
