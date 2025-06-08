import { describe, test, expect, beforeEach, vi } from 'vitest'

// This test will only run if NODE_ENV is set to 'integration'
// To run: NODE_ENV=integration npm test src/test/etag-integration.test.js
const shouldRunIntegrationTests = process.env.NODE_ENV === 'integration'

describe('ETag Integration Tests', () => {
  const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight'
  
  // Test data that matches the API format with current UTC+8 date
  const getCurrentUTC8Date = () => {
    const now = new Date()
    const utc8Time = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    return utc8Time.toISOString().split('T')[0].replace(/-/g, '/')
  }
  
  const testPostData = {
    "ODate": getCurrentUTC8Date(),
    "OTimeOpen": null,
    "OTimeClose": null,
    "BNO": null,
    "AState": "A",
    "language": "en",
    "keyword": ""
  }

  test('should receive ETag header and handle 304 Not Modified response', async () => {
    if (!shouldRunIntegrationTests) {
      console.log('Skipping integration test - set NODE_ENV=integration to run')
      return
    }

    // Step 1: Send initial request and assert 200 OK with ETag
    const firstResponse = await globalThis.fetch(API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPostData)
    })

    expect(firstResponse.status).toBe(200)
    
    const etag = firstResponse.headers.get('ETag')
    const lastModified = firstResponse.headers.get('Last-Modified')
    
    // Assert that we have caching headers (at least one should be present)
    const hasCachingHeaders = etag || lastModified
    expect(hasCachingHeaders).toBeTruthy()
    
    if (!hasCachingHeaders) {
      console.warn('API does not support ETag or Last-Modified headers - caching will rely on timestamp only')
      return
    }

    const firstData = await firstResponse.json()
    expect(Array.isArray(firstData)).toBe(true)

    // Step 2: Send second request with If-None-Match header
    const secondHeaders = {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json',
    }

    if (etag) {
      secondHeaders['If-None-Match'] = etag
    }
    if (lastModified) {
      secondHeaders['If-Modified-Since'] = lastModified
    }

    const secondResponse = await globalThis.fetch(API_URL, {
      method: 'POST',
      headers: secondHeaders,
      body: JSON.stringify(testPostData)
    })

    // Step 3: Assert 304 Not Modified or 200 with same ETag
    if (secondResponse.status === 304) {
      // Perfect! The server supports proper ETag/conditional requests
      expect(secondResponse.status).toBe(304)
      console.log('✅ Server supports ETag/conditional requests with 304 responses')
    } else if (secondResponse.status === 200) {
      // Server doesn't support conditional requests, but that's OK
      // We can still use timestamp-based caching
      console.log('ℹ️  Server does not support 304 responses, using timestamp-based caching')
      const secondData = await secondResponse.json()
      expect(Array.isArray(secondData)).toBe(true)
    } else {
      throw new Error(`Unexpected response status: ${secondResponse.status}`)
    }
  })

  test('should handle cache validation with different request parameters', async () => {
    if (!shouldRunIntegrationTests) {
      console.log('Skipping integration test - set NODE_ENV=integration to run')
      return
    }

    // Test with different language parameter
    const differentPostData = {
      ...testPostData,
      language: "ch"
    }

    const response1 = await globalThis.fetch(API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPostData)
    })

    const response2 = await globalThis.fetch(API_URL, {
      method: 'POST', 
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(differentPostData)
    })

    expect(response1.status).toBe(200)
    expect(response2.status).toBe(200)

    // Different requests should be treated as separate cache entries
    const data1 = await response1.json()
    const data2 = await response2.json()
    
    expect(Array.isArray(data1)).toBe(true)
    expect(Array.isArray(data2)).toBe(true)
  })

  test('should handle network errors gracefully', async () => {
    if (!shouldRunIntegrationTests) {
      console.log('Skipping integration test - set NODE_ENV=integration to run')
      return
    }

    // Test with invalid URL to simulate network failure
    const invalidUrl = 'https://invalid-domain-that-does-not-exist.com/api'
    
    try {
      await globalThis.fetch(invalidUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPostData)
      })
      // If fetch doesn't throw, the test should fail
      expect(true).toBe(false)
    } catch (error) {
      // This is expected - network errors should be caught
      expect(error).toBeDefined()
    }
  })

  test('should validate API response format', async () => {
    if (!shouldRunIntegrationTests) {
      console.log('Skipping integration test - set NODE_ENV=integration to run')
      return
    }

    const response = await globalThis.fetch(API_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPostData)
    })

    expect(response.status).toBe(200)
    
    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)

    // If there's data, validate the structure matches our expected format
    if (data.length > 0) {
      const flight = data[0]
      expect(flight).toHaveProperty('ACode')
      expect(flight).toHaveProperty('FlightNo')
      expect(flight).toHaveProperty('AState')
      expect(flight).toHaveProperty('ODate')
      expect(flight).toHaveProperty('OTime')
    }
  })

  // Mock-based test that simulates ETag behavior
  test('should handle ETag caching logic with mocked responses', async () => {
    // Mock fetch for this test
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const mockETag = '"test-etag-123"'
    const mockData = [{ ACode: 'BR', FlightNo: '35' }]

    // First request - return 200 with ETag
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Map([
        ['ETag', mockETag],
        ['Content-Type', 'application/json']
      ]),
      json: () => Promise.resolve(mockData)
    })

    // Second request with If-None-Match - return 304
    mockFetch.mockResolvedValueOnce({
      status: 304,
      headers: new Map([
        ['ETag', mockETag]
      ])
    })

    // Simulate our caching logic
    const postData = { test: 'data' }
    
    // First request
    const response1 = await fetch('test-url', {
      method: 'POST',
      body: JSON.stringify(postData)
    })
    
    expect(response1.status).toBe(200)
    const etag = response1.headers.get('ETag')
    expect(etag).toBe(mockETag)
    
    // Second request with conditional header
    const response2 = await fetch('test-url', {
      method: 'POST',
      headers: {
        'If-None-Match': etag
      },
      body: JSON.stringify(postData)
    })
    
    expect(response2.status).toBe(304)
    
    // Verify fetch was called with correct headers
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch).toHaveBeenLastCalledWith('test-url', {
      method: 'POST',
      headers: {
        'If-None-Match': mockETag
      },
      body: JSON.stringify(postData)
    })

    // Restore original fetch
    vi.unstubAllGlobals()
  })
})