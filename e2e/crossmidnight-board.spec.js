import { test, expect } from '@playwright/test'
import { setupODateAwareMockRoute, blockGoogleAnalytics, getCurrentUTC8Date } from './test-helpers.js'

// Issue #145 — the board window (+8h at night) legally reaches into
// tomorrow's early hours: tomorrow rows render chip-marked AFTER today's
// block, the apiParams end label carries the actual date, and the A↔D
// toggle fast-path renders a <2-min-old cache with zero network requests.
// The fixture is ODate-aware (setupODateAwareMockRoute) and the page clock
// is frozen so the crossing is deterministic at any real-world hour.

const FLIGHT_API = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'

function fixedAtUtc8(hour, minute) {
  const nowUtc8 = new Date(Date.now() + 8 * 3600 * 1000)
  const midnightUtc8 = Date.UTC(nowUtc8.getUTCFullYear(), nowUtc8.getUTCMonth(), nowUtc8.getUTCDate())
  return new Date(midnightUtc8 + hour * 3600 * 1000 + minute * 60 * 1000 - 8 * 3600 * 1000)
}

function utc8Date(offsetDays = 0) {
  return new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400 * 1000)
    .toISOString().slice(0, 10).replace(/-/g, '/')
}

function rowsFor(dateStr, state) {
  if (dateStr === utc8Date(0)) {
    return state === 'A'
      ? [
          { ACode: 'BR', FlightNo: '900', Gate: 'C1', OTime: '22:00:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 1, Memo: '' },
          { ACode: 'CI', FlightNo: '800', Gate: 'D2', OTime: '23:10:00', CityCode: 'HND', CityEname: 'Tokyo', CityName: '東京', BNO: 2, Memo: '' }
        ]
      : [{ ACode: 'BR', FlightNo: '910', Gate: 'C3', OTime: '23:30:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 1, Memo: '' }]
  }
  if (dateStr === utc8Date(1)) {
    return state === 'A'
      ? [
          { ACode: 'BR', FlightNo: '901', Gate: '', OTime: '03:00:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 2, Memo: '' },
          { ACode: 'CI', FlightNo: '801', Gate: '', OTime: '03:20:00', CityCode: 'HND', CityEname: 'Tokyo', CityName: '東京', BNO: 2, Memo: '' }
        ]
      : [{ ACode: 'BR', FlightNo: '911', Gate: '', OTime: '03:10:00', CityCode: 'NRT', CityEname: 'Tokyo', CityName: '東京', BNO: 1, Memo: '' }]
  }
  return []
}

test.describe('Cross-midnight board (issue #145)', () => {
  // Chip assertions expect the zh copy ("明日"); pin the locale so the app
  // boots in zh regardless of the runner default.
  test.use({ locale: 'zh-TW' })

  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
    // +8h window at a frozen 22:30 UTC+8: the window reaches 06:30 next day.
    await page.addInitScript(() => {
      document.cookie = 'ForwardHours=8; path=/; max-age=34560000'
    })
  })

  test('board renders tomorrow rows chip-marked after today, and the apiParams end carries the date', async ({ page }) => {
    const requests = await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(22, 30))
    await page.goto('/?e2e-swr=1')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })

    // The boot cycle fetched tomorrow's arrivals for the board (today's A
    // + tomorrow's A; the board only pulls its own direction).
    await expect.poll(() =>
      requests.filter(r => r.ODate === utc8Date(1)).map(r => r.AState)
    ).toContain('A')

    // Today's rows first (unchipped), tomorrow's rows after, each chip-marked.
    const rows = page.locator('#output table tbody tr')
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toContainText('BR900')
    await expect(rows.nth(0)).not.toContainText('明日')
    await expect(rows.nth(2)).toContainText('BR901')
    await expect(rows.nth(2)).toContainText('明日')
    await expect(rows.nth(3)).toContainText('CI801')
    await expect(rows.nth(3)).toContainText('明日')
    // Missing carousel (StopCode) renders BLANK, never the string "undefined".
    await expect(rows.nth(2).locator('td').last()).toHaveText('')
    // Feedback — the chip sits INLINE beside the flight number (same text
    // line): a block chip would drop below it and double the row height.
    const chipBox = await rows.nth(2).locator('.status-chip').boundingBox()
    const numBox = await rows.nth(2).locator('td').first().boundingBox()
    expect(chipBox.y).toBeLessThan(numBox.y + numBox.height / 2)

    // The window-end label carries the actual date once the window crosses
    // midnight (no bare ambiguous HH:MM, no engineering notation).
    await expect(page.locator('#apiParams')).toContainText(utc8Date(1).slice(5))
  })

  test('A→D→A toggles within the skip window issue zero extra network requests', async ({ page }) => {
    // Issue #149-precedent — the boundary phase advances the frozen clock
    // and waits out real settle windows, exceeding the default 10s budget.
    test.slow()
    const requests = await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(22, 30))
    await page.goto('/?e2e-swr=1')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })
    // Boot A fetch + tomorrow-A fetch settle before counting.
    await page.waitForTimeout(1500)

    // Toggle to D: a full cycle runs (D main fetch + D pairing/next-day).
    await page.click('#flight-mode-toggle')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })
    await page.waitForTimeout(1500)
    const countAfterD = requests.length
    expect(countAfterD).toBeGreaterThan(0)

    // Toggle back to A within SWR_TOGGLE_SKIP_MS: the fast path must not
    // issue ANY request (main, pairing or next-day) — counted at the route
    // handler, so every a_flight call is seen.
    await page.click('#flight-mode-toggle')
    await page.waitForTimeout(1500)
    expect(requests.length).toBe(countAfterD)

    // The board came back as arrivals, served from the fresh cache.
    await expect(page.locator('#output table tbody tr').first()).toContainText('BR900')

    // Past SWR_TOGGLE_SKIP_MS (advance the frozen clock 3 min): the toggle
    // falls through to the SWR cycle and a real revalidation goes out —
    // pins the boundary between the fast path and the SWR path.
    await page.clock.setFixedTime(fixedAtUtc8(22, 33))
    await page.click('#flight-mode-toggle')
    await expect.poll(() => requests.length, { timeout: 8000 }).toBeGreaterThan(countAfterD)
    await expect(page.locator('#output table tbody tr').first()).toContainText('BR910')
  })

  test('a +2h window at mid-day never crosses: no tomorrow request, no date label', async ({ page }) => {
    await page.addInitScript(() => {
      document.cookie = 'ForwardHours=2; path=/; max-age=34560000'
    })
    const requests = await setupODateAwareMockRoute(page, rowsFor)
    await page.clock.setFixedTime(fixedAtUtc8(10, 0))
    await page.goto('/?e2e-swr=1')
    await page.waitForSelector('#output table tbody tr', { timeout: 15000 })
    await page.waitForTimeout(1000)

    expect(requests.filter(r => r.ODate === utc8Date(1))).toHaveLength(0)
    // Only today's in-window rows render; tomorrow rows (if any leaked) would
    // carry the chip.
    await expect(page.locator('#output')).not.toContainText('明日')
  })
})
