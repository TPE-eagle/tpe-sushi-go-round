import { defineConfig, devices } from '@playwright/test'

// Production environment test configuration — deployment smoke only, no data assertions
export default defineConfig({
  testDir: './e2e',
  testMatch: 'production.spec.js',
  timeout: 15000,
  retries: 1,
  workers: 2,
  reporter: [['html', { open: 'never' }], ['list']], // no reporter configured previously meant playwright-report/ was never created, even though the CI upload step already targets that path (#74)
  use: {
    headless: true,
    baseURL: 'https://tpe-eagle.github.io/tpe-sushi-go-round/',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry', // retries: 1 is already configured above, so this is free on green runs
    extraHTTPHeaders: {
      'DNT': '1' // Do Not Track header
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        contextOptions: {
          permissions: [],
          bypassCSP: false
        }
      },
    },
    {
      name: 'mobile-chrome',
      use: { 
        ...devices['Pixel 5'],
        contextOptions: {
          permissions: [],
          bypassCSP: false
        }
      },
    },
    {
      name: 'mobile-safari',
      use: { 
        ...devices['iPhone 12'],
        contextOptions: {
          permissions: [],
          bypassCSP: false
        }
      },
    },
  ],
})