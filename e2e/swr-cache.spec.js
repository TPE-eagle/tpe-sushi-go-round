import { test, expect } from '@playwright/test'
import { blockGoogleAnalytics, getCurrentUTC8Date } from './test-helpers.js'

// Issue #141 — SWR cache behaviour. These specs opt into the SWR cache with
// `?e2e-swr=1` (the localhost test host otherwise disables cache reads and
// writes so every other spec stays deterministic): seed the cache with one
// cold load, then reload and verify the board paints from the cache before
// the network answers, keeps standing when the revalidation fails, and that
// pull-to-refresh (forceRefresh) still issues a real POST.

const FLIGHT_API = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'

function flightsFixture(date) {
  return [
    {
      BNO: 1,
      ACode: 'BR',
      AName: 'EVA Air',
      FlightNo: '900',
      Gate: 'C1',
      ODate: date,
      OTime: '08:00:00',
      RDate: date,
      RTime: '08:00:00',
      CityCode: 'NRT',
      CityEname: 'Tokyo',
      CityName: 'Tokyo',
      Memo: '',
      PlaneNo: 'A321-200',
      StopCode: '03',
      flightCode: 'BR900',
      AState: 'A',
    },
  ]
}

function fulfillFlights(route, date) {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(flightsFixture(date)),
  })
}

async function seedCacheViaColdLoad(page) {
  const date = getCurrentUTC8Date()
  let requests = 0
  await page.route(FLIGHT_API, async (route) => {
    requests += 1
    await fulfillFlights(route, date)
  })
  await page.goto('/?e2e-swr=1')
  await page.waitForSelector('table')
  await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible()
  // The cold load must have issued exactly one real POST and cached it.
  expect(requests).toBe(1)
  return { requestsSoFar: requests }
}

test.describe('SWR cache-first board (issue #141)', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
  })

  // Reproduces the exact cache key main.js builds for the boot POST
  // (arrivals mode, English, null window fields), so the specs can seed
  // and inspect localStorage without a round trip through the app.
  function expectedCacheKey(date) {
    const postData = {
      ODate: date,
      OTimeOpen: null,
      OTimeClose: null,
      BNO: null,
      AState: 'A',
      language: 'en',
      keyword: '',
    }
    return `flight_data_${JSON.stringify(postData)}`
  }

  test('cache-first paint beats the network; revalidation swaps in silently', async ({ page }) => {
    const date = getCurrentUTC8Date()
    await seedCacheViaColdLoad(page)

    // Second load: hold the API response open long enough to prove the
    // board comes from the cache, not the (pending) fetch.
    let secondSettled
    const revalidationLanded = new Promise((resolve) => { secondSettled = resolve })
    let reloadRequests = 0
    await page.unroute(FLIGHT_API)
    await page.route(FLIGHT_API, async (route) => {
      reloadRequests += 1
      await new Promise((r) => setTimeout(r, 4000))
      await fulfillFlights(route, date)
      secondSettled()
    })

    await page.goto('/?e2e-swr=1')

    // The cached board must be up while the network request is still held
    // open, with the "updating" indicator showing behind it.
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible({ timeout: 3000 })
    await expect(page.locator('#swr-status')).toBeVisible()
    await expect(page.locator('#swr-status')).toHaveText('🔄 Updating...')
    // A real POST was still issued behind the cached paint (SWR, not a
    // cache-only read).
    expect(reloadRequests).toBe(1)

    // Issue #149 — the capsule overlay must never shift the page: #output's
    // position is identical while the indicator is visible vs after it hides
    // (the original in-flow strip pushed the whole page down on every update).
    const outputTopWhileUpdating = await page.evaluate(() =>
      document.getElementById('output').getBoundingClientRect().top
    )

    // When the revalidation lands, the board swaps silently: same rows, no
    // error, indicator cleared.
    await revalidationLanded
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible()
    await expect(page.locator('#swr-status')).toBeHidden()
    const outputTopAfterSwap = await page.evaluate(() =>
      document.getElementById('output').getBoundingClientRect().top
    )
    expect(outputTopAfterSwap).toBe(outputTopWhileUpdating)
  })

  test('failed revalidation keeps the cached board and labels its age', async ({ page }) => {
    const date = getCurrentUTC8Date()
    await seedCacheViaColdLoad(page)

    await page.unroute(FLIGHT_API)
    await page.route(FLIGHT_API, (route) => route.abort())

    await page.goto('/?e2e-swr=1')

    // The cached paint stands; no error panel.
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible({ timeout: 3000 })
    await expect(page.locator('#output .empty-state')).toHaveCount(0)
    // Staleness note instead: age is 0 minutes (just cached).
    await expect(page.locator('#swr-status')).toBeVisible()
    await expect(page.locator('#swr-status')).toHaveText('Showing data from 0 min ago')
  })

  test('seeds and honours the 30-minute window on the real cache entry', async ({ page }) => {
    const date = getCurrentUTC8Date()
    await seedCacheViaColdLoad(page)

    const key = expectedCacheKey(date)
    const entry = await page.evaluate((cacheKey) => {
      const raw = localStorage.getItem(cacheKey)
      return raw ? JSON.parse(raw) : null
    }, key)
    expect(entry, 'cold load should have written the SWR cache entry').not.toBeNull()
    expect(Array.isArray(entry.data)).toBe(true)
    expect(typeof entry.timestamp).toBe('number')

    // Rewrite the entry as older than SWR_MAX_AGE_MS (30 min): online, the
    // board must fall back to the cold "loading" path instead of painting
    // the stale entry.
    await page.evaluate(([cacheKey, ts]) => {
      const raw = JSON.parse(localStorage.getItem(cacheKey))
      raw.timestamp = ts
      localStorage.setItem(cacheKey, JSON.stringify(raw))
    }, [key, Date.now() - 31 * 60 * 1000])

    let reloadRequests = 0
    await page.unroute(FLIGHT_API)
    await page.route(FLIGHT_API, async (route) => {
      reloadRequests += 1
      await new Promise((r) => setTimeout(r, 1500))
      await fulfillFlights(route, date)
    })

    await page.goto('/?e2e-swr=1')

    // Stale entry: no immediate paint from cache — the loading state (and
    // only it) is visible until the fetch resolves.
    await expect(page.locator('#swr-status')).toBeHidden({ timeout: 1000 })
    const earlyBody = await page.locator('#output').textContent()
    expect(earlyBody).not.toContain('BR900')
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible({ timeout: 10000 })
    expect(reloadRequests).toBe(1)
  })

  test('pull-to-refresh force-refreshes: real POST even with fresh cache', async ({ page }) => {
    const date = getCurrentUTC8Date()
    await seedCacheViaColdLoad(page)

    let reloadRequests = 0
    await page.unroute(FLIGHT_API)
    await page.route(FLIGHT_API, async (route) => {
      reloadRequests += 1
      await new Promise((r) => setTimeout(r, 1200))
      await fulfillFlights(route, date)
    })

    await page.goto('/?e2e-swr=1')
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible()
    const requestsBeforePull = reloadRequests // includes the boot revalidation POST

    const touchSupported = await page.evaluate(() => typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined')
    test.skip(!touchSupported, 'TouchEvent/Touch constructors unavailable in this engine')

    // Simulate the pull gesture: touchstart at scrollY 0, drag past the
    // 200px threshold, release → triggerRefresh() → fetchData({forceRefresh}).
    // Dispatch on a real element — the listeners read event.target.closest(),
    // and a Document target would throw there.
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

    // The refreshing pill shows while the forced fetch is in flight…
    await expect(page.locator('#refresh-icon.refreshing')).toBeVisible({ timeout: 3000 })
    // …and a real POST went out even though a fresh cache entry existed.
    await expect.poll(() => reloadRequests, { timeout: 8000 }).toBeGreaterThan(requestsBeforePull)

    // The board was never blanked; data still there after the swap.
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible()
    await expect(page.locator('#output .empty-state')).toHaveCount(0)
  })

  test('failed forced refresh keeps the board and shows the error on the strip (review 🟡)', async ({ page }) => {
    const date = getCurrentUTC8Date()
    await seedCacheViaColdLoad(page)

    // Boot revalidation succeeds; every later request (the forced one) aborts.
    let requestCount = 0
    await page.unroute(FLIGHT_API)
    await page.route(FLIGHT_API, async (route) => {
      requestCount += 1
      if (requestCount === 1) {
        await fulfillFlights(route, date)
        return
      }
      await route.abort()
    })

    await page.goto('/?e2e-swr=1')
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible()

    const touchSupported = await page.evaluate(() => typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined')
    test.skip(!touchSupported, 'TouchEvent/Touch constructors unavailable in this engine')
    // Dispatch on a real element — the listeners read event.target.closest(),
    // and a Document target would throw there.
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

    // The forced POST went out and failed: the board stays (it was never
    // blanked), and the failure is visible on the strip even with search
    // closed — not silent (review 5654143885, 🟡).
    await expect.poll(() => requestCount, { timeout: 8000 }).toBe(2)
    await expect(page.locator('tbody tr', { hasText: 'BR900' })).toBeVisible()
    await expect(page.locator('#output .empty-state')).toHaveCount(0)
    await expect(page.locator('#swr-status')).toBeVisible()
    await expect(page.locator('#swr-status')).toHaveText('Query failed, please try again later.')
  })
})
