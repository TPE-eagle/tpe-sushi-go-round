// Unit tests for the SWR cache policy (issue #141).
//
// shouldPaintFromCache() is the gate fetchData() applies before the network
// answers; these tests pin the 30-minute boundary and the forceRefresh
// escape hatch exactly as specified in the issue's design table.

import { describe, test, expect } from 'vitest'
import { SWR_MAX_AGE_MS, API_FETCH_TIMEOUT_MS, shouldPaintFromCache, cacheAgeMinutes } from '../utils/swr.js'

const NOW = 1_750_000_000_000

function cachedAgo(ms) {
    return { timestamp: NOW - ms, data: [] }
}

describe('SWR cache age gate (shouldPaintFromCache)', () => {
    test('paints fresh cache when online', () => {
        expect(shouldPaintFromCache(cachedAgo(0), NOW, true)).toBe(true)
        expect(shouldPaintFromCache(cachedAgo(60 * 1000), NOW, true)).toBe(true)
    })

    test('paints cache up to and including exactly SWR_MAX_AGE_MS when online', () => {
        // Boundary is inclusive: an entry at exactly 30 minutes is still
        // fresh enough to paint.
        expect(shouldPaintFromCache(cachedAgo(SWR_MAX_AGE_MS), NOW, true)).toBe(true)
        expect(shouldPaintFromCache(cachedAgo(SWR_MAX_AGE_MS + 1), NOW, true)).toBe(false)
    })

    test('paints cache of any age when offline (historical fallback contract)', () => {
        expect(shouldPaintFromCache(cachedAgo(SWR_MAX_AGE_MS + 1), NOW, false)).toBe(true)
        expect(shouldPaintFromCache(cachedAgo(24 * 60 * 60 * 1000), NOW, false)).toBe(true)
    })

    test('never paints without a cache entry', () => {
        expect(shouldPaintFromCache(null, NOW, true)).toBe(false)
        expect(shouldPaintFromCache(null, NOW, false)).toBe(false)
    })

    test('forceRefresh bypasses the cache even when fresh and online', () => {
        expect(shouldPaintFromCache(cachedAgo(0), NOW, true, true)).toBe(false)
        expect(shouldPaintFromCache(cachedAgo(0), NOW, false, true)).toBe(false)
    })

    test('a future-dated timestamp (clock skew) counts as fresh', () => {
        expect(shouldPaintFromCache({ timestamp: NOW + 5 * 60 * 1000 }, NOW, true)).toBe(true)
    })
})

describe('cacheAgeMinutes', () => {
    test('rounds to whole minutes and never goes negative', () => {
        // Same Math.round semantics as the offline banner has always used.
        expect(cacheAgeMinutes(NOW - 29 * 1000, NOW)).toBe(0)
        expect(cacheAgeMinutes(NOW - 30 * 1000, NOW)).toBe(1) // 0.5 rounds up
        expect(cacheAgeMinutes(NOW - 90 * 1000, NOW)).toBe(2) // 1.5 rounds up
        expect(cacheAgeMinutes(NOW - 5 * 60 * 1000, NOW)).toBe(5)
        expect(cacheAgeMinutes(NOW + 10 * 60 * 1000, NOW)).toBe(0) // future timestamp
    })
})

describe('constants', () => {
    test('owner-decided windows (issue #141)', () => {
        expect(SWR_MAX_AGE_MS).toBe(30 * 60 * 1000)
        expect(API_FETCH_TIMEOUT_MS).toBe(15000)
    })
})
