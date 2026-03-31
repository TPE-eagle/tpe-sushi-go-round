import { defineConfig, devices } from '@playwright/test'

// Production environment test configuration - tests actual deployed website
export default defineConfig({
  testDir: './e2e',
  testMatch: 'production.spec.js',
  timeout: 15000, // Reduced timeout for faster execution
  retries: 1, // Reduced retries for faster execution
  workers: 2, // Limit workers like local CI config
  use: {
    headless: true, // Always headless for production tests
    baseURL: 'https://tpe-eagle.github.io/tpe-sushi-go-round/',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Block Google Analytics and tracking scripts
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
  // Production tests don't need local server
})