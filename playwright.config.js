// ci-probe #161: whitespace-only probe commit so a zero-diff branch can open a PR.
// Purpose: run the Local E2E suite on pristine main inside the 22:00-24:00 UTC+8
// wall-clock window. Revert after the probe. No functional change.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 15000, // Streamlined timeout
  retries: 2,
  use: {
    headless: true, // Always headless for default config
    baseURL: 'http://localhost:8080/tpe-sushi-go-round',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: !process.env.CI,
  },
})