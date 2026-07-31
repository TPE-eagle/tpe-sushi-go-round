import { test, expect } from '@playwright/test'
import { setupMockApiRoute, waitForApiAndTable, blockGoogleAnalytics, getCurrentUTC8Date } from './test-helpers.js'

// Issue #40 item 5 — end-to-end coverage for the departures return-gate
// column (issue #33). setupMockApiRoute() re-tags one shared baseData list
// per AState by default, so the departures request and the non-blocking
// AState=A pairing fetch (#33) would otherwise see an identical flight set —
// a departure can never pair with a return leg that is, by construction,
// itself. This spec supplies a distinct `arrivalsMockData` (test-helpers.js
// #40 item 5) so the pairing fetch sees genuinely different records.
test.describe('Departures return-gate column (issue #33)', () => {
  test.beforeEach(async ({ page }) => {
    await blockGoogleAnalytics(page)
  })

  test('a paired return leg renders "← <flight> <gate>"; a dayReturn-override city stays blank', async ({ page }) => {
    const date = getCurrentUTC8Date()

    // Departures list (served for AState='D').
    const departures = [
      {
        // CI/NRT is not in either dayReturn override list -> the pairing
        // below must actually render.
        id: `${date.replace(/\//g, '')}_D_CI122`,
        BNO: 1,
        ACode: 'CI',
        AName: '中華航空',
        FlightNo: '122',
        Gate: 'D1',
        ODate: date,
        OTime: '08:00:00',
        RDate: date,
        RTime: '08:00:00',
        CityCode: 'NRT',
        CityEname: 'Tokyo',
        CityName: '東京',
        Memo: '已登機',
        PlaneNo: 'A321-200',
        StopCode: '02',
        flightCode: 'CI122',
      },
      {
        // BR/BKK IS in DAY_RETURN_FALSE_BY_AIRLINE (EVA's Bangkok turn is a
        // night stop) -> must stay blank even though a plausible same-day
        // pairing exists in the arrivals list below.
        id: `${date.replace(/\//g, '')}_D_BR205`,
        BNO: 1,
        ACode: 'BR',
        AName: '長榮航空',
        FlightNo: '205',
        Gate: 'C3',
        ODate: date,
        OTime: '09:00:00',
        RDate: date,
        RTime: '09:00:00',
        CityCode: 'BKK',
        CityEname: 'Bangkok',
        CityName: '曼谷',
        Memo: '已登機',
        PlaneNo: 'A321-100',
        StopCode: '05',
        flightCode: 'BR205',
      },
    ]

    // Arrivals list (served only for AState='A', i.e. the return-leg pairing
    // fetch while in departures mode — see test-helpers.js's setupMockApiRoute).
    const arrivals = [
      {
        // Pairs with CI122: same ACode/CityCode/ODate, same aircraft family
        // (A321), |ΔFlightNo|==1, gap 480min is inside NRT's plausible
        // window [2*195+40, 2*195+240] = [430, 630].
        id: `${date.replace(/\//g, '')}_A_CI123`,
        BNO: 1,
        ACode: 'CI',
        AName: '中華航空',
        FlightNo: '123',
        Gate: 'D5',
        ODate: date,
        OTime: '16:00:00',
        RDate: date,
        RTime: '16:00:00',
        CityCode: 'NRT',
        CityEname: 'Tokyo',
        CityName: '東京',
        Memo: '已到',
        PlaneNo: 'A321-271N',
        StopCode: '02',
        flightCode: 'CI123',
      },
      {
        // Plausible pairing with BR205 (gap 500min, inside BKK's [470, 670]
        // window) -- the row must stay blank anyway because of the
        // dayReturn override, not because this candidate fails findReturnLeg().
        id: `${date.replace(/\//g, '')}_A_BR206`,
        BNO: 1,
        ACode: 'BR',
        AName: '長榮航空',
        FlightNo: '206',
        Gate: 'C7',
        ODate: date,
        OTime: '17:20:00',
        RDate: date,
        RTime: '17:20:00',
        CityCode: 'BKK',
        CityEname: 'Bangkok',
        CityName: '曼谷',
        Memo: '已到',
        PlaneNo: 'A321-100',
        StopCode: '05',
        flightCode: 'BR206',
      },
    ]

    await setupMockApiRoute(page, departures, arrivals)
    await page.goto('/')
    await waitForApiAndTable(page)

    await page.click('#flight-mode-toggle')
    await waitForApiAndTable(page)

    const ci122Row = page.locator('tbody tr', { hasText: 'CI122' })
    await expect(ci122Row.locator('.return-gate-cell')).toBeVisible({ timeout: 5000 })
    await expect(ci122Row.locator('.return-gate-cell')).toContainText('CI123')
    await expect(ci122Row.locator('.return-gate-cell')).toContainText('D5')

    const br205Row = page.locator('tbody tr', { hasText: 'BR205' })
    await expect(br205Row.locator('.return-gate-cell')).toHaveCount(0)
  })
})
