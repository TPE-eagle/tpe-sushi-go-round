import { defineConfig, devices } from '@playwright/test'

// Canary config — only runs canary.spec.js, no browser needed (uses request fixture).
// See e2e/canary.spec.js for IP / CI notes before wiring to a scheduled CI job.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'canary.spec.js',
  timeout: 30000,
  retries: 1,
  use: {
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
