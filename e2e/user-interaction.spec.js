import { test, expect } from '@playwright/test'
import { setupMockApiRoute, waitForApiAndTable, blockGoogleAnalytics } from './test-helpers.js'

test.describe('User Interaction Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Block Google Analytics requests
    await blockGoogleAnalytics(page)
    // Set up mock API response for each test with current date
    await setupMockApiRoute(page)
  })

  test('should save and restore airline filter with cookies', async ({ page }) => {
    await page.goto('/')
    await waitForApiAndTable(page)

    // Initial state should display all flights
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).toContainText('CI123')
    await expect(page.locator('table')).toContainText('JX456')

    // Click EVA Air filter
    await page.click('[data-airline="BR"]')
    
    // Should only display BR flights
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).not.toContainText('CI123')
    await expect(page.locator('table')).not.toContainText('JX456')

    // Check if cookie is set
    const cookies = await page.context().cookies()
    const acodeCookie = cookies.find(c => c.name === 'ACode')
    expect(acodeCookie).toBeDefined()
    expect(acodeCookie.value).toBe('BR')

    // Reload page, should maintain filter state
    await page.reload()
    await waitForApiAndTable(page)
    
    // Should still only display BR flights
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).not.toContainText('CI123')
    await expect(page.locator('table')).not.toContainText('JX456')

    // EVA Air button should have active class
    await expect(page.locator('[data-airline="BR"]')).toHaveClass(/active/)
  })

  test('should save and restore theme with cookies', async ({ page }) => {
    await page.goto('/')

    // Default should be light theme. The theme toggle lives in the About
    // drawer header (issue #130 follow-up) — open the drawer to reach it.
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'light')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    await expect(page.locator('#theme-toggle')).toContainText('🌙')

    // Switch to dark theme
    await page.click('#theme-toggle')
    
    // Should become dark theme
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark')
    await expect(page.locator('#theme-toggle')).toContainText('☀️')

    // Check if cookie is set
    const cookies = await page.context().cookies()
    const themeCookie = cookies.find(c => c.name === 'theme')
    expect(themeCookie).toBeDefined()
    expect(themeCookie.value).toBe('dark')

    // Reload page, should maintain dark theme
    await page.reload()

    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark')
    // The toggle is inside the closed drawer — toContainText works on the
    // attached-but-hidden element.
    await expect(page.locator('#theme-toggle')).toContainText('☀️')
  })

  test('should handle airline selection and flight number filtering', async ({ page }) => {
    await page.goto('/')
    await waitForApiAndTable(page)

    // Select EVA Air
    await page.click('[data-airline="BR"]')
    
    // Flight number buttons should appear
    await expect(page.locator('#flightButtons')).toContainText('35')
    
    // Click specific flight number
    await page.click('[data-flight="35"][data-acode="BR"]')
    
    // Should only display that flight
    await expect(page.locator('table tbody tr')).toHaveCount(1)
    await expect(page.locator('table')).toContainText('BR35')
    
    // Flight number button should have active class
    await expect(page.locator('[data-flight="35"][data-acode="BR"]')).toHaveClass(/active/)
  })

  test('should handle language switching', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.lang-links a', { timeout: 8000 })

    // Detect current language and check content accordingly
    const currentLang = await page.locator('[data-lang].active').getAttribute('data-lang')
    expect(['zh', 'en', 'jp']).toContain(currentLang)

    // Switch to Chinese
    await page.click('[data-lang="zh"]')
    await page.waitForSelector('[data-lang="zh"].active', { timeout: 5000 })
    
    // Should display Chinese interface
    await expect(page.locator('[data-lang="zh"]')).toHaveClass(/active/)
    await expect(page.locator('[data-lang="en"]')).not.toHaveClass(/active/)

    // Check title is in Chinese
    await expect(page.locator('#title')).toContainText('台北迴轉壽司🍣')

    // Switch to Japanese
    await page.click('[data-lang="jp"]')
    await page.waitForSelector('[data-lang="jp"].active', { timeout: 5000 })
    
    await expect(page.locator('[data-lang="jp"]')).toHaveClass(/active/)
  })

  test('should be responsive on mobile devices', async ({ page }) => {
    // Set to mobile size
    await page.setViewportSize({ width: 375, height: 667 })
    
    await page.goto('/')
    await waitForApiAndTable(page)

    // On mobile layout, should display abbreviations (in detected language - English)
    await expect(page.locator('table thead')).toContainText('Flt. No') // Abbreviated version
    
    // Cities should display codes instead of full names
    await expect(page.locator('table')).toContainText('YYZ')
    await expect(page.locator('table')).toContainText('NRT')

    // Switch back to desktop version
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.reload()
    await waitForApiAndTable(page)

    // Should display full version (in detected language - English)
    await expect(page.locator('table thead')).toContainText('Flight Number')
    await expect(page.locator('table')).toContainText('Toronto')
    await expect(page.locator('table')).toContainText('Tokyo')
  })

  test('should handle empty API response gracefully', async ({ page }) => {
    // Mock empty API response
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      })
    })

    await page.goto('/')
    
    // Should display no flights message (in detected language - English)
    await expect(page.locator('#output')).toContainText('No matching flights found')
  })

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock API error
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' })
      })
    })

    await page.goto('/')
    
    // Should display error message (in detected language - English)
    await expect(page.locator('#output')).toContainText('Query failed, please try again later')
  })

  test('should display correct time range information', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#apiParams')

    // Should display current time range
    const timeInfo = await page.locator('#apiParams').textContent()
    expect(timeInfo).toMatch(/Date: \d{4}\/\d{2}\/\d{2}, Range: \d{2}:\d{2} - \d{2}:\d{2} \(UTC\+8\)/)
  })

  // Issue #88/#130 follow-up — the drawer-header window selector cycles
  // +2/+4/+6/+8h and wraps back to +2h; the footer Range line follows every
  // step, and the ForwardHours cookie survives the visibilitychange reload.
  test('time-window selector cycles the display window, survives a reload, and wraps back to +2h', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#apiParams')
    // The selector lives in the About drawer header (issue #130 follow-up).
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    const btn = page.locator('#time-window-toggle')
    await expect(btn).toHaveText('+2h')
    const rangeBefore = await page.locator('#apiParams').textContent()

    await btn.click()
    await expect(btn).toHaveText('+4h')
    await expect(btn).toHaveClass(/active/)
    const rangeAfter = await page.locator('#apiParams').textContent()
    expect(rangeAfter).not.toBe(rangeBefore)

    // PR #136 review R3 — the headline: the ForwardHours cookie survives the
    // visibilitychange auto-reload. Reload and confirm +4h stuck (drawer
    // closed after reload; text/class assertions work on the hidden element).
    await page.reload()
    await page.waitForSelector('#apiParams')
    await expect(btn).toHaveText('+4h')
    await expect(btn).toHaveClass(/active/)

    // Re-open the drawer to continue cycling from the restored value.
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await btn.click() // +6h
    await expect(btn).toHaveText('+6h')
    await btn.click() // +8h
    await expect(btn).toHaveText('+8h')
    await btn.click() // wraps back to the default
    await expect(btn).toHaveText('+2h')
    await expect(btn).not.toHaveClass(/active/)
  })

  // PR #133 review note 2 — pin the boot restore path: the drawer markup
  // hardcodes "+2h", so only a real initApp() restore (cookie read before the
  // first paint of the selector) can produce "+4h" here. Seeding via
  // addInitScript runs before any app script, matching how the cookie got
  // there on a real device (written by a previous session's cycle).
  test('a persisted ForwardHours cookie is restored on boot: button label and active fill follow the cookie, not the markup hardcode', async ({ page }) => {
    await page.addInitScript(() => {
      document.cookie = 'ForwardHours=4; path=/; max-age=34560000'
    })
    await page.goto('/')
    await page.waitForSelector('#apiParams')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    const btn = page.locator('#time-window-toggle')
    await expect(btn).toHaveText('+4h')
    await expect(btn).toHaveClass(/active/)

    // A later cycle continues from the restored value, not from +2h.
    await btn.click()
    await expect(btn).toHaveText('+6h')
  })
})
