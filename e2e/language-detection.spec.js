import { test, expect } from '@playwright/test'
import { setupMockApiRoute, waitForApiAndTable, blockGoogleAnalytics } from './test-helpers.js'

test.describe('Browser Language Detection Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Block Google Analytics requests
    await blockGoogleAnalytics(page)
    // Set up mock API response for each test with current date
    await setupMockApiRoute(page)
  })

  test('should detect Chinese browser language and show Chinese interface', async ({ page }) => {
    // Set Chinese locale and Accept-Language header
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9'
    })
    
    await page.goto('/')
    
    // Wait for page to load
    await page.waitForSelector('.lang-links a', { timeout: 8000 })

    // Manually switch to Chinese if not already detected
    const isChineseActive = await page.locator('[data-lang="zh"]').getAttribute('class').then(cls => 
      cls && cls.includes('active')
    ).catch(() => false)
    
    if (!isChineseActive) {
      await page.click('[data-lang="zh"]')
      await page.waitForSelector('[data-lang="zh"].active', { timeout: 5000 })
    }

    // Should show Chinese interface
    await expect(page.locator('#title')).toContainText('台北迴轉壽司🍣')
    await expect(page.locator('[data-lang="zh"]')).toHaveClass(/active/)

    // Check that 'All Flights' button is translated to Chinese
    await page.waitForSelector('#airlineButtons a[data-airline=""] .airline-full', { timeout: 5000 })
    await expect(page.locator('#airlineButtons a[data-airline=""] .airline-full')).toContainText('全部航班')
    // Check that BR airline button is localized to Chinese
    await page.waitForSelector('#airlineButtons a[data-airline="BR"] .airline-full', { timeout: 5000 })
    await expect(page.locator('#airlineButtons a[data-airline="BR"] .airline-full')).toContainText('長榮航空 (BR)')
    
    // Check if we have table or "no flights" message
    const hasTable = await page.locator('table').count() > 0
    const hasNoFlights = await page.locator('#output').textContent().then(text => 
      text && text.includes('沒有找到')
    ).catch(() => false)
    
    expect(hasTable || hasNoFlights).toBeTruthy()
    
    if (hasTable) {
      // If table exists, check content is in Chinese
      await expect(page.locator('table')).toContainText('多倫多')
      await expect(page.locator('table thead')).toContainText('航班編號')
    } else {
      // If no table, should show Chinese "no flights" message
      await expect(page.locator('#output')).toContainText('沒有找到符合條件的航班')
    }
  })

  test('should detect English browser language and show English interface', async ({ page }) => {
    // Set English locale and Accept-Language header
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })
    
    await page.goto('/')
    
    // Wait for page to load and language to be detected
    await page.waitForSelector('[data-lang="en"].active', { timeout: 8000 })

    // Should detect English and show English interface
    await expect(page.locator('#title')).toContainText('台北回転寿司🍣') // English title
    await expect(page.locator('[data-lang="en"]')).toHaveClass(/active/)

    // Check that 'All Flights' button is translated to English
    await page.waitForSelector('#airlineButtons a[data-airline=""] .airline-full', { timeout: 5000 })
    await expect(page.locator('#airlineButtons a[data-airline=""] .airline-full')).toContainText('All Flights')
    // Check that BR airline button is localized to English
    await page.waitForSelector('#airlineButtons a[data-airline="BR"] .airline-full', { timeout: 5000 })
    await expect(page.locator('#airlineButtons a[data-airline="BR"] .airline-full')).toContainText('EVA Air (BR)')
    
    // Check if we have table or "no flights" message
    const hasTable = await page.locator('table').count() > 0
    const hasNoFlights = await page.locator('#output').textContent().then(text => 
      text && text.includes('No matching')
    ).catch(() => false)
    
    expect(hasTable || hasNoFlights).toBeTruthy()
    
    if (hasTable) {
      // If table exists, check content is in English
      await expect(page.locator('table')).toContainText('Toronto')
      await expect(page.locator('table thead')).toContainText('Flight')
      await expect(page.locator('table thead')).toContainText('Departure')
    } else {
      // If no table, should show English "no flights" message
      await expect(page.locator('#output')).toContainText('No matching flights found')
    }
  })

  test('should detect Japanese browser language and show Japanese interface', async ({ page }) => {
    // Set Japanese locale and Accept-Language header
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9'
    })
    
    await page.goto('/')
    await page.waitForSelector('.lang-links a', { timeout: 8000 })

    // Manually switch to Japanese if not already detected
    const isJapaneseActive = await page.locator('[data-lang="jp"]').getAttribute('class').then(cls => 
      cls && cls.includes('active')
    ).catch(() => false)
    
    if (!isJapaneseActive) {
      await page.click('[data-lang="jp"]')
      await page.waitForSelector('[data-lang="jp"].active', { timeout: 5000 })
    }

    // Should display Japanese content
    await expect(page.locator('#title')).toContainText('台北回転寿司')
    await expect(page.locator('[data-lang="jp"]')).toHaveClass(/active/)

    // Check that 'All Flights' button is translated to Japanese
    await page.waitForSelector('#airlineButtons a[data-airline=""] .airline-full', { timeout: 5000 })
    await expect(page.locator('#airlineButtons a[data-airline=""] .airline-full')).toContainText('全フライト')
    // Check that BR airline button is localized to Japanese
    await page.waitForSelector('#airlineButtons a[data-airline="BR"] .airline-full', { timeout: 5000 })
    await expect(page.locator('#airlineButtons a[data-airline="BR"] .airline-full')).toContainText('エバー航空 (BR)')
    
    // Check if we have table or "no flights" message
    const hasTable = await page.locator('table').count() > 0
    const hasNoFlights = await page.locator('#output').textContent().then(text => 
      text && text.includes('一致する')
    ).catch(() => false)
    
    expect(hasTable || hasNoFlights).toBeTruthy()
    
    if (hasTable) {
      // Check table headers are in Japanese
      await expect(page.locator('table thead')).toContainText('フライト')
    }
  })

  test('should default to English for unsupported browser languages', async ({ page }) => {
    // Set French locale (unsupported language)
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9'
    })
    
    await page.goto('/')
    await waitForApiAndTable(page)

    // Should default to English content
    await expect(page.locator('[data-lang="en"]')).toHaveClass(/active/)
    
    // Check if we have table or "no flights" message
    const hasTable = await page.locator('table').count() > 0
    
    if (hasTable) {
      await expect(page.locator('table')).toContainText('Toronto')
      // Check table headers are in English (default for unsupported languages)
      await expect(page.locator('table thead')).toContainText('Flight')
    } else {
      await expect(page.locator('#output')).toContainText('No matching flights found')
    }
  })

  test('should handle error messages in detected language - Chinese', async ({ page }) => {
    // Set Chinese locale
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9'
    })
    
    // Mock API error
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' })
      })
    })

    await page.goto('/')
    
    // Wait for page to load and manually switch to Chinese if needed
    await page.waitForSelector('.lang-links a', { timeout: 8000 })
    
    const isChineseActive = await page.locator('[data-lang="zh"]').getAttribute('class').then(cls => 
      cls && cls.includes('active')
    ).catch(() => false)
    
    if (!isChineseActive) {
      await page.click('[data-lang="zh"]')
      await page.waitForSelector('[data-lang="zh"].active', { timeout: 5000 })
    }
    
    // Wait for error message to appear
    await page.waitForSelector('#output', { timeout: 5000 })
    
    // Should display error message in Chinese
    await expect(page.locator('#output')).toContainText('查詢失敗，請稍後再試')
  })

  test('should handle error messages in detected language - English', async ({ page }) => {
    // Set English locale
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })
    
    // Mock API error
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' })
      })
    })

    await page.goto('/')
    
    // Wait for error message to appear
    await page.waitForSelector('#output', { timeout: 5000 })
    
    // Should display error message in English
    await expect(page.locator('#output')).toContainText('Query failed, please try again later')
  })

  test('should handle empty results messages in detected language - Chinese', async ({ page }) => {
    // Set Chinese locale
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9'
    })
    
    // Mock empty API response
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      })
    })

    await page.goto('/')
    
    // Wait for page to load and manually switch to Chinese if needed
    await page.waitForSelector('.lang-links a', { timeout: 8000 })
    
    const isChineseActive = await page.locator('[data-lang="zh"]').getAttribute('class').then(cls => 
      cls && cls.includes('active')
    ).catch(() => false)
    
    if (!isChineseActive) {
      await page.click('[data-lang="zh"]')
      await page.waitForSelector('[data-lang="zh"].active', { timeout: 5000 })
    }
    
    // Wait for empty message to appear
    await page.waitForSelector('#output', { timeout: 5000 })
    
    // Should display no flights message in Chinese
    await expect(page.locator('#output')).toContainText('沒有找到')
  })

  test('should handle empty results messages in detected language - English', async ({ page }) => {
    // Set English locale
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })
    
    // Mock empty API response
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([])
      })
    })

    await page.goto('/')
    
    // Wait for empty message to appear
    await page.waitForSelector('#output', { timeout: 5000 })
    
    // Should display no flights message in English
    await expect(page.locator('#output')).toContainText('No matching flights found')
  })

  test('should allow manual language switching after automatic detection', async ({ page }) => {
    // Start with English browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
    })
    
    await page.goto('/')
    await page.waitForSelector('table')

    // Should start with English
    await expect(page.locator('[data-lang="en"]')).toHaveClass(/active/)
    await expect(page.locator('table')).toContainText('Toronto')

    // Switch to Chinese manually
    await page.click('[data-lang="zh"]')
    await waitForApiAndTable(page)
    
    // Should now display Chinese
    await expect(page.locator('[data-lang="zh"]')).toHaveClass(/active/)
    await expect(page.locator('[data-lang="en"]')).not.toHaveClass(/active/)
    await expect(page.locator('table')).toContainText('多倫多')

    // Switch to Japanese manually
    await page.click('[data-lang="jp"]')
    await waitForApiAndTable(page)
    
    // Should now display Japanese
    await expect(page.locator('[data-lang="jp"]')).toHaveClass(/active/)
    await expect(page.locator('[data-lang="zh"]')).not.toHaveClass(/active/)
  })

  // navigator.language (what detectLanguage() reads) is set via Playwright's
  // context `locale` option, not the Accept-Language header — setExtraHTTPHeaders
  // only affects the HTTP request, so it never moves auto-detection.
  // https://playwright.dev/docs/emulation#locale--timezone
  test.describe('language cookie persistence (issue #46)', () => {
    test.use({ locale: 'zh-TW' })

    test('explicit language choice persists across reload, overriding browser auto-detection', async ({ page }) => {
      // Browser locale is zh-TW; explicit English pick must win on reload anyway.
      await page.goto('/')
      await page.waitForSelector('.lang-links a', { timeout: 8000 })
      await page.click('[data-lang="en"]')
      await page.waitForSelector('[data-lang="en"].active', { timeout: 5000 })

      const cookies = await page.context().cookies()
      const langCookie = cookies.find(c => c.name === 'lang')
      expect(langCookie?.value).toBe('en')

      await page.reload()
      await page.waitForSelector('[data-lang="en"].active', { timeout: 8000 })
      await expect(page.locator('[data-lang="zh"]')).not.toHaveClass(/active/)

      // Clearing the cookie restores browser auto-detection (zh-TW -> Chinese).
      await page.context().clearCookies({ name: 'lang' })
      await page.reload()
      await page.waitForSelector('[data-lang="zh"].active', { timeout: 8000 })
      await expect(page.locator('[data-lang="en"]')).not.toHaveClass(/active/)
    })

    test('auto-detected language is never written to the cookie', async ({ page }) => {
      await page.goto('/')
      await page.waitForSelector('[data-lang="zh"].active', { timeout: 8000 })

      const cookies = await page.context().cookies()
      expect(cookies.find(c => c.name === 'lang')).toBeUndefined()
    })
  })

  // Regression for PR #49 review R4: an unrecognised `lang` cookie value used
  // to be trusted verbatim by detectLanguage(), which threw through
  // updateLanguageText() before initTheme() / updateLanguageLinks() /
  // updateAirlineLinks() ran — an empty shell, silently re-pinned for another
  // 400 days by renewPins() on every subsequent visit. detectLanguage() now
  // validates the cookie against `translations` before trusting it.
  test.describe('invalid lang cookie value falls through to auto-detection (#46 review R4)', () => {
    for (const badValue of ['fr', 'zh-TW']) {
      test(`unrecognised lang cookie "${badValue}" does not brick the app`, async ({ page }) => {
        await page.context().addCookies([
          { name: 'lang', value: badValue, domain: 'localhost', path: '/' }
        ])

        await page.goto('/')

        // Only present once initApp() has run past detectLanguage() -- the
        // pre-fix brick threw before this ever rendered.
        await page.waitForSelector('#airlineButtons a[data-airline=""] .airline-full', { timeout: 8000 })
        await expect(page.locator('#airlineButtons a[data-airline=""] .airline-full')).toBeVisible()

        // Guard against the seeded cookie silently not taking (e.g. a baseURL
        // host change breaking `domain: 'localhost'`): if it never landed,
        // every assertion below would pass for the wrong reason, since a
        // clean auto-detected load looks identical. renewPins() re-writes
        // whatever `lang` it read without validating it, so a value that was
        // adopted (not ignored) survives the load unchanged.
        const langCookie = (await page.context().cookies()).find(c => c.name === 'lang')
        expect(langCookie?.value).toBe(badValue)

        // Fell through to auto-detection rather than adopting the bad value as-is.
        const activeLang = await page.locator('.lang-links a.active').getAttribute('data-lang')
        expect(['zh', 'en', 'jp']).toContain(activeLang)
      })
    }
  })
})