import { test, expect } from '@playwright/test'
import { blockGoogleAnalytics, waitForApiAndTable, getCurrentUTC8Date, requestAState } from './test-helpers.js'

// Issue #39 — fetchData()'s primary fetch had no staleness token of its own,
// unlike the returnLegFetchToken-guarded pairing fetch added for #33. A slow
// pre-toggle fetch resolving after a mode toggle could clobber flightData
// with the previous mode's records ("arrivals rows under departures
// headers"). This spec reproduces that race directly: the initial (Arrival
// mode) fetch is held open, the user toggles to Departures before it
// resolves, and once the stale Arrival response finally lands late, the
// board must still be showing Departures data untouched.
//
// This spec deliberately stays out of playwright.prod.config.js's
// testMatch (production.spec.js only), because the hardcoded 08:00/09:00
// flight times below only survive unfiltered thanks to main.js skipping
// filterFlightsByTime() on localhost. If that testMatch is ever widened to
// include this file, it will fail against the live site for reasons that
// look exactly like a staleness regression but aren't.
test.describe('fetchData() staleness guard (issue #39)', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
  })

  test('a slow pre-toggle fetch must not clobber the board after a mode toggle', async ({ page }) => {
    const date = getCurrentUTC8Date()

    const arrivals = [
      {
        BNO: 1,
        ACode: 'BR',
        AName: '長榮航空',
        FlightNo: '900',
        Gate: 'C1',
        ODate: date,
        OTime: '08:00:00',
        RDate: date,
        RTime: '08:00:00',
        CityCode: 'NRT',
        CityEname: 'Tokyo',
        CityName: '東京',
        Memo: '已到',
        PlaneNo: 'A321-200',
        StopCode: '03',
        flightCode: 'BR900',
      },
    ]

    const departures = [
      {
        BNO: 1,
        ACode: 'CI',
        AName: '中華航空',
        FlightNo: '800',
        Gate: 'D2',
        ODate: date,
        OTime: '09:00:00',
        RDate: date,
        RTime: '09:00:00',
        CityCode: 'HKG',
        CityEname: 'Hong Kong',
        CityName: '香港',
        Memo: '已登機',
        PlaneNo: 'A321-100',
        StopCode: '04',
        flightCode: 'CI800',
      },
    ]

    let arrivalRequestCount = 0
    let resolveStaleResponse
    const staleResponseSettled = new Promise((resolve) => { resolveStaleResponse = resolve })

    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      const mode = requestAState(route.request())

      // Only the very first Arrival request (the initial, pre-toggle board
      // fetch) is held open. A later Arrival request would be the
      // departures-mode return-leg pairing fetch (#33), which must not be
      // delayed here — this spec is about the *primary* fetch's staleness,
      // not the pairing fetch's (already guarded by returnLegFetchToken).
      const isStalePreToggleFetch = mode === 'A' && arrivalRequestCount === 0
      if (mode === 'A') arrivalRequestCount += 1
      if (isStalePreToggleFetch) {
        await new Promise((r) => setTimeout(r, 1500))
      }

      const sourceData = mode === 'D' ? departures : arrivals
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(sourceData.map((flight) => ({ ...flight, AState: mode }))),
      })

      if (isStalePreToggleFetch) resolveStaleResponse()
    })

    await page.goto('/')

    // The toggle button is part of the static shell rendered before
    // fetchData() resolves, so it's clickable immediately — no wait for the
    // (deliberately slow) initial Arrival fetch.
    await page.click('#flight-mode-toggle')
    await waitForApiAndTable(page)

    // Departures board must be up before the stale Arrival response lands.
    await expect(page.locator('tbody tr', { hasText: 'CI800' })).toBeVisible()

    // Let the held-open, superseded Arrival response resolve.
    await staleResponseSettled

    // Without the mainFetchToken guard, the stale .then() would call
    // processFetchedData() and repaint synchronously in the same task the
    // response body lands in — there's no later microtask/macrotask gap to
    // poll for instead. 300ms is generous headroom past that single task,
    // enough that the toHaveCount(0) assertion below isn't just passing
    // because the (hypothetical, unguarded) repaint hasn't run yet. This is
    // the only hard sleep in e2e/ — every other spec relies on Playwright's
    // auto-waiting instead.
    await page.waitForTimeout(300)
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toHaveCount(0)
    await expect(page.locator('tbody tr', { hasText: 'CI800' })).toBeVisible()
  })
})
