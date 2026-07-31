import { test, expect } from '@playwright/test'
import { parseApiResponse, createApiPostData, getTimeWindow, getTimeWindowConfig, formatToUTC8_HHMM } from '../src/utils/flightUtils.js'
import { getCurrentUTC8Date, getMockFlightData, waitForApiAndTable, setupMockApiRoute, blockGoogleAnalytics } from './test-helpers.js'

test.describe('API Integration Tests', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
  })

  test('should send correct API parameters', async ({ page, request }) => {
    // Intercept API requests to verify parameters
    const apiRequests = []
    
    // Set up API route interception
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      const postData = route.request().postDataJSON()
      apiRequests.push(postData)
      
      // Verify API request parameter format
      expect(postData).toHaveProperty('ODate')
      expect(postData).toHaveProperty('OTimeOpen', null)
      expect(postData).toHaveProperty('OTimeClose', null)
      expect(postData).toHaveProperty('BNO', null)
      expect(postData).toHaveProperty('AState')
      expect(postData).toHaveProperty('language')
      expect(postData).toHaveProperty('keyword', '')
      
      // Ensure time parameters are null (IMPORTANT!)
      expect(postData.OTimeOpen).toBeNull()
      expect(postData.OTimeClose).toBeNull()
      
      // Mock API response using current date
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(getMockFlightData())
      })
    })

    await page.goto('/')
    
    // Wait for page load and API request completion with proper readiness checks
    await waitForApiAndTable(page)
    
    // Verify at least one API request was sent
    expect(apiRequests.length).toBeGreaterThan(0)
    
    // Verify parameters of the last request
    const lastRequest = apiRequests[apiRequests.length - 1]
    expect(lastRequest.AState).toBe('A') // Default to arrival mode
    // Language should depend on browser detection, not default to Chinese
    expect(['ch', 'en', 'jp']).toContain(lastRequest.language)
  })

  test('should display data matching our parsing logic', async ({ page }) => {
    // Set up mock API route with data that includes flights within current time window
    await setupMockApiRoute(page)

    await page.goto('/')
    await waitForApiAndTable(page)

    // Verify basic flight data display - check that our three test airlines are shown
    await expect(page.locator('table')).toContainText('BR35')
    await expect(page.locator('table')).toContainText('CI123') 
    await expect(page.locator('table')).toContainText('JX456')

    // Verify city names are displayed (depends on language detection)
    const hasTable = await page.locator('table').count() > 0
    if (hasTable) {
      // Check that one of our test cities is displayed
      const tableContent = await page.locator('table').textContent()
      const hasCityData = tableContent.includes('Toronto') || tableContent.includes('Tokyo') || tableContent.includes('Los Angeles') ||
                         tableContent.includes('多倫多') || tableContent.includes('東京') || tableContent.includes('洛杉磯')
      expect(hasCityData).toBeTruthy()
      
      // Check terminal information is displayed
      expect(tableContent.includes('T1') || tableContent.includes('T2')).toBeTruthy()
      
      // Special verification for BR35 display (regression test)
      await expect(page.locator('table')).toContainText('BR35')
    }
  })

  test('should handle language switching correctly', async ({ page }) => {
    // Set up mock with current date
    await setupMockApiRoute(page)

    await page.goto('/')
    
    // Wait for initial page load and API response
    await waitForApiAndTable(page)

    // Language detection depends on browser, so check current state first
    const currentLang = await page.locator('[data-lang].active').getAttribute('data-lang')
    
    if (currentLang === 'zh') {
      await expect(page.locator('table')).toContainText('多倫多')
    } else {
      await expect(page.locator('table')).toContainText('Toronto')
    }

    // Switch to English
    await page.click('[data-lang="en"]')
    await waitForApiAndTable(page)
    
    // Should display English city name
    await expect(page.locator('table')).toContainText('Toronto')
  })

  test('should handle flight mode switching, with the served payload itself tagged for the requested mode (issue #38)', async ({ page }) => {
    // Set up mock for both arrival and departure modes
    await setupMockApiRoute(page)

    // Issue #38 acceptance: assert on the response payload, not just the UI
    // label. A harness bug that fed departures mode a leftover arrivals
    // payload would still pass a title-only check — the title only reflects
    // which mode was requested, not which data the app actually received.
    const seenAStates = []
    page.on('response', async (response) => {
      if (response.url() !== 'https://www.taoyuan-airport.com/api/api/flight/a_flight') return
      const body = await response.json().catch(() => null)
      if (Array.isArray(body) && body.length > 0) {
        seenAStates.push(new Set(body.map(flight => flight.AState)))
      }
    })

    await page.goto('/')

    // Wait for page load
    await page.waitForSelector('#flight-mode-toggle', { timeout: 5000 })

    // Default should be arrival mode
    await expect(page.locator('#flight-mode-toggle')).toContainText('🛬')
    // Title can be in different languages depending on browser settings
    await expect(page.locator('#title')).toContainText(/迴轉壽司|回転寿司/)
    expect(seenAStates.length).toBeGreaterThan(0)
    expect([...seenAStates[seenAStates.length - 1]]).toEqual(['A'])

    // Switch to departure mode and wait for data refresh
    await page.click('#flight-mode-toggle')
    await waitForApiAndTable(page)

    // Should become departure mode with updated title
    await expect(page.locator('#flight-mode-toggle')).toContainText('🛫')
    await expect(page.locator('#title')).toContainText(/出發便|出発便/)
    // The response the departures view actually rendered from must itself
    // be tagged AState 'D' — every record, not a mix left over from arrivals.
    expect([...seenAStates[seenAStates.length - 1]]).toEqual(['D'])
  })
})