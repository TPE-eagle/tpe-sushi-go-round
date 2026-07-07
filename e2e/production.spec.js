import { test, expect } from '@playwright/test'
import { blockGoogleAnalytics } from './test-helpers.js'

const FLIGHT_API = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'
const OWN_ORIGIN = 'https://tpe-eagle.github.io/tpe-sushi-go-round'

test.describe('Deployment smoke', () => {
  test('page loads and shell renders', async ({ page }) => {
    await blockGoogleAnalytics(page)
    const response = await page.goto('')
    expect(response.status()).toBeLessThan(400)
    await expect(page.locator('#title')).toBeVisible({ timeout: 10000 })
    // Airline links are generated after the API responds — give the real API time
    await expect(page.locator('#airlineButtons a').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('#output')).toBeAttached()
  })

  test('own static assets return no 4xx', async ({ page }) => {
    const failures = []
    page.on('response', response => {
      const url = response.url()
      if (url.startsWith(OWN_ORIGIN) && response.status() >= 400) {
        failures.push(`${response.status()} ${url}`)
      }
    })
    await blockGoogleAnalytics(page)
    await page.goto('')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // Explicitly probe PWA-specific files — sw.js may not be fetched when
    // serviceWorkers is blocked, so the response listener alone won't catch it
    for (const file of ['manifest.webmanifest', 'sw.js']) {
      const resp = await page.request.get(`${OWN_ORIGIN}/${file}`)
      if (resp.status() >= 400) {
        failures.push(`${resp.status()} ${file}`)
      }
    }

    expect(failures, `4xx own-origin assets:\n${failures.join('\n')}`).toHaveLength(0)
  })

  test('app boots and fires flight API request', async ({ page }) => {
    await blockGoogleAnalytics(page)
    const fetchPromise = page.waitForRequest(
      req => req.url() === FLIGHT_API,
      { timeout: 10000 }
    )
    await page.goto('')
    const request = await fetchPromise
    expect(request.method()).toBe('POST')
  })
})
