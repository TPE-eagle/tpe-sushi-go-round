// Issue #142 — cross-day quick-dial search.
//
// From 16:00 UTC+8 a search lazily fetches tomorrow's full-day payload (both
// directions) and interleaves the results: today's block first, tomorrow's
// rows appended with a "明日/Tomorrow" chip. The gate itself is unit-tested
// (src/test/nextday.test.js); this spec covers the wiring end to end with an
// ODate-aware mock (test-helpers.js setupODateAwareMockRoute) and a frozen
// page clock, because on localhost the board is full-day and the gate depends
// on the wall clock.
import { test, expect } from '@playwright/test'
import { setupODateAwareMockRoute, blockGoogleAnalytics } from './test-helpers.js'

// A UTC instant whose UTC+8 wall clock is TODAY at hour:minute. Freezing the
// page clock on today keeps the node-side fixture dates (computed from the
// real clock) consistent with the page's Date.now().
function fixedAtUtc8(hour, minute) {
  const nowUtc8 = new Date(Date.now() + 8 * 3600 * 1000)
  const midnightUtc8 = Date.UTC(nowUtc8.getUTCFullYear(), nowUtc8.getUTCMonth(), nowUtc8.getUTCDate())
  return new Date(midnightUtc8 + hour * 3600 * 1000 + minute * 60 * 1000 - 8 * 3600 * 1000)
}

function utc8Date(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, '/')
}

// Deterministic stores. BR178 exists on BOTH days (the owner-mandated
// dual-row case: 22:50 searching "178" must see today 23:30 AND tomorrow
// 06:00, not have one guessed away). The tomorrow payload carries a #67-style
// marketing-carrier duplicate (B7/178 same FlightNo/OTime/CityCode) and a
// neighbour-day stray (ODate 2000/01/01) — both must be filtered at
// ingestion. CI124 is cancelled tomorrow — chips are orthogonal.
function rowsFor(dateStr, state) {
  if (dateStr === utc8Date(0)) {
    // Boot is always arrivals mode, and the spec waits for the board table
    // before opening search — today's arrivals must not be empty (an empty
    // board here is what kept every test in this file red, PR review
    // 2026-09-13: waitForSelector('#output table tbody tr') could never
    // pass). BR100 doesn't match the '178' query, so search assertions are
    // unaffected.
    return state === 'A'
      ? [
          { ACode: 'BR', FlightNo: '100', Gate: 'C1', OTime: '17:40:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 3, Memo: '' }
        ]
      : [
          { ACode: 'BR', FlightNo: '178', Gate: 'C3', OTime: '23:30:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 1, Memo: '' },
          { ACode: 'CI', FlightNo: '124', Gate: 'A5', OTime: '22:10:00', CityCode: 'HKG', CityEname: 'Hong Kong', CityName: '香港', BNO: 1, Memo: '' }
        ]
  }
  if (dateStr === utc8Date(1)) {
    return state === 'A'
      ? [
          { ACode: 'BR', FlightNo: '178', Gate: '', OTime: '06:15:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 2, Memo: '' }
        ]
      : [
          { ACode: 'BR', FlightNo: '178', Gate: '', OTime: '06:00:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 1, Memo: '' },
          { ACode: 'B7', FlightNo: '178', Gate: '', OTime: '06:00:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 1, Memo: '' },
          { ACode: 'CI', FlightNo: '124', Gate: 'B2', OTime: '07:15:00', CityCode: 'HKG', CityEname: 'Hong Kong', CityName: '香港', BNO: 1, Memo: '取消' },
          { ACode: 'JX', FlightNo: '800', Gate: '', OTime: '05:30:00', CityCode: 'KIX', CityEname: 'Osaka', CityName: '大阪', BNO: 2, Memo: '', ODate: '2000/01/01' }
        ]
  }
  return []
}

async function openAndSearch(page, query) {
  await page.click('#search-toggle')
  await page.waitForSelector('#search-bar:not([hidden])', { timeout: 8000 })
  await page.fill('#search-input', query)
  await page.waitForSelector('#search-results table', { timeout: 8000 })
}

test.describe('Next-day quick-dial search (issue #142)', () => {
  // The assertions below expect the zh chip copy ("明日" / "已取消"); pin the
  // context locale so the app boots in zh regardless of the runner's default
  // (en-US made the chips render in English and every chip assertion fail).
  test.use({ locale: 'zh-TW' })

  test.beforeEach(async ({ page }) => {
    blockGoogleAnalytics(page)
  })

  test('after 16:00 UTC+8: tomorrow rows load, today renders first, tomorrow rows carry the chip, duplicates collapse', async ({ page }) => {
    const requests = await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(17, 30))
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })

    await openAndSearch(page, '178')

    // Both next-day legs were requested (A + D for tomorrow's ODate).
    await expect.poll(() =>
      requests.filter(r => r.ODate === utc8Date(1)).map(r => r.AState).sort().join(',')
    ).toBe('A,D')

    // Departures table: today's BR178 first (no chip), tomorrow's BR178
    // second (chip). Exactly two rows — the B7 marketing-carrier duplicate
    // collapsed at ingestion.
    const depTable = page.locator('#search-results table').nth(1)
    const depRows = depTable.locator('tbody tr')
    await expect(depRows).toHaveCount(2)
    await expect(depRows.nth(0)).toContainText('BR178')
    await expect(depRows.nth(0)).not.toContainText('明日')
    await expect(depRows.nth(1)).toContainText('BR178')
    await expect(depRows.nth(1)).toContainText('明日')

    // Arrivals table: tomorrow's BR178 arrival with the chip.
    const arrTable = page.locator('#search-results table').nth(0)
    const arrRows = arrTable.locator('tbody tr')
    await expect(arrRows).toHaveCount(1)
    await expect(arrRows.nth(0)).toContainText('BR178')
    await expect(arrRows.nth(0)).toContainText('明日')
  })

  test('same flight number on both days shows both rows (dual-row case)', async ({ page }) => {
    await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(22, 50))
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })

    await openAndSearch(page, '178')

    // Both tables render (tomorrow's BR178 arrival also matches); the
    // departures table is last and holds today's + tomorrow's BR178.
    const depRows = page.locator('#search-results table').last().locator('tbody tr')
    await expect(depRows).toHaveCount(2)
    await expect(depRows.nth(1)).toContainText('明日')
  })

  test('cancelled tomorrow row keeps both chips (state and day are orthogonal)', async ({ page }) => {
    await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(17, 30))
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })

    await openAndSearch(page, '124')

    // "124" has no arrival matches — only the departures table renders.
    const depRows = page.locator('#search-results table').last().locator('tbody tr')
    await expect(depRows).toHaveCount(2)
    await expect(depRows.nth(0)).toContainText('CI124')
    await expect(depRows.nth(1)).toContainText('已取消')
    await expect(depRows.nth(1)).toContainText('明日')
  })

  test('before 16:00 UTC+8: no next-day request goes out and no chip renders', async ({ page }) => {
    const requests = await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(15, 59))
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })

    await openAndSearch(page, '178')

    // Give any (wrong) next-day request a moment to show up.
    await page.waitForTimeout(1500)
    expect(requests.every(r => r.ODate === utc8Date(0))).toBe(true)

    // Only the departures table renders (no next-day arrivals loaded).
    const depRows = page.locator('#search-results table').last().locator('tbody tr')
    await expect(depRows).toHaveCount(1)
    await expect(depRows.nth(0)).toContainText('BR178')
    await expect(depRows.nth(0)).not.toContainText('明日')
  })

  test('tomorrow fetch failure: today results stay up, wording stays today-only, no error UI', async ({ page }) => {
    const failing = (dateStr, state) => (dateStr === utc8Date(1) ? { status: 500 } : rowsFor(dateStr, state))
    const requests = await setupODateAwareMockRoute(page, failing)
    await page.clock.setFixedTime(fixedAtUtc8(17, 30))
    await page.goto('')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })

    await openAndSearch(page, '178')

    // The failed requests actually went out...
    await expect.poll(() =>
      requests.filter(r => r.ODate === utc8Date(1)).length
    ).toBeGreaterThan(0)
    // ...but search stays today-only, no chip, board intact. Only the
    // departures table renders (no next-day arrivals loaded).
    const depRows = page.locator('#search-results table').last().locator('tbody tr')
    await expect(depRows).toHaveCount(1)
    await expect(depRows.nth(0)).not.toContainText('明日')

    // No-match wording must NOT claim "today or tomorrow" for a day we
    // haven't seen: today-only wording (zh default) shows instead.
    await page.fill('#search-input', '999')
    await expect(page.locator('.search-empty')).toContainText('只查得到當天航班')
    // And the search UI itself never crashed.
    await expect(page.locator('#search-results')).toBeVisible()
  })
})
