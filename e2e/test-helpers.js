// Helper functions for E2E tests

export async function blockGoogleAnalytics(page) {
  // Block all Google Analytics and tracking requests
  await page.route('**/*googletagmanager.com*', route => route.abort())
  await page.route('**/*google-analytics.com*', route => route.abort())
  await page.route('**/*gtag*', route => route.abort())
  await page.route('**/*gtm.js*', route => route.abort())
  await page.route('**/*analytics*', route => route.abort())
}

// Cache for real API responses
let realApiCache = null
let cacheTimestamp = null
const CACHE_DURATION = 30 * 60 * 1000 // 30 minutes

export async function setupSmartApiRoute(page, forceReal = false) {
  const now = Date.now()
  const cacheExpired = !cacheTimestamp || (now - cacheTimestamp) > CACHE_DURATION
  
  if (forceReal || !realApiCache || cacheExpired) {
    // First time or cache expired - make real API call and cache the response
    let realResponseCaptured = false
    
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      if (!realResponseCaptured) {
        console.log('🌐 Making real API call to cache fresh data...')
        realResponseCaptured = true
        
        try {
          // Make real request
          const response = await route.fetch()
          const responseBody = await response.text()
          
          // Cache the real response
          realApiCache = JSON.parse(responseBody)
          cacheTimestamp = now
          console.log(`✅ Cached ${realApiCache.length} flights from real API`)
          
          // Return the real response
          await route.fulfill({
            status: response.status(),
            headers: response.headers(),
            body: responseBody,
          })
        } catch (error) {
          console.log('❌ Real API call failed, falling back to mock data')
          // Fall back to mock data if real API fails
          realApiCache = getMockFlightData()
          cacheTimestamp = now
          
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(realApiCache)
          })
        }
      } else {
        // Use cached data for subsequent requests in same test
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(realApiCache)
        })
      }
    })
  } else {
    // Use cached real data
    console.log(`📋 Using cached API data (${realApiCache.length} flights, cached ${Math.round((now - cacheTimestamp) / 60000)} min ago)`)
    
    await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
      const langHeader = route.request().headers()['accept-language'] || ''
      
      // Apply language-specific transformations to cached data
      const languageAdjustedData = realApiCache.map((flight) => {
        // Keep original data but adjust language-specific fields if needed
        let adjustedFlight = { ...flight }
        
        // Apply language-specific airline name translations for supported airlines
        if (flight.ACode && ['BR', 'CI', 'JX'].includes(flight.ACode)) {
          if (langHeader.startsWith('zh')) {
            const zhNames = { BR: '長榮航空', CI: '中華航空', JX: '星宇航空' }
            adjustedFlight.AName = zhNames[flight.ACode] || flight.AName
          } else if (langHeader.startsWith('ja')) {
            const jpNames = { BR: 'エバー航空', CI: 'チャイナエアライン', JX: 'スターラックス航空' }
            adjustedFlight.AName = jpNames[flight.ACode] || flight.AName
          } else {
            const enNames = { BR: 'EVA Air', CI: 'China Airlines', JX: 'STARLUX Airlines' }
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
    })
  }
  
  return realApiCache || getMockFlightData()
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
  const offsets = [10, 20, 30]
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

export async function setupMockApiRoute(page, mockData = null) {
  const baseData = mockData || getMockFlightData()

  await page.route('https://www.taoyuan-airport.com/api/api/flight/a_flight', async (route) => {
    const langHeader = route.request().headers()['accept-language'] || ''
    const flightData = baseData.map((flight) => {
      let name
      if (langHeader.startsWith('zh')) {
        name = flight.AName
      } else if (langHeader.startsWith('ja')) {
        const jpNames = { BR: 'エバー航空', CI: 'チャイナエアライン', JX: 'スターラックス航空' }
        name = jpNames[flight.ACode] || flight.AName
      } else {
        const enNames = { BR: 'EVA Air', CI: 'China Airlines', JX: 'STARLUX Airlines' }
        name = enNames[flight.ACode] || flight.AName
      }
      return { ...flight, AName: name }
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(flightData)
    })
  })

  return baseData
}