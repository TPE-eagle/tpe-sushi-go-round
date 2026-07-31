import { test, expect } from '@playwright/test'
import { setupMockApiRoute, blockGoogleAnalytics } from './test-helpers.js'

// Issue #46 — About drawer, PWA install/share, and the flight-mode-never-
// persists regression the issue explicitly asks to defend with a test.
test.describe('About drawer', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
    await setupMockApiRoute(page)
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
  })

  test('opens on ☰ click, closes on the close button, Escape, and backdrop click', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#about-drawer-toggle', { timeout: 8000 })

    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    await expect(page.locator('#about-drawer-body')).toContainText('What this app does for you')

    await page.click('#about-drawer-close')
    await expect(page.locator('#about-drawer')).not.toHaveClass(/\bshow\b/)

    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    await page.keyboard.press('Escape')
    await expect(page.locator('#about-drawer')).not.toHaveClass(/\bshow\b/)

    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    // Click the backdrop (outside the drawer panel itself) to dismiss.
    await page.mouse.click(10, 10)
    await expect(page.locator('#about-drawer')).not.toHaveClass(/\bshow\b/)
  })

  test('the existing UI is unchanged apart from the new ☰ button and drawer markup', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#theme-toggle', { timeout: 8000 })

    // The theme-buttons cluster goes from 2 buttons to 3; nothing else about
    // the header/footer/table structure should be touched by this feature.
    const clusterChildren = await page.locator('.theme-buttons-container').locator('> *').count()
    expect(clusterChildren).toBe(3)
    await expect(page.locator('#about-drawer-toggle')).toBeVisible()
  })

  test('the worked return-gate example renders as a real table row', async ({ page }) => {
    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    const exampleTable = page.locator('.drawer-example-table')
    await expect(exampleTable).toBeVisible()
    await expect(exampleTable).toContainText('BR178')
    await expect(exampleTable).toContainText('KIX')
    await expect(exampleTable.locator('.return-gate-cell')).toContainText('BR177')
    await expect(exampleTable.locator('.return-gate-cell')).toContainText('C7')
  })

  test('install section shows the iOS text steps (no button) when beforeinstallprompt never fires', async ({ page }) => {
    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await expect(page.locator('#drawer-install-ios')).toBeVisible()
    await expect(page.locator('#drawer-install-button-wrap')).toBeHidden()
    await expect(page.locator('#drawer-install-section')).toContainText('Share → Add to Home Screen')
  })

  test('install section shows a real button (no iOS text) once beforeinstallprompt fires', async ({ page }) => {
    await page.addInitScript(() => {
      window.addEventListener('DOMContentLoaded', () => {
        const event = new Event('beforeinstallprompt', { cancelable: true })
        event.prompt = () => {}
        event.userChoice = Promise.resolve({ outcome: 'accepted' })
        window.dispatchEvent(event)
      })
    })

    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await expect(page.locator('#drawer-install-button-wrap')).toBeVisible()
    await expect(page.locator('#drawer-install-ios')).toBeHidden()
  })

  // Install/share both bind through document-level delegation in
  // setupEventListeners() rather than a direct element listener, since the
  // drawer body no longer exists at bind time (it's lazily rendered on
  // show.bs.offcanvas). This is the click-through proof for the install
  // button — share already has one above ("share button calls
  // navigator.share..."). Asserting effect (prompt() called, section
  // re-rendered), not just that the button is visible, is what would catch
  // the delegation ever being replaced with a direct .addEventListener on
  // an element that isn't there yet.
  test('clicking the install button calls prompt() and the section re-renders once userChoice resolves', async ({ page }) => {
    await page.addInitScript(() => {
      window.__installPromptCalled = false
      window.addEventListener('DOMContentLoaded', () => {
        const event = new Event('beforeinstallprompt', { cancelable: true })
        event.prompt = () => { window.__installPromptCalled = true }
        event.userChoice = Promise.resolve({ outcome: 'accepted' })
        window.dispatchEvent(event)
      })
    })

    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    await expect(page.locator('#drawer-install-button-wrap')).toBeVisible()

    await page.click('#drawer-install-btn')

    expect(await page.evaluate(() => window.__installPromptCalled)).toBe(true)

    // handleInstallButtonClick() clears deferredInstallPrompt once
    // userChoice resolves and re-runs updateInstallSection() — the button
    // disappears and the iOS text steps return, proving the delegated
    // handler ran the real re-render, not just prompt().
    await expect(page.locator('#drawer-install-button-wrap')).toBeHidden()
    await expect(page.locator('#drawer-install-ios')).toBeVisible()
  })

  test('install section is hidden entirely when already installed (standalone)', async ({ page }) => {
    await page.addInitScript(() => {
      const originalMatchMedia = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        if (query.includes('display-mode: standalone')) {
          return { matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }
        }
        return originalMatchMedia(query)
      }
    })

    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await expect(page.locator('#drawer-install-section')).toBeHidden()
  })

  test('share button calls navigator.share when available', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.share = (data) => {
        window.__lastShareCall = data
        return Promise.resolve()
      }
    })

    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await expect(page.locator('#drawer-share-btn')).toHaveText('Share')
    await page.click('#drawer-share-btn')

    const lastShareCall = await page.evaluate(() => window.__lastShareCall)
    expect(lastShareCall?.url).toContain('/')
  })

  test('share button falls back to clipboard + inline confirmation when navigator.share is unavailable', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.addInitScript(() => {
      // jsdom/CI headless Chromium exposes navigator.share by default in
      // some configurations; force it off to exercise the fallback branch.
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    })

    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await expect(page.locator('#drawer-share-btn')).toHaveText('Copy link')
    await expect(page.locator('#drawer-share-confirmation')).toBeHidden()

    await page.click('#drawer-share-btn')
    await expect(page.locator('#drawer-share-confirmation')).toBeVisible()
    await expect(page.locator('#drawer-share-confirmation')).toContainText('Link copied')

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain('/')
  })

  test('flight mode always resets to Arrival on reload — the one preference we deliberately never persist', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#flight-mode-toggle', { timeout: 8000 })

    // Arrival is the default: the toggle shows the plane-landing glyph.
    await expect(page.locator('#flight-mode-toggle')).toHaveText('🛬')

    await page.click('#flight-mode-toggle')
    await expect(page.locator('#flight-mode-toggle')).toHaveText('🛫')

    await page.reload()
    await page.waitForSelector('#flight-mode-toggle', { timeout: 8000 })
    await expect(page.locator('#flight-mode-toggle')).toHaveText('🛬')

    // No cookie is ever written for flight mode — the persistence mechanism
    // itself must not exist, not just happen to reset visually.
    const cookies = await page.context().cookies()
    expect(cookies.some(c => /flightmode/i.test(c.name))).toBe(false)
  })
})
