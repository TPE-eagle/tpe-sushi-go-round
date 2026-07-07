import { defineConfig, devices } from '@playwright/test'

// Production environment test configuration — deployment smoke only, no data assertions
export default defineConfig({
  testDir: './e2e',
  testMatch: 'production.spec.js',
  timeout: 15000,
  retries: 1,
  workers: 2,
  use: {
    headless: true,
    baseURL: 'https://tpe-eagle.github.io/tpe-sushi-go-round/',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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