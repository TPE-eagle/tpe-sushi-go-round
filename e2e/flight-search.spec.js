// Issue #130 — quick-dial flight-number search (board takeover).
//
// Covers the wiring: the takeover hides #output while a query is active and
// restores it on close, gate/carousel values render in the board's own table
// format, the airline pin scopes results (with a one-tap reveal when it
// hides a match), cancelled rows show their chip, and the sessionStorage
// restore survives a reload. The window-independence property itself is
// unit-tested (src/test/search.test.js) — on localhost the board is
// full-day by design (the time-filter skip), so E2E cannot distinguish
// "inside" from "outside" the window.
import { test, expect } from '@playwright/test'
import { setupMockApiRoute, getMockFlightData, blockGoogleAnalytics, fixedAtUtc8, requestAState } from './test-helpers.js'

function todayUTC8() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '/')
}

async function openSearch(page) {
  await page.click('#search-toggle')
  await page.waitForSelector('#search-bar:not([hidden])', { timeout: 8000 })
}

async function searchFor(page, query) {
  await page.fill('#search-input', query)
  await page.waitForSelector('#search-results table', { timeout: 8000 })
}

test.describe('Quick-dial flight search', () => {
  test.beforeEach(async ({ page }) => {
    blockGoogleAnalytics(page)
    await setupMockApiRoute(page)
    // Issue #160 — the search "now" cutoff is wall-clock aware, so freeze the
    // page clock to 11:00 UTC+8: the shared fixture times (12:00–12:50 anchor,
    // test-helpers.js) then always read as still ahead, whatever hour CI runs.
    // Freezing on today's date keeps the node-side fixture ODate consistent
    // with the page clock (same trick as nextday-search.spec.js).
    await page.clock.setFixedTime(fixedAtUtc8(11, 0))
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })
  })

  test('opening search collapses the flight-number row; a query takes over the board', async ({ page }) => {
    await openSearch(page)
    // Owner feedback: the plane-type and flight-number rows collapse the
    // moment search is open — quick dial replaces them (query not even
    // needed).
    await expect(page.locator('#flightButtons')).toBeHidden()
    await expect(page.locator('#planeTypeButtons')).toBeHidden()

    await searchFor(page, '35')

    // Takeover: the board is hidden, results are shown in the board's slot
    // as a real table.
    await expect(page.locator('#output')).toBeHidden()
    await expect(page.locator('#planeTypeButtons')).toBeHidden()

    const table = page.locator('#search-results table').first()
    await expect(table).toContainText('BR35')
    await expect(table).toContainText('05')
    await expect(table).toContainText('C3')

    // Status line announces the hit.
    await expect(page.locator('#search-status')).toContainText(/1/)
  })

  test('closing search restores the board exactly as it was', async ({ page }) => {
    // Put the board in a non-default state first: pin an airline.
    await page.click('a[data-airline="BR"]')
    await page.waitForSelector('#output table tbody tr')

    await openSearch(page)
    await searchFor(page, '35')
    await expect(page.locator('#output')).toBeHidden()

    await page.click('#search-toggle') // close
    await expect(page.locator('#output')).toBeVisible()
    await expect(page.locator('#search-results')).toBeHidden()
    await expect(page.locator('#flightButtons')).toBeVisible()
    // The BR pin survived the takeover.
    await expect(page.locator('#output')).toContainText('BR35')
    await expect(page.locator('a[data-airline="BR"].active')).toBeVisible()
  })

  test('matches in both directions render stacked tables, one per direction', async ({ page }) => {
    await openSearch(page)
    // B7681 exists in both the arrivals and departures stores (the mock
    // serves the same five flights re-tagged per mode).
    await searchFor(page, '681')

    await expect(page.locator('#search-results table')).toHaveCount(2)
    // Each table shows its own relevant value: arrivals table has the
    // carousel (07), departures table has the gate (C5).
    await expect(page.locator('#search-results table').first()).toContainText('07')
    await expect(page.locator('#search-results table').last()).toContainText('C5')
  })

  test('the airline pin scopes the search and the empty state can lift it', async ({ page }) => {
    await page.click('a[data-airline="BR"]')
    await page.waitForSelector('#output table tbody tr')

    await openSearch(page)
    await page.fill('#search-input', '123') // CI123 — not BR
    // Pin hint with a one-tap reveal, not a bare "no match".
    await expect(page.locator('#search-show-all')).toBeVisible()
    await page.click('#search-show-all')
    await page.waitForSelector('#search-results table', { timeout: 8000 })
    // The mock serves the same five flights per direction, so CI123 shows in
    // both tables.
    await expect(page.locator('#search-results table')).toHaveCount(2)
    await expect(page.locator('#search-results table').first()).toContainText('CI123')
  })

  test('cancelled rows render a cancelled chip, not a "no match"', async ({ page }) => {
    const cancelledFlight = {
      ...getMockFlightData()[0],
      ACode: 'BR',
      FlightNo: '999',
      id: `${todayUTC8().replace(/\//g, '')}_D_BR999`,
      Memo: '取消',
      Gate: '',
    }
    // Serve a dataset where BR999 (cancelled, departures) exists.
    const custom = [...getMockFlightData(), cancelledFlight]
    await setupMockApiRoute(page, custom, custom)
    await page.goto('')
    await page.waitForSelector('#output table tbody tr')

    // Departures mode: the cancelled row is on the departures board path —
    // dropped there, but searchable with its chip.
    await page.click('#flight-mode-toggle')
    await page.waitForSelector('#output table tbody tr')
    await openSearch(page)
    await searchFor(page, '999')

    // The cancelled flight exists in BOTH direction stores (the mock re-tags
    // the same records), so both tables carry a cancelled row.
    await expect(page.locator('#search-results tr.row-cancelled')).toHaveCount(2)
    await expect(page.locator('#search-results table').last()).toContainText(/Cancelled|已取消/)
  })

  test('the search state survives a reload (visibilitychange path)', async ({ page }) => {
    await openSearch(page)
    await searchFor(page, '35')

    await page.reload()
    await page.waitForSelector('#search-bar:not([hidden])', { timeout: 15000 })
    await expect(page.locator('#search-input')).toHaveValue('35')
    // Results repaint when the fetch lands — the restore itself paints nothing.
    await page.waitForSelector('#search-results table', { timeout: 15000 })
    await expect(page.locator('#search-results table').first()).toContainText('BR35')
  })

  test('language switch re-renders the results in the new language', async ({ page }) => {
    await openSearch(page)
    await searchFor(page, '35')
    await expect(page.locator('#search-results table').first()).toContainText('BR35')

    await page.click('a[data-lang="zh"]')
    await page.waitForSelector('#search-results table', { timeout: 15000 })
    // Still searching, now in Chinese: the direction caption is localized.
    await expect(page.locator('#search-results table caption').first()).toContainText('到達')
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', /178/)
  })

  // Issue #166 — an empty result under a refresh closes the bar itself.
  test('a no-match query auto-closes the bar after a reload', async ({ page }) => {
    await openSearch(page)
    await page.fill('#search-input', '999') // not a prefix of any fixture flight
    await expect(page.locator('.search-empty')).toBeVisible()

    await page.reload()
    // The restored search repaints (or auto-closes) when the fetch lands;
    // #output only becomes visible again through closeSearch(), so waiting
    // on visible board rows is also waiting for the close itself.
    await page.waitForSelector('#output table tbody tr', { state: 'visible', timeout: 15000 })
    await expect(page.locator('#search-bar')).toBeHidden()
    await expect(page.locator('#search-toggle')).not.toHaveClass(/active/)
    await expect(page.locator('#search-input')).toHaveValue('')
    // closeSearch cleared the takeover surfaces. (#flightButtons is empty in
    // a pin-less board — the row only renders under an airline pin — so its
    // zero-size box is "hidden" to Playwright regardless of the close.)
    await expect(page.locator('#search-results')).toBeHidden()
    await expect(page.locator('#search-status')).toBeHidden()
    // The session state was removed: the next reload must not reopen the bar.
    const session = await page.evaluate(() => sessionStorage.getItem('tpe_flight_search'))
    expect(session).toBeNull()
  })

  test('a pin-hint empty state survives the reload without auto-closing', async ({ page }) => {
    await page.click('a[data-airline="BR"]')
    await page.waitForSelector('#output table tbody tr')
    await openSearch(page)
    await page.fill('#search-input', '123') // CI123 — exists, hidden by the BR pin
    await expect(page.locator('#search-show-all')).toBeVisible()

    await page.reload()
    // The pin cookie and the query both restore; a pin hint means the flight
    // EXISTS — the bar must stay open (owner decision #166).
    await page.waitForSelector('#search-show-all', { timeout: 15000 })
    await expect(page.locator('#search-bar')).toBeVisible()
    await expect(page.locator('#search-input')).toHaveValue('123')
  })

  test('typing through a transient 0-match state never closes the bar', async ({ page }) => {
    await openSearch(page)
    await page.fill('#search-input', '45') // BR456
    await page.waitForSelector('#search-results table', { timeout: 8000 })

    await page.fill('#search-input', '457') // no match — but this is typing, not a refresh
    await expect(page.locator('.search-empty')).toBeVisible()
    await expect(page.locator('#search-bar')).toBeVisible()
    await expect(page.locator('#search-results')).toBeVisible()
    // The query survives in the session: the bar was closed by nobody.
    const session = await page.evaluate(() => sessionStorage.getItem('tpe_flight_search'))
    expect(JSON.parse(session)).toEqual({ open: true, q: '457' })
  })

  test('pull-to-refresh with a no-match query closes the bar once data lands', async ({ page }) => {
    const touchSupported = await page.evaluate(() => typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined')
    test.skip(!touchSupported, 'TouchEvent/Touch constructors unavailable in this engine')

    await openSearch(page)
    await page.fill('#search-input', '999')
    await expect(page.locator('.search-empty')).toBeVisible()

    // Same gesture simulation as swr-cache.spec.js: touchstart at scrollY 0,
    // drag past the 200px threshold, release → triggerRefresh() →
    // fetchData({ forceRefresh: true }).
    await page.evaluate(() => {
      const fire = (type, y) => {
        const touch = new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y })
        document.body.dispatchEvent(new TouchEvent(type, { touches: [touch], bubbles: true, cancelable: true }))
      }
      fire('touchstart', 120)
      fire('touchmove', 220)
      fire('touchmove', 360)
      fire('touchend', 360)
    })

    // The forced fetch repaints the board; the armed empty result closes.
    await expect(page.locator('#search-bar')).toBeHidden({ timeout: 15000 })
    await expect(page.locator('#output table tbody tr').first()).toBeVisible()
    const session = await page.evaluate(() => sessionStorage.getItem('tpe_flight_search'))
    expect(session).toBeNull()
  })

  // PR #167 review race: arm-on-forceRefresh must not let the settled check
  // fire against the previous cycle's store contents. Hold the arrivals
  // response back; if the fast departures landing settled the check on the
  // stale arrivals store, the bar would already be closed at the 700ms
  // checkpoint (static fixtures can't catch this otherwise — '999' matches
  // nothing in old and new data alike).
  test('pull-to-refresh waits for the fresh stores before the close decision', async ({ page }) => {
    const touchSupported = await page.evaluate(() => typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined')
    test.skip(!touchSupported, 'TouchEvent/Touch constructors unavailable in this engine')

    const fixture = getMockFlightData()
    const apiUrl = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'
    await page.unroute(apiUrl)
    await page.route(apiUrl, async (route) => {
      const isArrivals = requestAState(route.request()) === 'A'
      if (isArrivals) await new Promise((r) => setTimeout(r, 1500))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixture.map((f) => ({ ...f, AState: isArrivals ? 'A' : 'D' }))),
      })
    })

    await openSearch(page)
    await page.fill('#search-input', '999')
    await expect(page.locator('.search-empty')).toBeVisible()

    await page.evaluate(() => {
      const fire = (type, y) => {
        const touch = new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y })
        document.body.dispatchEvent(new TouchEvent(type, { touches: [touch], bubbles: true, cancelable: true }))
      }
      fire('touchstart', 120)
      fire('touchmove', 220)
      fire('touchmove', 360)
      fire('touchend', 360)
    })

    // Departures fulfils fast; arrivals is held 1500ms. Not settled yet —
    // the bar must still be open here.
    await page.waitForTimeout(700)
    await expect(page.locator('#search-bar')).toBeVisible()
    // Everything lands; the genuinely-empty forced refresh closes.
    await expect(page.locator('#search-bar')).toBeHidden({ timeout: 15000 })
    await expect(page.locator('#output table tbody tr').first()).toBeVisible()
  })
})
