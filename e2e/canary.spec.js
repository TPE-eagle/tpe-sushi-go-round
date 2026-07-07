// Live-API contract canary for the Taoyuan Airport arrival/departure endpoint.
//
// Purpose: detect when the airport changes their API response shape BEFORE
// our mock fixture silently drifts away from reality.
//
// Non-blocking by design — this is NOT a merge gate.  Run it on a schedule
// (e.g. daily) or manually with:  npm run test:e2e:canary
//
// ⚠️  CI IP note: GitHub US-region runners may be blocked by Cloudflare even
// with the correct UA.  If this spec 403s in CI after wiring, move it to a
// scheduled cron on a closer runner or disable it — the fixture-based
// production.spec.js is IP-independent and is the real smoke test.

import { test, expect } from '@playwright/test'

const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'

// UA that passes Cloudflare's UA-gating on the airport API.
// HeadlessChrome in the UA string triggers a 403 "Just a moment" challenge.
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'

function getTaiwanDate() {
  const utc8 = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return utc8.toISOString().split('T')[0].replace(/-/g, '/')
}

test.describe('Taoyuan Airport API contract canary', () => {
  test('arrival endpoint returns expected response shape', async ({ request }) => {
    const response = await request.post(API_URL, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        'User-Agent': DESKTOP_CHROME_UA,
        'Origin': 'https://www.taoyuan-airport.com',
        'Referer': 'https://www.taoyuan-airport.com/',
      },
      data: {
        ODate: getTaiwanDate(),
        OTimeOpen: null,
        OTimeClose: null,
        AState: 'A',
        ACode: '',
        BNO: '',
      },
    })

    expect(response.status()).toBe(200)

    const body = await response.json()
    expect(Array.isArray(body)).toBeTruthy()

    if (body.length > 0) {
      const flight = body[0]
      // Required fields our app reads — if any disappear the mock will silently drift
      expect(flight).toHaveProperty('ACode')
      expect(flight).toHaveProperty('FlightNo')
      expect(flight).toHaveProperty('ODate')
      expect(flight).toHaveProperty('OTime')
      expect(flight).toHaveProperty('AState')
      expect(flight).toHaveProperty('BNO')
      expect(flight).toHaveProperty('Gate')

      // Sanity ranges — catch implausible values that suggest a parsing issue
      expect(typeof flight.ACode).toBe('string')
      expect(flight.ACode.length).toBeGreaterThan(0)
      expect(typeof flight.FlightNo).toBe('string')
      expect(flight.AState).toMatch(/^[AD]$/)
    }
  })
})
