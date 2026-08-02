import { test, expect } from '@playwright/test'
import { setupMockApiRoute, blockGoogleAnalytics, waitForApiAndTable } from './test-helpers.js'

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
  // 769px is the narrowest width that still gets the desktop absolute/row
  // cluster layout — the ≤768px media query hasn't kicked in yet, so this
  // is the true worst case for cluster-vs-title clearance (issue #72
  // item 2: 769-1023px was previously untested).
  { width: 769, height: 800 },
]

function intersects(a, b) {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
}

// `#title`, `#airlineButtons`, `#planeTypeButtons` and `#flightButtons` are
// all full-width block/flex containers with centred content — their own
// boundingBox() always spans the full container width, so it "intersects"
// a right-anchored cluster regardless of where the visible text/buttons
// actually sit. Range.getBoundingClientRect() over the element's contents
// returns the rendered ink instead (the centred children only, not the
// empty flex space around them), which is what "the cluster visibly covers
// this" actually means.
//
// Two things settle before that measurement (issue #72 PR #95 review R2):
// #title runs a 2s dropShadowAnimation (style.scss) that widens its
// letter-spacing from 10px/40px down to 0 as it plays, so measuring mid-
// animation catches a transient, wider-than-final ink box — this is what
// made the 769x800 case flaky (fails on the fast first attempt, passes on
// retry once the animation has settled). changeLanguageFont() (main.js)
// also appends a Google Fonts stylesheet at runtime, so an early measurement
// can land on the fallback face before the real one swaps in. Both apply to
// every caller of this helper, not just the language-axis tests, since the
// animation plays on every load regardless of language.
async function getInkBox(locator) {
  await locator.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
  await locator.page().evaluate(() => document.fonts.ready)
  return locator.evaluate(el => {
    const r = document.createRange()
    r.selectNodeContents(el)
    const { x, y, width, height } = r.getBoundingClientRect()
    return { x, y, width, height }
  })
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
          // waitForSelector('.theme-buttons-container') alone resolves at
          // first render, before the mocked API response has been turned
          // into a table — wait for the actual table too, since that's
          // what theadRow below measures.
          await waitForApiAndTable(page)
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
            // The mode switch triggers a fresh fetchData() — the icon flips
            // synchronously, before the new response has re-rendered the
            // table, so re-wait rather than measure a stale/mid-render one.
            await waitForApiAndTable(page)
          }

          const clusterBox = await page.locator('.theme-buttons-container').boundingBox()
          expect(clusterBox).not.toBeNull()

          // The cluster's own height must not grow with button count — a
          // row layout keeps it pinned at one button's height regardless
          // of how many toggles it holds (the actual fix for issue #66;
          // a column layout would grow past this with a 4th button).
          // Checked before the per-target loop so a soft failure below
          // can't suppress it.
          expect(clusterBox.height).toBeLessThanOrEqual(40)

          // theadRow and #title are the actual regression targets from
          // issue #66 (theadRow) and issue #72 item 3 (#title): the mock
          // always returns flights and #title is unconditional markup
          // (main.js's renderApp()), so either being absent/hidden here is
          // a render failure, not a legitimately-conditional element —
          // assert both are there instead of silently skipping past them.
          const theadRow = page.locator('#output table thead tr').first()
          await expect(theadRow).toBeVisible()
          const theadBox = await theadRow.boundingBox()
          expect.soft(intersects(clusterBox, theadBox), 'theadRow intersects the toggle cluster').toBe(false)

          const titleLocator = page.locator('#title')
          await expect(titleLocator).toBeVisible()
          const titleInk = await getInkBox(titleLocator)
          expect.soft(intersects(clusterBox, titleInk), 'title intersects the toggle cluster').toBe(false)

          // These are full-width flex/block containers with centred
          // content — measure the rendered ink (getInkBox), not the block
          // box, or the assertion is geometry the user cannot see (R1).
          // Legitimately conditional (e.g. planeTypeButtons only renders
          // once an airline is pinned) — count()===0 here is a real
          // "not applicable", unlike title/theadRow above.
          const inkTargets = {
            airlineButtons: page.locator('#airlineButtons'),
            planeTypeButtons: page.locator('#planeTypeButtons'),
            flightButtons: page.locator('#flightButtons'),
          }

          for (const [name, locator] of Object.entries(inkTargets)) {
            if (await locator.count() === 0) continue
            const ink = await getInkBox(locator)
            if (ink.width === 0 || ink.height === 0) continue
            expect.soft(intersects(clusterBox, ink), `${name} intersects the toggle cluster`).toBe(false)
          }
        })
      }
    }
  }

  // Issue #66 R3: the row layout above fixes desktop, but at 375px it
  // *rotates* the overlap instead of removing it — a 130px-wide,
  // right-anchored cluster reaches into the centred title's ink on a
  // narrow screen (confirmed via a CI failure screenshot, not derived).
  // The ≤768px media query in style.scss takes the cluster out of
  // absolute positioning entirely there, so it renders as a normal flow
  // block above the title instead of overlaid on top of it — overlap-proof
  // by construction (real flow siblings can't occupy the same box), not
  // just clear at the one title string/length that was measured.
  test('cluster does not grow tall on mobile (375x667) either', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await waitForApiAndTable(page)
    await page.waitForSelector('.theme-buttons-container', { timeout: 8000 })

    const clusterBox = await page.locator('.theme-buttons-container').boundingBox()
    expect(clusterBox).not.toBeNull()
    expect(clusterBox.height).toBeLessThanOrEqual(40)

    const theadRow = page.locator('#output table thead tr').first()
    await expect(theadRow).toBeVisible()
    const theadBox = await theadRow.boundingBox()
    expect.soft(intersects(clusterBox, theadBox), 'theadRow intersects the toggle cluster on mobile').toBe(false)

    const titleLocator = page.locator('#title')
    await expect(titleLocator).toBeVisible()
    const titleInk = await getInkBox(titleLocator)
    expect.soft(intersects(clusterBox, titleInk), 'title intersects the toggle cluster on mobile').toBe(false)
  })

  // Issue #72 item 2, second axis: the loop above only exercises whatever
  // language the browser context defaults to. #title's copy changes with
  // the language switcher (main.js translations), and cluster-vs-title
  // clearance is a function of title width — so at 769x800, the worst-case
  // viewport for this overlap, check every language's title rather than
  // assume the default happens to be the widest one.
  for (const lang of ['zh', 'en', 'jp']) {
    test(`title does not overlap the toggle cluster at 769x800 — ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: 769, height: 800 })
      await page.goto('/')
      await waitForApiAndTable(page)
      await page.waitForSelector('.theme-buttons-container', { timeout: 8000 })

      await page.click(`[data-lang="${lang}"]`)
      await page.waitForSelector(`[data-lang="${lang}"].active`, { timeout: 5000 })

      const clusterBox = await page.locator('.theme-buttons-container').boundingBox()
      expect(clusterBox).not.toBeNull()

      const titleLocator = page.locator('#title')
      await expect(titleLocator).toBeVisible()
      const titleInk = await getInkBox(titleLocator)
      expect.soft(intersects(clusterBox, titleInk), `title (${lang}) intersects the toggle cluster at 769x800`).toBe(false)
    })
  }

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
