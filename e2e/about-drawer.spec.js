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
    await expect(page.locator('#about-drawer-body')).toContainText('What this is')

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

  test('the existing UI is unchanged apart from the header cluster and drawer markup', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('#about-drawer-toggle', { timeout: 8000 })

    // The header cluster is 3 buttons (flight mode, search #130, about);
    // the time-window (#88) and theme toggles live in the drawer header
    // (issue #130 follow-up). Nothing else about the header/footer/table
    // structure should be touched.
    const clusterChildren = await page.locator('.theme-buttons-container').locator('> *').count()
    expect(clusterChildren).toBe(3)
    await expect(page.locator('#about-drawer-toggle')).toBeVisible()
    // The theme toggle sits in the closed drawer — attached, but not visible
    // until the drawer opens (Bootstrap keeps the offcanvas subtree hidden).
    await expect(page.locator('#about-drawer-header #theme-toggle')).toHaveCount(1)
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

  // Issue #62 — at 375px the example used to render the desktop board's 5
  // columns and long return-gate format, overflowing the drawer panel and
  // forcing sideways scroll to read it. The fix drops to a 3-column
  // fragment (flight number, gate, return gate) built through the same
  // header/return-gate-cell logic as the real board, so it never disagrees
  // with what the real board shows at the same width.
  test('the worked example fits at 375px: no overflow, 3-column fragment, matches the real board\'s mobile format', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    const exampleTable = page.locator('.drawer-example-table')
    await expect(exampleTable).toBeVisible()

    // A <table> that doesn't fit grows its own box rather than scrolling
    // internally — scrollWidth/clientWidth on the table itself can't catch
    // that (they stay equal while the table visibly runs off the drawer
    // edge). The panel is the element that actually needs to not overflow.
    const panelOverflow = await page.locator('#about-drawer-body').evaluate(el => el.scrollWidth - el.clientWidth)
    expect(panelOverflow).toBeLessThanOrEqual(0)

    // Real board's mobile format drops the return flight number and shows
    // gate only (`buildReturnGateCell` / `displayFlights` with isSmall
    // true) — the example must match, not keep the desktop long form.
    await expect(exampleTable.locator('thead th')).toHaveCount(3)
    await expect(exampleTable).toContainText('BR178')
    await expect(exampleTable.locator('.return-gate-cell')).toHaveText('← C7')
    await expect(exampleTable.locator('.return-gate-cell')).not.toContainText('BR177')

    // Destination/Terminal columns are dropped on mobile, not scrolled to.
    await expect(exampleTable).not.toContainText('KIX')

    // Acceptance criterion (#62): a screenshot at 375px showing the example
    // fully visible with no horizontal scroll, in both themes. Attached via
    // testInfo (not a bare page.screenshot path) so it's embedded in
    // playwright-report/ — the artifact the CI workflow's "Upload Local
    // Flight Logs" step already uploads on failure; a raw path write to
    // test-results/ would not otherwise leave the runner.
    await testInfo.attach('drawer-375-light', { body: await page.screenshot(), contentType: 'image/png' })

    // At 375px the offcanvas panel (400px wide) covers the whole viewport.
    // `initTheme()` (main.js) only falls back to `prefers-color-scheme` when
    // no `theme` cookie is set, and a fresh context has none — so emulate a
    // dark-mode device instead of seeding a cookie that never took effect
    // for the in-app theme state.
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)
    await expect(page.locator('html')).toHaveAttribute('data-bs-theme', 'dark')
    await testInfo.attach('drawer-375-dark', { body: await page.screenshot(), contentType: 'image/png' })
  })

  // Issue #62 review: the example is built once, at open time, from
  // isSmallScreen() — so crossing the 768px breakpoint while the drawer
  // stays open (device rotation, desktop window resize) used to leave it
  // showing the wrong column count / header variant for the new width,
  // reproducing the original overflow a different way.
  test('the worked example re-renders when the viewport crosses 768px while the drawer stays open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    const exampleTable = page.locator('.drawer-example-table')
    await expect(exampleTable.locator('thead th')).toHaveCount(3)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForFunction(() => window.innerWidth > 768)
    await expect(exampleTable.locator('thead th')).toHaveCount(5)
    await expect(exampleTable).toContainText('KIX')

    await page.setViewportSize({ width: 375, height: 667 })
    await page.waitForFunction(() => window.innerWidth <= 768)
    await expect(exampleTable.locator('thead th')).toHaveCount(3)
    await expect(exampleTable).not.toContainText('KIX')
  })

  test('install and share buttons render filled, not outline, so they read as tappable', async ({ page }) => {
    await page.goto('/')
    await page.click('#about-drawer-toggle')
    await expect(page.locator('#about-drawer')).toHaveClass(/\bshow\b/)

    await expect(page.locator('#drawer-install-btn')).toHaveClass(/\bbtn-secondary\b/)
    await expect(page.locator('#drawer-install-btn')).not.toHaveClass(/\bbtn-outline-secondary\b/)
    await expect(page.locator('#drawer-share-btn')).toHaveClass(/\bbtn-secondary\b/)
    await expect(page.locator('#drawer-share-btn')).not.toHaveClass(/\bbtn-outline-secondary\b/)
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

    await expect.poll(() => page.evaluate(() => window.__installPromptCalled)).toBe(true)

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
