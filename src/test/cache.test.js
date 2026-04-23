import { describe, test, expect, beforeEach, vi } from 'vitest'

// Mock localStorage
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    key: vi.fn((index) => {
      const keys = Object.keys(store)
      return keys[index] || null
    }),
    get length() {
      return Object.keys(store).length
    }
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
})

// Import functions from main.js - we'll need to extract these into utils
// For now, we'll test the cache logic patterns
describe('Flight Data Caching', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  test('should store and retrieve cached flight data', () => {
    const testData = {
      data: [{ ACode: 'BR', FlightNo: '35', CityName: 'Toronto' }],
      etag: '"abc123"',
      lastModified: 'Wed, 21 Oct 2015 07:28:00 GMT',
      timestamp: Date.now()
    }
    const cacheKey = 'flight_data_test'

    // Simulate setCachedFlightData
    localStorage.setItem(cacheKey, JSON.stringify(testData))
    
    // Simulate getCachedFlightData
    const retrieved = JSON.parse(localStorage.getItem(cacheKey))
    
    expect(retrieved).toEqual(testData)
    expect(localStorage.setItem).toHaveBeenCalledWith(cacheKey, JSON.stringify(testData))
  })

  test('should return null for non-existent cache key', () => {
    const result = localStorage.getItem('non_existent_key')
    expect(result).toBeNull()
  })

  test('should handle cache expiration logic', () => {
    const CACHE_DURATION = 2 * 60 * 1000 // 2 minutes
    const now = Date.now()
    
    // Fresh cache (not expired)
    const freshTimestamp = now - (1 * 60 * 1000) // 1 minute ago
    const isFreshExpired = now - freshTimestamp > CACHE_DURATION
    expect(isFreshExpired).toBe(false)
    
    // Expired cache
    const expiredTimestamp = now - (3 * 60 * 1000) // 3 minutes ago
    const isExpiredExpired = now - expiredTimestamp > CACHE_DURATION
    expect(isExpiredExpired).toBe(true)
  })

  test('should clean up old cache entries', () => {
    // Add multiple cache entries with different timestamps
    const now = Date.now()
    const entries = [
      { key: 'flight_data_1', timestamp: now - 5000 },
      { key: 'flight_data_2', timestamp: now - 4000 },
      { key: 'flight_data_3', timestamp: now - 3000 },
      { key: 'flight_data_4', timestamp: now - 2000 },
      { key: 'flight_data_5', timestamp: now - 1000 },
      { key: 'flight_data_6', timestamp: now },
      { key: 'flight_data_7', timestamp: now + 1000 }
    ]

    entries.forEach(entry => {
      localStorage.setItem(entry.key, JSON.stringify({ timestamp: entry.timestamp }))
    })

    expect(localStorage.length).toBe(7)

    // Simulate cleanup logic (keep only 5 newest)
    const flightCacheKeys = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('flight_data_')) {
        const cached = JSON.parse(localStorage.getItem(key))
        flightCacheKeys.push({ key, timestamp: cached.timestamp })
      }
    }

    flightCacheKeys.sort((a, b) => b.timestamp - a.timestamp)
    const keysToRemove = flightCacheKeys.slice(5)

    expect(keysToRemove.length).toBe(2)
    
    // Should remove the two oldest entries (smallest timestamps)
    const removedTimestamps = keysToRemove.map(item => item.timestamp).sort()
    expect(removedTimestamps).toEqual([now - 5000, now - 4000])
  })

  test('should handle localStorage quota exceeded gracefully', () => {
    // Mock localStorage.setItem to throw quota exceeded error
    localStorage.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })

    const testData = { data: [], timestamp: Date.now() }
    
    // Should not throw error
    expect(() => {
      try {
        localStorage.setItem('test_key', JSON.stringify(testData))
      } catch (error) {
        // Simulate cleanup and retry
        localStorage.clear()
        localStorage.setItem('test_key', JSON.stringify(testData))
      }
    }).not.toThrow()
  })

  test('should generate correct cache keys for different request parameters', () => {
    const postData1 = {
      ODate: '2025/06/08',
      AState: 'A',
      language: 'en'
    }
    
    const postData2 = {
      ODate: '2025/06/08',
      AState: 'D',
      language: 'zh'
    }

    const cacheKey1 = `flight_data_${JSON.stringify(postData1)}`
    const cacheKey2 = `flight_data_${JSON.stringify(postData2)}`

    expect(cacheKey1).not.toBe(cacheKey2)
    expect(cacheKey1).toContain('flight_data_')
    expect(cacheKey2).toContain('flight_data_')
  })

  // Caching policy: flight data is live; gate and carousel change over time
  // and a stale value is worse than a momentary empty state. So when online
  // we always fetch fresh and never serve localStorage, regardless of age.
  // localStorage is kept purely as an offline fallback.
  describe('always-fresh-online policy', () => {
    const shouldServeCache = (cached, online) => !!cached && !online

    test('refuses cache of any age when online', () => {
      const now = Date.now()
      const fresh = { timestamp: now - 30_000 }
      const aged = { timestamp: now - 5 * 60 * 1000 }
      expect(shouldServeCache(fresh, true)).toBe(false)
      expect(shouldServeCache(aged, true)).toBe(false)
    })

    test('serves cache when offline regardless of age', () => {
      const now = Date.now()
      expect(shouldServeCache({ timestamp: now - 30_000 }, false)).toBe(true)
      expect(shouldServeCache({ timestamp: now - 24 * 60 * 60 * 1000 }, false)).toBe(true)
    })

    test('returns false when nothing is cached regardless of connectivity', () => {
      expect(shouldServeCache(null, true)).toBe(false)
      expect(shouldServeCache(null, false)).toBe(false)
    })
  })

  test('should handle JSON parsing errors gracefully', () => {
    // Store invalid JSON
    localStorage.setItem('invalid_json_key', 'invalid json data')
    
    // Should not throw when trying to parse
    let result = null
    try {
      const cached = localStorage.getItem('invalid_json_key')
      result = cached ? JSON.parse(cached) : null
    } catch (error) {
      result = null
    }
    
    expect(result).toBeNull()
  })
})