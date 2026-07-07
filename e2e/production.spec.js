import { test, expect } from '@playwright/test'
import { blockGoogleAnalytics, setupMockApiRoute, getMockFlightData } from './test-helpers.js'

const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'

const expectedTitles = {
  zh: { arrival: '台北迴轉壽司🍣', departure: '台北出發便🛫🌏' },
  en: { arrival: '台北回転寿司🍣', departure: '台北出発便🛫🌏' },
  jp: { arrival: '台北回転寿司🍣', departure: '台北出発便🛫🌏' },
};

test.describe('Production Environment Tests', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
    await setupMockApiRoute(page)
  })

  test('should load production site successfully', async ({ page }) => {
    await page.goto('')

    await page.waitForSelector('#title', { timeout: 10000 })
    await expect(page.locator('#title')).toBeVisible()

    // With fixture mock in place, the table must be populated — not just "something appeared".
    // A pass on the no-flights message would be fake-green (means the mock didn't fire).
    await page.waitForSelector('table', { timeout: 10000 })
    await expect(page.locator('table')).toBeVisible()
  })

  test('should validate API request parameters', async ({ page }) => {
    const apiRequests = []
    const fixture = getMockFlightData()

    // Capture request params AND fulfill with fixture in one handler.
    // Registered after beforeEach's setupMockApiRoute so it runs first (LIFO);
    // fulfilling here means no network fallthrough and no chaining needed.
    await page.route(API_URL, async (route) => {
      try {
        apiRequests.push({
          method: route.request().method(),
          postData: route.request().postDataJSON()
        })
      } catch { /* ignore parse errors */ }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture)
      })
    })

    await page.goto('')
    await page.waitForSelector('table', { timeout: 10000 })

    // Verify API request was captured with correct parameters
    expect(apiRequests.length).toBeGreaterThan(0)
    const apiRequest = apiRequests[0]
    expect(apiRequest.method).toBe('POST')

    const postData = apiRequest.postData
    expect(postData).toHaveProperty('ODate')
    expect(postData).toHaveProperty('AState', 'A')

    // Ensure time parameters are null for full day data (IMPORTANT!)
    if (postData.hasOwnProperty('OTimeOpen')) {
      expect(postData.OTimeOpen).toBeNull()
    }
    if (postData.hasOwnProperty('OTimeClose')) {
      expect(postData.OTimeClose).toBeNull()
    }
  })

  test('should display flight data correctly', async ({ page }) => {
    await page.goto('')

    // Fixture mock is always set up in beforeEach — table must be present.
    // Falling through to the no-flights branch would mean the mock didn't fire (fake-green).
    await page.waitForSelector('table', { timeout: 10000 })
    await expect(page.locator('table thead')).toBeVisible()
    await expect(page.locator('table tbody')).toBeVisible()

    // Header labels (any language)
    await expect(page.locator('table th').nth(0)).toHaveText(/航班|Flight|番号/)
    await expect(page.locator('table th').nth(1)).toHaveText(/出發地|Departure|出発地/)
    await expect(page.locator('table th').nth(2)).toHaveText(/航廈|Terminal/)
    await expect(page.locator('table th').nth(3)).toHaveText(/登機門|Gate/)

    // In arrival mode the carousel column must be present
    const isArrivalMode = (await page.locator('#flight-mode-toggle').textContent()) === '🛬'
    if (isArrivalMode) {
      await expect(page.locator('table th').nth(4)).toHaveText(/轉盤|Carousel/)
    }

    const rowCount = await page.locator('table tbody tr').count()
    expect(rowCount).toBeGreaterThan(0)

    const firstRow = page.locator('table tbody tr').first()
    const cells = firstRow.locator('td')
    await expect(cells.first()).toContainText(/[A-Z]{2}\d+/)
    await expect(cells.first().locator('img')).toBeVisible()
  })

  test('should have correct time range display', async ({ page }) => {
    await page.goto('')
    await page.waitForSelector('#apiParams', { timeout: 10000 })
    
    // Check time range format
    const timeInfo = await page.locator('#apiParams').textContent()
    expect(timeInfo).toMatch(/Date: \d{4}\/\d{2}\/\d{2}, Range: \d{2}:\d{2} - \d{2}:\d{2} \(UTC\+8\)/)
    
    // Verify time range is 2 hours
    const timeMatch = timeInfo.match(/Range: (\d{2}):(\d{2}) - (\d{2}):(\d{2})/)
    if (timeMatch) {
      const startHour = parseInt(timeMatch[1])
      const startMin = parseInt(timeMatch[2])
      const endHour = parseInt(timeMatch[3])
      const endMin = parseInt(timeMatch[4])
      
      const startMinutes = startHour * 60 + startMin
      const endMinutes = endHour * 60 + endMin
      const duration = endMinutes - startMinutes
      
      expect(duration).toBe(120) // Should be 120 minutes = 2 hours
    }
  })

  test('should handle airline filtering correctly', async ({ page }) => {
    await page.goto('')
    
    // Wait for airline buttons to load
    await page.waitForSelector('#airlineButtons a', { timeout: 10000 })
    
    // Check if there are supported airline buttons
    const airlineButtons = page.locator('#airlineButtons a[data-airline]')
    const buttonCount = await airlineButtons.count()
    expect(buttonCount).toBeGreaterThan(0)
    
    // Check if there is ALL button
    await expect(page.locator('[data-airline=""]')).toBeVisible()
    
    // Check supported airlines
    const supportedAirlines = ['BR', 'CI', 'JX']
    for (const airline of supportedAirlines) {
      const button = page.locator(`[data-airline="${airline}"]`)
      const buttonExists = await button.count() > 0
      
      if (buttonExists) {
        // If there is button for that airline, test click functionality
        await button.click()
        
        // Wait for filtering to complete
        await expect(button).toHaveClass(/active/, { timeout: 5000 })
        
        // If there is flight data, should only display flights from that airline
        const hasTable = await page.locator('table').count() > 0
        if (hasTable) {
          const flightCodes = await page.locator('table tbody td:first-child').allTextContents()
          for (const code of flightCodes) {
            expect(code).toContain(airline)
          }
        }
        
        // Reset to ALL
        await page.click('[data-airline=""]')
        await expect(page.locator('[data-airline=""]')).toHaveClass(/active/, { timeout: 5000 })
      }
    }
  })

  test('should handle language switching', async ({ page }) => {
    await page.goto('')
    await page.waitForSelector('.lang-links a', { timeout: 10000 })
    
    // Check current active language (depends on browser detection)
    const initialLang = await page.locator('[data-lang].active').getAttribute('data-lang')
    expect(['zh', 'en', 'jp']).toContain(initialLang)
    
    // Switch to English
    await page.click('[data-lang="en"]')
    await page.waitForSelector('[data-lang="en"].active', { timeout: 5000 })
    
    await expect(page.locator('[data-lang="en"]')).toHaveClass(/active/)
    
    // Check if title has changed
    const title = await page.locator('#title').textContent()
    expect(title).toBeTruthy()
    
    // Switch to Japanese
    await page.click('[data-lang="jp"]')
    await page.waitForSelector('[data-lang="jp"].active', { timeout: 5000 })
    
    await expect(page.locator('[data-lang="jp"]')).toHaveClass(/active/)
  })

  test('should handle theme switching and persistence', async ({ page }) => {
    await page.goto('')
    await page.waitForSelector('#theme-toggle', { timeout: 10000 })
    
    // Check initial theme
    const initialTheme = await page.locator('html').getAttribute('data-bs-theme')
    expect(['light', 'dark']).toContain(initialTheme)
    
    // Switch theme
    await page.click('#theme-toggle')
    // Wait for theme toggle to take effect
    await expect(page.locator('html')).not.toHaveAttribute('data-bs-theme', initialTheme, { timeout: 5000 })

    // Check if theme has changed
    const newTheme = await page.locator('html').getAttribute('data-bs-theme')
    expect(newTheme).not.toBe(initialTheme)
    
    // Reload page, check if theme is persistent
    await page.reload()
    await page.waitForSelector('#theme-toggle', { timeout: 10000 })
    
    const persistedTheme = await page.locator('html').getAttribute('data-bs-theme')
    expect(persistedTheme).toBe(newTheme)
  })

  test('should handle flight mode switching', async ({ page }) => {
    await page.goto('')
    await page.waitForSelector('#flight-mode-toggle', { timeout: 10000 })
    
    // Determine current language
    const initialLang = await page.locator('[data-lang].active').getAttribute('data-lang')
    expect(['zh', 'en', 'jp']).toContain(initialLang)

    // Check initial mode and title (arrival)
    await expect(page.locator('#flight-mode-toggle')).toHaveText('🛬')
    await expect(page.locator('#title')).toHaveText(expectedTitles[initialLang].arrival)

    // Switch to departure mode
    await page.click('#flight-mode-toggle')
    await page.waitForFunction(
      () => document.querySelector('#flight-mode-toggle').textContent.includes('🛫'),
      { timeout: 5000 }
    )

    // Verify departure mode icon and title
    await expect(page.locator('#flight-mode-toggle')).toHaveText('🛫')
    await expect(page.locator('#title')).toHaveText(expectedTitles[initialLang].departure)

    // Switch back to arrival mode
    await page.click('#flight-mode-toggle')
    await page.waitForFunction(
      () => document.querySelector('#flight-mode-toggle').textContent.includes('🛬'),
      { timeout: 5000 }
    )

    // Verify arrival mode icon and title
    await expect(page.locator('#flight-mode-toggle')).toHaveText('🛬')
    await expect(page.locator('#title')).toHaveText(expectedTitles[initialLang].arrival)
  })

  test('should be responsive across different screen sizes', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('')
    await page.waitForSelector('table', { timeout: 10000 })

    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForSelector('table', { timeout: 5000 })

    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForSelector('table', { timeout: 5000 })

    // On mobile width the app renders abbreviated headers
    const headers = await page.locator('table th').allTextContents()
    const hasShortHeaders = headers.some(header =>
      header.includes('航班') || header.includes('Flt')
    )
    expect(hasShortHeaders).toBeTruthy()
  })
})