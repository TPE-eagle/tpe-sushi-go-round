import os from 'os'
import { defineConfig, devices } from '@playwright/test'

// Local development test configuration
export default defineConfig({
  testDir: './e2e',
  timeout: 10000, // Reduced timeout for local testing
  retries: 1,
  // production.spec.js is mock-based (setupMockApiRoute in beforeEach), so it
  // runs deterministically against the local dev server — it belongs in the
  // merge-gate, not skipped. (Was grepInvert'd out; see PR #12 review.)
  // Use all CPU cores locally for maximum parallelism; use 2 workers in CI for stable runs
  workers: process.env.CI ? 2 : os.cpus().length,
  use: {
    headless: process.env.CI ? true : false, // Headless in CI, headed locally
    baseURL: 'http://localhost:8080/tpe-sushi-go-round/',  // trailing slash: production.spec.js uses page.goto('') which resolves to baseURL — vite dev only serves the app at the base *with* the slash (prod config already has it)
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: true,
  },
})