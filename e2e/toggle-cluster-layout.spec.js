import { test, expect } from '@playwright/test'
import { setupMockApiRoute, blockGoogleAnalytics } from './test-helpers.js'

// Issue #66 — the About drawer toggle (PR #49) took the theme-buttons
// cluster from 2 buttons to 3. The cluster is `position: absolute` with
// zero reserved layout space, so a taller cluster just draws over whatever
// content happens to sit underneath it instead of pushing it down. This
// spec asserts the cluster's bounding box never intersects the elements a
// real desktop screenshot showed it covering (the table header) or any of
// the other in-flow header content, at both desktop viewports the issue
// asked to cover and at the pre-existing 768px mobile breakpoint.
const DESKTOP_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
]

function intersects(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
}

test.describe('Toggle cluster layout (issue #66)', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
    await setupMockApiRoute(page)
  })

  for (const viewport of DESKTOP_VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      for (const mode of ['arrivals', 'departures']) {
        test(`cluster does not cover header content — ${viewport.width}x${viewport.height}, ${theme}, ${mode}`, async ({ page }) => {
          await page.setViewportSize(viewport)
          await page.goto('/')
          await page.waitForSelector('.theme-buttons-container', { timeout: 8000 })

          if (theme === 'dark') {
            const html = page.locator('html')
            if (await html.getAttribute('data-bs-theme') !== 'dark') {
              await page.click('#theme-toggle')
              await expect(html).toHaveAttribute('data-bs-theme', 'dark')
            }
          }

          if (mode === 'departures') {
            await page.click('#flight-mode-toggle')
            await expect(page.locator('#flight-mode-toggle')).toHaveText('🛫')
          }

          const clusterBox = await page.locator('.theme-buttons-container').boundingBox()
          expect(clusterBox).not.toBeNull()

          const targets = {
            title: page.locator('#title'),
            theadRow: page.locator('#output table thead tr').first(),
            airlineButtons: page.locator('#airlineButtons'),
            planeTypeButtons: page.locator('#planeTypeButtons'),
            flightButtons: page.locator('#flightButtons'),
          }

          for (const [name, locator] of Object.entries(targets)) {
            if (await locator.count() === 0) continue
            const box = await locator.boundingBox()
            if (!box || box.width === 0 || box.height === 0) continue
            expect(intersects(clusterBox, box), `${name} intersects the toggle cluster`).toBe(false)
          }

          // The cluster's own height must not grow with button count — a
          // row layout keeps it pinned at one button's height regardless
          // of how many toggles it holds (the actual fix for issue #66;
          // a column layout would grow past this with a 4th button).
          expect(clusterBox.height).toBeLessThanOrEqual(40)
        })
      }
    }
  }

  // Issue #66 scope note: the mobile media query (style.scss ~859-893)
  // redeclares the button sizes but not .theme-buttons-container itself,
  // so mobile shared the exact same column-stack growth risk as desktop.
  // No separate mobile fix was requested, but the row-layout change above
  // applies to this selector unconditionally, so mobile gets the same fix
  // as a side effect — this asserts that.
  test('cluster does not grow tall on mobile (375x667) either', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.waitForSelector('.theme-buttons-container', { timeout: 8000 })

    const clusterBox = await page.locator('.theme-buttons-container').boundingBox()
    expect(clusterBox).not.toBeNull()
    expect(clusterBox.height).toBeLessThanOrEqual(40)

    const title = page.locator('#title')
    const titleBox = await title.boundingBox()
    if (titleBox && titleBox.width > 0 && titleBox.height > 0) {
      expect(intersects(clusterBox, titleBox), 'title intersects the toggle cluster on mobile').toBe(false)
    }
  })

  // Issue #66's other complaint: the ☰ glyph read off-centre next to the
  // 🌙/🛬 emoji, suspected to be a text-vs-emoji font baseline mismatch.
  // The fix replaces the glyph with an inline SVG, which is centred by
  // construction (equal margins in the viewBox) rather than by font
  // metrics — this asserts the rendered SVG's box is actually centred
  // inside its button, in both dimensions, at both breakpoints.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 667 }]) {
    test(`about-drawer-toggle icon is centred in its button — ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await page.waitForSelector('#about-drawer-toggle', { timeout: 8000 })

      const buttonBox = await page.locator('#about-drawer-toggle').boundingBox()
      const svgBox = await page.locator('#about-drawer-toggle svg').boundingBox()
      expect(buttonBox).not.toBeNull()
      expect(svgBox).not.toBeNull()

      const buttonCenterX = buttonBox.x + buttonBox.width / 2
      const buttonCenterY = buttonBox.y + buttonBox.height / 2
      const svgCenterX = svgBox.x + svgBox.width / 2
      const svgCenterY = svgBox.y + svgBox.height / 2

      expect(Math.abs(svgCenterX - buttonCenterX)).toBeLessThanOrEqual(1)
      expect(Math.abs(svgCenterY - buttonCenterY)).toBeLessThanOrEqual(1)
    })
  }
})
