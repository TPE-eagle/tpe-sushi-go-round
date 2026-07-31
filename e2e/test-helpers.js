// Helper functions for E2E tests

export async function blockGoogleAnalytics(page) {
  // Block all Google Analytics and tracking requests
  await page.route('**/*googletagmanager.com*', route => route.abort())
  await page.route('**/*google-analytics.com*', route => route.abort())
  await page.route('**/*gtag*', route => route.abort())
  await page.route('**/*gtm.js*', route => route.abort())
  await page.route('**/*analytics*', route => route.abort())
}

// Cache for real API responses, keyed by AState ('A' or 'D') — issue #38:
// the request body's AState determines which day-mode is being asked for,
// and a departures request must never be fulfilled with a cached arrivals
// blob (or vice versa). Each state gets its own cache slot, timestamp, and
// in-flight promise so a real fetch for one state never blocks or corrupts
// the other.
let realApiCache = {} // { A: [...], D: [...] }
let cacheTimestamp = {} // { A: ms, D: ms }
let inFlightFetch = {} // { A: Promise<{status, contentType, body}>, D: ... } — only set while a real fetch for that state is outstanding
let forcedStatesDone = {} // { A: true, D: true } — which states have already had their one forced live call (see forceReal below)
const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes

export function requestAState(request) {
  try {
    const body = request.postDataJSON()
    return body?.AState === 'D' ? 'D' : 'A'
  } catch (_) {
    return 'A'
  }
}

// Test-only: clears all module-level cache state. setupSmartApiRoute's cache
// is deliberately module-level (it survives across a page's lifetime so
// repeated requests for the same state reuse one real call), which means it
// also survives across tests in the same worker unless reset. Call this in
// beforeEach for any spec that needs a cold cache — e.g. to exercise the
// inFlightFetch dedup path deterministically instead of depending on
// whichever state a previous test happened to warm.
export function __resetSmartApiCache() {
  realApiCache = {}
  cacheTimestamp = {}
  inFlightFetch = {}
  forcedStatesDone = {}
}

async function defaultFetchUpstream(route) {
  const response = await route.fetch()
  return { status: response.status(), body: await response.text() }
}

// fetchUpstream(route, state) => { status, body } lets tests supply
// deterministic per-state fixtures instead of depending on a live call to
// the real airport API (issue #38 review R3: a merge-gate spec must not
// depend on a third party's availability or undocumented response shape).
// Defaults to the real network call, which is what non-test callers get.
// Second argument is an options object, not a positional forceReal (issue
// #38 review N5): a stale positional call like `setupSmartApiRoute(page,
// true)` destructures a boxed Boolean and silently yields `forceReal ===
// false` instead of throwing. No callers pass a positional today, but if
// one shows up, that's why it stopped forcing a live call.
export async function setupSmartApiRoute(page, { forceReal = false, fetchUpstream = defaultFetchUpstream } = {}) {
  await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
    const state = requestAState(route.request())
    const now = Date.now()
    const cacheExpired = !cacheTimestamp[state] || (now - cacheTimestamp[state]) > CACHE_DURATION
    // forceReal forces exactly one live call per state, then that state's
    // cache is reused normally — the multi-state translation of the
    // pre-#38 behavior, where a single closure-scoped flag forced exactly
    // one live call per setupSmartApiRoute() install (issue #38 review N2:
    // re-evaluating forceReal on every request would force a live call on
    // every single request once state is split out, which is a different
    // and much more expensive behavior nobody asked for).
    const forceThisRequest = forceReal && !forcedStatesDone[state]

    if (!forceThisRequest && realApiCache[state] && !cacheExpired) {
      // Use cached real data for this state, with language-specific adjustments
      // (the cached blob is frozen at whichever language first populated it).
      console.log(`📋 Using cached API data (${realApiCache[state].length} flights, ${state}, cached ${Math.round((now - cacheTimestamp[state]) / 60000)} min ago)`)
      const langHeader = route.request().headers()['accept-language'] || ''
      const languageAdjustedData = realApiCache[state].map((flight) => {
        let adjustedFlight = { ...flight }
        if (flight.ACode && ['BR', 'CI', 'JX', 'B7', 'AE'].includes(flight.ACode)) {
          if (langHeader.startsWith('zh')) {
            const zhNames = { BR: '長榮航空', CI: '中華航空', JX: '星宇航空', B7: '立榮航空', AE: '華信航空' }
            adjustedFlight.AName = zhNames[flight.ACode] || flight.AName
          } else if (langHeader.startsWith('ja')) {
            const jpNames = { BR: 'エバー航空', CI: 'チャイナエアライン', JX: 'スターラックス航空', B7: 'ユニー航空', AE: 'マンダリン航空' }
            adjustedFlight.AName = jpNames[flight.ACode] || flight.AName
          } else {
            const enNames = { BR: 'EVA Air', CI: 'China Airlines', JX: 'STARLUX Airlines', B7: 'UNI Air', AE: 'Mandarin Airlines' }
            adjustedFlight.AName = enNames[flight.ACode] || flight.AName
          }
        }
        return adjustedFlight
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(languageAdjustedData)
      })
      return
    }

    // Cold or expired cache for this state. If a real fetch for this exact
    // state is already in flight (concurrent requests, e.g. the departures
    // primary fetch and the return-leg pairing fetch landing together),
    // await that single shared promise instead of racing a second real call
    // or falling through to a not-yet-populated cache (issue #38: the old
    // code set its "captured" flag before the cache was assigned, so a
    // concurrent request could be fulfilled with the string "null").
    if (!inFlightFetch[state]) {
      if (forceReal) forcedStatesDone[state] = true
      console.log(`🌐 Making real API call to cache fresh ${state} data...`)
      inFlightFetch[state] = (async () => {
        try {
          const { status, body } = await fetchUpstream(route, state)
          realApiCache[state] = JSON.parse(body)
          cacheTimestamp[state] = now
          console.log(`✅ Cached ${realApiCache[state].length} flights (${state}) from real API`)
          // Always reply with a clean content-type rather than replaying the
          // upstream's raw headers (issue #38 review R3): response.text()
          // hands back a decoded body, so replaying an upstream
          // content-encoding/content-length alongside it would be a decode
          // mismatch waiting to happen, and it would now fan out to every
          // route awaiting this shared promise instead of just one.
          return { status, contentType: 'application/json', body }
        } catch (error) {
          console.log(`❌ Real API call failed for ${state}, falling back to mock data`)
          realApiCache[state] = getMockFlightData().map(flight => ({ ...flight, AState: state }))
          cacheTimestamp[state] = now
          return {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(realApiCache[state]),
          }
        } finally {
          delete inFlightFetch[state]
        }
      })()
    }

    const result = await inFlightFetch[state]
    await route.fulfill(result)
  })
}

export function getCurrentUTC8Date() {
  // Get current UTC time and add 8 hours for Taiwan time
  const now = new Date()
  const utc8Time = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return utc8Time.toISOString().split('T')[0].replace(/-/g, '/')
}

export function getCurrentUTC8DateTime() {
  // Get current UTC+8 time for dynamic test data
  const now = new Date()
  const utc8Time = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return utc8Time
}

import { getTimeWindowConfig, getTimeWindow } from '../src/utils/flightUtils.js'

export function getMockFlightData(date = getCurrentUTC8Date()) {
  // Generate flight times within the calculated UTC+8 window
  const nowLocal = new Date()
  const config = getTimeWindowConfig('A')
  const { windowStart } = getTimeWindow(config, nowLocal)
  const offsets = [10, 20, 30, 40, 50]
  const dateTimes = offsets.map(offset => {
    const dt = new Date(windowStart.getTime() + offset * 60 * 1000)
    const dateStr = dt.toISOString().split('T')[0].replace(/-/g, '/')
    const timeStr = dt.toISOString().split('T')[1].slice(0, 8)
    return { dateStr, timeStr }
  })

  return [
    {
      "id": `${date.replace(/\//g, '')}_A_BR35`,
      "BNO": 2,
      "AState": "A",
      "ACode": "BR",
      "AName": "長榮航空",
      "FlightNo": "35",
      "Gate": "C3",
      "ODate": dateTimes[0].dateStr,
      "OTime": dateTimes[0].timeStr,
      "RDate": dateTimes[0].dateStr,
      "RTime": dateTimes[0].timeStr,
      "CityCode": "YYZ",
      "CityEname": "Toronto",
      "CityName": "多倫多",
      "Memo": "已到",
      "PlaneNo": "B777-300",
      "StopCityCode": "",
      "StopEname": "",
      "StopCname": "",
      "StopCode": "05",
      "CheckIn": "",
      "CurrentStatus": "抵達機坪",
      "updateDate": new Date().toISOString(),
      "sharing": [],
      "flightCode": "BR35",
      "check": false
    },
    {
      "id": `${date.replace(/\//g, '')}_A_CI123`,
      "BNO": 1,
      "AState": "A",
      "ACode": "CI",
      "AName": "中華航空",
      "FlightNo": "123",
      "Gate": "D1",
      "ODate": dateTimes[1].dateStr,
      "OTime": dateTimes[1].timeStr,
      "RDate": dateTimes[1].dateStr,
      "RTime": dateTimes[1].timeStr,
      "CityCode": "NRT",
      "CityEname": "Tokyo",
      "CityName": "東京",
      "Memo": "已到",
      "PlaneNo": "A321",
      "StopCode": "02",
      "flightCode": "CI123"
    },
    {
      "id": `${date.replace(/\//g, '')}_A_JX456`,
      "BNO": 2,
      "AState": "A",
      "ACode": "JX",
      "AName": "星宇航空",
      "FlightNo": "456",
      "Gate": "B2",
      "ODate": dateTimes[2].dateStr,
      "OTime": dateTimes[2].timeStr,
      "RDate": dateTimes[2].dateStr,
      "RTime": dateTimes[2].timeStr,
      "CityCode": "LAX",
      "CityEname": "Los Angeles",
      "CityName": "洛杉磯",
      "Memo": "已到",
      "PlaneNo": "A350",
      "StopCode": "03",
      "flightCode": "JX456"
    },
    {
      "id": `${date.replace(/\//g, '')}_A_B7681`,
      "BNO": 2,
      "AState": "A",
      "ACode": "B7",
      "AName": "立榮航空",
      "FlightNo": "681",
      "Gate": "C5",
      "ODate": dateTimes[3].dateStr,
      "OTime": dateTimes[3].timeStr,
      "RDate": dateTimes[3].dateStr,
      "RTime": dateTimes[3].timeStr,
      "CityCode": "SZX",
      "CityEname": "Shenzhen",
      "CityName": "深圳",
      "Memo": "已到",
      "PlaneNo": "A321-200",
      "StopCode": "07",
      "flightCode": "B7681"
    },
    {
      "id": `${date.replace(/\//g, '')}_A_AE991`,
      "BNO": 2,
      "AState": "A",
      "ACode": "AE",
      "AName": "華信航空",
      "FlightNo": "991",
      "Gate": "D3",
      "ODate": dateTimes[4].dateStr,
      "OTime": dateTimes[4].timeStr,
      "RDate": dateTimes[4].dateStr,
      "RTime": dateTimes[4].timeStr,
      "CityCode": "XMN",
      "CityEname": "Xiamen",
      "CityName": "廈門",
      "Memo": "已到",
      "PlaneNo": "A321-271N",
      "StopCode": "04",
      "flightCode": "AE991"
    }
  ]
}

export async function waitForApiAndTable(page, timeout = 8000) {
  // Wait for either table to appear or "No matching flights" message
  try {
    await page.waitForSelector('table', { timeout })
  } catch (error) {
    // If table doesn't appear, check for "no flights" message in any language
    const hasNoFlightsMessage = await page.locator('#output').textContent().then(text => 
      text && (text.includes('沒有找到') || text.includes('No matching') || text.includes('一致する'))
    ).catch(() => false)
    
    if (!hasNoFlightsMessage) {
      throw error // Re-throw if neither table nor no-flights message is found
    }
  }
}

// arrivalsMockData (issue #40 item 5): when set, AState='A' requests are
// served this list instead of `mockData`/baseData. Every other spec relies
// on both AState requests being served the same re-tagged list, so this
// defaults to baseData to leave that behavior unchanged. It exists because
// departures mode's non-blocking return-leg pairing fetch (#33) also sends
// AState='A' — without a distinct payload, that fetch sees the exact same
// records as the departures list (just relabeled), so a departure can never
// pair with a return leg that is, by construction, itself.
export async function setupMockApiRoute(page, mockData = null, arrivalsMockData = null) {
  const baseData = mockData || getMockFlightData()
  const returnLegBaseData = arrivalsMockData || baseData

  await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
    const request = route.request()
    const langHeader = request.headers()['accept-language'] || ''
    // Real API responses for Arrival and Departure are almost never the same
    // set of flights or plane families. To catch bugs that only surface when
    // the two lists differ (e.g., pinned aircraft family missing in the other
    // mode), adapt the mock so BR35's plane family changes per mode. That way
    // a test pinning B777 in Arrival and toggling to Departure actually hits
    // a list without B777 — the real-world failure mode.
    let body = {}
    try { body = request.postDataJSON() || {} } catch (_) { /* empty body is fine */ }
    const mode = body.AState === 'D' ? 'D' : 'A'
    const sourceData = mode === 'D' ? baseData : returnLegBaseData

    const flightData = sourceData.map((flight) => {
      let name
      if (langHeader.startsWith('zh')) {
        name = flight.AName
      } else if (langHeader.startsWith('ja')) {
        const jpNames = { BR: 'エバー航空', CI: 'チャイナエアライン', JX: 'スターラックス航空', B7: 'ユニー航空', AE: 'マンダリン航空' }
        name = jpNames[flight.ACode] || flight.AName
      } else {
        const enNames = { BR: 'EVA Air', CI: 'China Airlines', JX: 'STARLUX Airlines', B7: 'UNI Air', AE: 'Mandarin Airlines' }
        name = enNames[flight.ACode] || flight.AName
      }
      // In Departure mode, swap the lone BR widebody entry to an A321 so the
      // BR group in that mode only contains A321 family flights.
      const planeNo = (mode === 'D' && flight.flightCode === 'BR35')
        ? 'A321-252NX'
        : flight.PlaneNo
      return { ...flight, AName: name, PlaneNo: planeNo, AState: mode }
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(flightData)
    })
  })

  return baseData
}