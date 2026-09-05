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
import { setupMockApiRoute, getMockFlightData, blockGoogleAnalytics } from './test-helpers.js'

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
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })
  })

  test('searching a flight number takes over the board and shows gate + carousel', async ({ page }) => {
    await openSearch(page)
    await searchFor(page, '35')

    // Takeover: the board and the filter rows are hidden, results are shown
    // in the board's slot as a real table.
    await expect(page.locator('#output')).toBeHidden()
    await expect(page.locator('#flightButtons')).toBeHidden()

    // BR35 arrival: carousel 05, and the board's Gate column also renders.
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
    await expect(page.locator('#search-input')).toHaveAttribute('placeholder', /BR178/)
  })
})
