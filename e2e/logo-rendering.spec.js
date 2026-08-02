import { test, expect } from '@playwright/test'
import { setupMockApiRoute, waitForApiAndTable, blockGoogleAnalytics } from './test-helpers.js'

// issue #69 / PR #93 review: the unit tests only exercise hasVendoredLogo()
// (an Array.includes() over a literal) — nothing anywhere checked that a
// vendored logo's `src` actually resolves under the app's real base path.
// A bad BASE_URL join, a case-mismatched filename, or a CSP miss would all
// ship green without this: the mock in test-helpers.js already emits all
// five vendored codes (BR/CI/JX/B7/AE), and vite.config.js sets
// base: '/tpe-sushi-go-round/' unconditionally, so import.meta.env.BASE_URL
// under `npm run dev` is the same string used in production.
// Table HTML is inserted synchronously via innerHTML, but image bytes load
// asynchronously — checking naturalWidth right after the table selector
// appears races the load. expect.poll retries until the image finishes
// (or the CSP/path is actually broken and it never does).
async function assertImageLoaded(img) {
  await expect.poll(() => img.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true)
}

test.describe('Vendored logo rendering', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
    await setupMockApiRoute(page)
  })

  test('every table row logo actually loads (not just renders an <img> tag)', async ({ page }) => {
    await page.goto('/')
    await waitForApiAndTable(page)

    const logos = page.locator('#output table tbody td:first-child img')
    expect(await logos.count()).toBeGreaterThan(0)

    for (const img of await logos.all()) {
      await assertImageLoaded(img)
    }
  })

  test('every airline filter button logo actually loads', async ({ page }) => {
    await page.goto('/')
    await waitForApiAndTable(page)

    const logos = page.locator('.airline-link img')
    expect(await logos.count()).toBeGreaterThan(0)

    for (const img of await logos.all()) {
      await assertImageLoaded(img)
    }
  })
})
