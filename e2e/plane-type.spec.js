import { test, expect } from '@playwright/test'
import { setupMockApiRoute, waitForApiAndTable, blockGoogleAnalytics, getMockFlightData, getCurrentUTC8Date } from './test-helpers.js'

test.describe('Plane type filter', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
  })

  test('plane type row is hidden until an airline is pinned', async ({ page }) => {
    await setupMockApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    await expect(page.locator('#planeTypeButtons')).toBeEmpty()

    await page.click('[data-airline="BR"]')
    await expect(page.locator('#planeTypeButtons .planetype-link')).not.toHaveCount(0)

    await page.click('[data-airline=""]')
    await expect(page.locator('#planeTypeButtons')).toBeEmpty()
  })

  test('dynamic family list reflects selected airline group', async ({ page }) => {
    await setupMockApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    // Mock: BR group has B777-300 (BR35) and A321-200 (B7681) -> families {A321, B777}
    await page.click('[data-airline="BR"]')
    await expect(page.locator('#planeTypeButtons [data-planetype="A321"]')).toBeVisible()
    await expect(page.locator('#planeTypeButtons [data-planetype="B777"]')).toBeVisible()

    // CI group has A321 (CI123) and A321-271N (AE991) -> family {A321}
    await page.click('[data-airline="CI"]')
    await expect(page.locator('#planeTypeButtons [data-planetype="A321"]')).toBeVisible()
    await expect(page.locator('#planeTypeButtons [data-planetype="B777"]')).toHaveCount(0)
  })

  test('pinning a family narrows the table and persists via cookie', async ({ page }) => {
    await setupMockApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    await page.click('[data-airline="BR"]')
    await page.click('#planeTypeButtons [data-planetype="B777"]')

    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).not.toContainText('B7681')
    await expect(page.locator('[data-planetype="B777"]')).toHaveClass(/active/)

    const cookies = await page.context().cookies()
    expect(cookies.find(c => c.name === 'PlaneType')?.value).toBe('B777')

    await page.reload()
    await waitForApiAndTable(page)
    await expect(page.locator('[data-planetype="B777"]')).toHaveClass(/active/)
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).not.toContainText('B7681')
  })

  test('plane type ALL clears the pin without leaving the airline', async ({ page }) => {
    await setupMockApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    await page.click('[data-airline="BR"]')
    await page.click('#planeTypeButtons [data-planetype="B777"]')
    await expect(page.locator('table')).not.toContainText('B7681')

    await page.click('#planeTypeButtons [data-planetype=""]')
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).toContainText('B7681')

    const cookies = await page.context().cookies()
    expect(cookies.find(c => c.name === 'PlaneType')).toBeUndefined()
  })

  test('switching airline clears the plane type pin', async ({ page }) => {
    await setupMockApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    await page.click('[data-airline="BR"]')
    await page.click('#planeTypeButtons [data-planetype="B777"]')
    await expect(page.locator('[data-planetype="B777"]')).toHaveClass(/active/)

    await page.click('[data-airline="CI"]')
    await expect(page.locator('[data-planetype=""]')).toHaveClass(/active/)

    const cookies = await page.context().cookies()
    expect(cookies.find(c => c.name === 'PlaneType')).toBeUndefined()
  })

  test('TBD flights (empty PlaneNo) remain visible regardless of plane type pin', async ({ page }) => {
    const base = getMockFlightData()
    // Mark a BR flight as TBD so the pilot sees it even when a family is pinned.
    const tbd = base.map(f => f.flightCode === 'B7681' ? { ...f, PlaneNo: '-' } : f)
    await setupMockApiRoute(page, tbd)

    await page.goto('/')
    await waitForApiAndTable(page)

    await page.click('[data-airline="BR"]')
    await page.click('#planeTypeButtons [data-planetype="B777"]')

    await expect(page.locator('table')).toContainText('BR35')
    // TBD flight stays visible even though its family does not match.
    await expect(page.locator('table')).toContainText('B7681')
  })

  test('stale plane type cookie is reconciled silently on load', async ({ page }) => {
    await setupMockApiRoute(page)
    // Pre-seed cookies as if a past session pinned a family that is not flying
    // in the current window. Reconciliation should drop the plane type pin
    // without forcing the user into a broken empty state.
    await page.context().addCookies([
      { name: 'ACode', value: 'BR', domain: 'localhost', path: '/' },
      { name: 'PlaneType', value: 'A350', domain: 'localhost', path: '/' }
    ])

    await page.goto('/')
    await waitForApiAndTable(page)

    // BR flights still show; the airline pin is respected.
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('[data-airline="BR"]')).toHaveClass(/active/)
    // The stale plane type pin was silently cleared.
    await expect(page.locator('[data-planetype=""]')).toHaveClass(/active/)
    const cookies = await page.context().cookies()
    expect(cookies.find(c => c.name === 'PlaneType')).toBeUndefined()
  })

  test('plane type pin survives flight mode toggle even when the family is absent in the new mode', async ({ page }) => {
    // Mock is mode-aware: BR35 is B777 in Arrival but an A321 variant in
    // Departure, so after the toggle the BR group in Departure has no B777.
    // The pin must still survive — we never silently drop user intent on an
    // in-session refresh.
    await setupMockApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    await page.click('[data-airline="BR"]')
    await page.click('#planeTypeButtons [data-planetype="B777"]')
    await expect(page.locator('[data-planetype="B777"]')).toHaveClass(/active/)

    await page.click('#flight-mode-toggle')
    // Departure mode: BR group has flights but none is B777, so the combined
    // airline + type filter yields zero matches. The dedicated empty-state
    // block renders with the "clear aircraft type" button.
    await page.waitForSelector('.empty-state .clear-aircraft-type', { timeout: 5000 })

    // Pin survives in state and in the cookie.
    const cookies = await page.context().cookies()
    expect(cookies.find(c => c.name === 'PlaneType')?.value).toBe('B777')
    await expect(page.locator('[data-planetype="B777"]')).toHaveClass(/active/)

    // Using the clear button restores the airline-wide view and drops the pin.
    await page.click('.empty-state .clear-aircraft-type')
    await expect(page.locator('table')).toBeVisible()
    const cookiesAfter = await page.context().cookies()
    expect(cookiesAfter.find(c => c.name === 'PlaneType')).toBeUndefined()
  })
})
