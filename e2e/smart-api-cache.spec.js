import { test, expect } from '@playwright/test'
import { setupSmartApiRoute, waitForApiAndTable, blockGoogleAnalytics } from './test-helpers.js'

// Issue #38: setupSmartApiRoute() used to key its real-API cache on URL
// only, so a departures request and an arrivals request landing in the same
// 30-minute window would be served the same cached blob regardless of which
// AState was actually requested. This suite exercises the fixed per-state
// cache directly. (Every other spec in this repo uses setupMockApiRoute()
// instead, which was already state-aware — this file is the only one
// exercising setupSmartApiRoute() at all.)
//
// The real airport API is unreachable from this development sandbox
// (confirmed: a direct POST returns 403, consistent with a Cloudflare bot
// challenge). Whether CI's local E2E job has outbound access to it is not
// verified here. Either way this test is meaningful: if the real fetch
// succeeds, it asserts the live API honours its own AState request
// parameter; if it fails, setupSmartApiRoute()'s mock-fallback path tags
// AState explicitly, so the assertion holds through that path too.
test.describe('setupSmartApiRoute — issue #38: cache is keyed on AState, not URL alone', () => {
  test('arrival and departure requests each receive a payload tagged for the mode actually requested', async ({ page }) => {
    await blockGoogleAnalytics(page)

    const seenAStates = []
    page.on('response', async (response) => {
      if (response.url() !== 'https://www.taoyuan-airport.com/api/api/flight/a_flight') return
      const body = await response.json().catch(() => null)
      if (Array.isArray(body) && body.length > 0) {
        seenAStates.push(new Set(body.map(flight => flight.AState)))
      }
    })

    await setupSmartApiRoute(page)
    await page.goto('/')
    await waitForApiAndTable(page)

    // Default mode is Arrival — the first payload must be entirely AState 'A'.
    expect(seenAStates.length).toBeGreaterThan(0)
    expect([...seenAStates[0]]).toEqual(['A'])

    await page.click('#flight-mode-toggle')
    await waitForApiAndTable(page)

    // After toggling to Departure, the most recent payload must be entirely
    // AState 'D' — not the arrivals blob served a second time under a
    // URL-only cache key.
    const lastStates = seenAStates[seenAStates.length - 1]
    expect([...lastStates]).toEqual(['D'])
  })

  test('a departures request and an arrivals request landing close together each get their own state, not a shared/null payload', async ({ page }) => {
    // Regression check for the realResponseCaptured-before-realApiCache
    // ordering race noted in issue #38: fire an Arrival load and immediately
    // toggle to Departure, so the two requests' real-fetch (or fallback)
    // promises are in flight close together. Neither response body may be
    // the literal string "null" (the concrete failure mode the race caused),
    // and each must carry its own requested state.
    await blockGoogleAnalytics(page)

    const bodies = []
    page.on('response', async (response) => {
      if (response.url() !== 'https://www.taoyuan-airport.com/api/api/flight/a_flight') return
      bodies.push(await response.text())
    })

    await setupSmartApiRoute(page)
    await page.goto('/')
    await page.waitForSelector('#flight-mode-toggle', { timeout: 5000 })
    await page.click('#flight-mode-toggle')
    await waitForApiAndTable(page)

    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) {
      expect(body).not.toBe('null')
      const parsed = JSON.parse(body)
      expect(Array.isArray(parsed)).toBe(true)
    }
  })
})
