import { test, expect } from '@playwright/test'
import { setupMockApiRoute, waitForApiAndTable, blockGoogleAnalytics } from './test-helpers.js'

test.describe('Offline UX', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
    await setupMockApiRoute(page)
  })

  test('offline banner is hidden when connected', async ({ page }) => {
    await page.goto('/')
    await waitForApiAndTable(page)
    await expect(page.locator('#offline-banner')).toBeHidden()
  })

  test('offline banner surfaces when connectivity drops', async ({ page, context }) => {
    await page.goto('/')
    await waitForApiAndTable(page)

    await context.setOffline(true)
    // The browser fires a synthetic 'offline' event which our listener handles.
    await page.waitForFunction(() => {
      const el = document.getElementById('offline-banner')
      return el && !el.hidden && el.innerText.length > 0
    }, { timeout: 5000 })

    const msg = await page.locator('#offline-banner').innerText()
    expect(msg.length).toBeGreaterThan(0)
  })

  test('offline banner clears when connectivity returns', async ({ page, context }) => {
    await page.goto('/')
    await waitForApiAndTable(page)

    await context.setOffline(true)
    await page.waitForFunction(() => {
      const el = document.getElementById('offline-banner')
      return el && !el.hidden
    }, { timeout: 5000 })

    await context.setOffline(false)
    await expect(page.locator('#offline-banner')).toBeHidden({ timeout: 5000 })
  })
})
