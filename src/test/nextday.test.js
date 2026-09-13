// Issue #142 — next-day search gate. The fetch/store/interleave machinery
// lives inside main.js (entry script, not importable — same situation as
// issue #130's search), so the unit-tested surface is the gate itself plus
// the wiring contracts the e2e spec covers end to end
// (e2e/nextday-search.spec.js).
import { describe, it, expect } from 'vitest'
import { shouldFetchNextDay } from '../utils/flightUtils.js'

// Build a UTC instant from a UTC+8 wall-clock time on a fixed date.
// Hours may be negative/fractional — Date.UTC normalizes them (e.g. -8
// rolls back into the previous UTC day, which is exactly UTC+8 midnight).
const utc8 = (hour, minute = 0) => new Date(Date.UTC(2026, 8, 13, hour - 8, minute))

describe('shouldFetchNextDay (issue #142: 16:00 UTC+8 gate)', () => {
  it('is closed just before 16:00', () => {
    expect(shouldFetchNextDay(utc8(15, 59))).toBe(false)
    expect(shouldFetchNextDay(utc8(15, 0))).toBe(false)
  })

  it('opens exactly at 16:00 (owner decision: >= 16:00)', () => {
    expect(shouldFetchNextDay(utc8(16, 0))).toBe(true)
  })

  it('stays open through the evening (the night-search use case)', () => {
    expect(shouldFetchNextDay(utc8(17, 30))).toBe(true)
    expect(shouldFetchNextDay(utc8(22, 0))).toBe(true)
    expect(shouldFetchNextDay(utc8(23, 59))).toBe(true)
  })

  it('is closed after midnight — tomorrow morning is same-day then', () => {
    expect(shouldFetchNextDay(utc8(0, 0))).toBe(false)
    expect(shouldFetchNextDay(utc8(5, 59))).toBe(false)
  })

  it('is closed across the working day', () => {
    expect(shouldFetchNextDay(utc8(8, 0))).toBe(false)
    expect(shouldFetchNextDay(utc8(12, 0))).toBe(false)
  })
})
