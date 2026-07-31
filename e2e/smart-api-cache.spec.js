import { test, expect } from '@playwright/test'
import { setupSmartApiRoute, waitForApiAndTable, blockGoogleAnalytics, getMockFlightData, __resetSmartApiCache } from './test-helpers.js'

const FLIGHT_API = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'

// Issue #38: setupSmartApiRoute() used to key its real-API cache on URL
// only, so a departures request and an arrivals request landing in the same
// 30-minute window would be served the same cached blob regardless of which
// AState was actually requested. This suite exercises the fixed per-state
// cache directly. (Every other spec in this repo uses setupMockApiRoute()
// instead, which was already state-aware — this file is the only one
// exercising setupSmartApiRoute() at all.)
//
// Neither test below touches the real airport API. Both supply a
// `fetchUpstream` fixture instead (issue #38 review R3): this file runs in
// the merge gate (`e2e-tests-local`), and a required check must not depend
// on a third party's availability, nor on an unverified assumption about
// its response shape. `setupSmartApiRoute`'s default `fetchUpstream` (a
// real `route.fetch()`) is exercised by production usage of the function,
// not by this spec.
test.describe('setupSmartApiRoute — issue #38: cache is keyed on AState, not URL alone', () => {
  test.beforeEach(() => {
    // Module-level cache survives across tests in one worker; a cold cache
    // per test keeps each one independent of execution order.
    __resetSmartApiCache()
  })

  function fixtureFetchUpstream() {
    return async (_route, state) => ({
      status: 200,
      body: JSON.stringify(getMockFlightData().map(flight => ({ ...flight, AState: state })))
    })
  }

  test('arrival and departure requests each receive a payload tagged for the mode actually requested', async ({ page }) => {
    await blockGoogleAnalytics(page)

    // Correlate each response with the request that produced it, not with
    // array position (issue #38 review R2): the page.on('response') handler
    // is async, so push order isn't guaranteed to match request order, and
    // once the departures-mode pairing fetch (PR #35) lands, one departures
    // cycle issues two requests — "the last response" stops meaning
    // "the response to the request we just made".
    const seen = []
    page.on('response', async (response) => {
      if (response.url() !== FLIGHT_API) return
      const asked = response.request().postDataJSON()?.AState ?? 'A'
      const body = await response.json().catch(() => null)
      if (Array.isArray(body) && body.length > 0) {
        seen.push({ asked, got: [...new Set(body.map(flight => flight.AState))] })
      }
    })

    await setupSmartApiRoute(page, { fetchUpstream: fixtureFetchUpstream() })
    await page.goto('/')
    await waitForApiAndTable(page)

    // Default mode is Arrival — the response to the arrival request must be
    // entirely AState 'A'.
    await expect.poll(() => seen.some(s => s.asked === 'A')).toBe(true)
    expect(seen.filter(s => s.asked === 'A').map(s => s.got)).toEqual([['A']])

    await page.click('#flight-mode-toggle')
    await waitForApiAndTable(page)

    // The response to the departure request must be entirely AState 'D' —
    // not the arrivals blob served a second time under a URL-only cache key.
    await expect.poll(() => seen.some(s => s.asked === 'D')).toBe(true)
    expect(seen.filter(s => s.asked === 'D').map(s => s.got)).toEqual([['D']])
  })

  test('a second same-state request arriving while the first is still in flight shares the one real call instead of racing it — fails without the inFlightFetch dedup (issue #38)', async ({ page }) => {
    // Regression check for the realResponseCaptured-before-realApiCache
    // ordering race noted in issue #38: the old code set its "captured"
    // flag before the cache was assigned, so a concurrent request for the
    // same state could be fulfilled with the literal string "null" instead
    // of awaiting the one real fetch already in progress.
    //
    // An A-then-D toggle (the shape the previous version of this test used)
    // cannot reach this bug at all: the race needs two requests for the
    // *same* state concurrent on one page's handler, and A and D are
    // different states with independent inFlightFetch slots. This version
    // gates the upstream response on a promise the test controls, so the
    // second same-state request is provably still in flight when it lands
    // — not hoping a timer wins a race against page-load latency.
    await blockGoogleAnalytics(page)

    let releaseA
    const gate = new Promise(resolve => { releaseA = resolve })
    const callsByState = { A: 0, D: 0 }
    const fetchUpstream = async (_route, state) => {
      callsByState[state]++
      if (state === 'A') await gate
      return {
        status: 200,
        body: JSON.stringify(getMockFlightData().map(flight => ({ ...flight, AState: state })))
      }
    }

    const bodies = []
    page.on('response', async (response) => {
      if (response.url() !== FLIGHT_API) return
      bodies.push(await response.text())
    })

    await setupSmartApiRoute(page, { fetchUpstream })
    const navigation = page.goto('/') // fires the first AState=A request; gated, stays in flight

    await expect.poll(() => callsByState.A).toBe(1)
    await page.waitForSelector('#flight-mode-toggle', { timeout: 5000 })
    await page.click('#flight-mode-toggle') // -> D, unrelated state, resolves immediately
    await expect.poll(() => callsByState.D).toBe(1)
    await page.click('#flight-mode-toggle') // -> A again, second A request while the first is still gated

    // Give the second click's fetch a moment to reach the route handler.
    // This is not what makes the test deterministic (the gate promise is) —
    // it only lets the in-process call register before asserting it didn't
    // start a second upstream fetch.
    await page.waitForTimeout(100)
    expect(callsByState.A).toBe(1) // second A request awaited the shared in-flight promise, not a fetch of its own

    releaseA()
    await navigation
    await waitForApiAndTable(page)

    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body).not.toBe('null')
      const parsed = JSON.parse(body)
      expect(Array.isArray(parsed)).toBe(true)
    }
  })
})
