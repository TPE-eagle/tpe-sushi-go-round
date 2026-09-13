import { describe, it, expect } from 'vitest'
import { getMockFlightData } from '../../e2e/test-helpers.js'

// Issue #151 regression guard — the E2E fixture must be self-consistent:
// every row's ODate/RDate must equal the date encoded in its id, whatever
// the wall clock says. The old fixture derived ODate from the real time
// window (now −40 min, 10-min rounded), so CI runs after 16:00 UTC+8
// (= Taipei midnight) produced rows whose ODate said "yesterday" while
// their ids said "today". matchFlights drops rows whose ODate ≠ today, so
// the quick-dial search store went empty and the whole E2E flight-search
// suite failed on every post-midnight run. This unit test pins the
// invariant without needing a browser or a specific time of day.

// A date deliberately far from "today": the old fixture ignored the passed
// date when computing ODate (it tracked the wall clock instead), so this
// assertion fails deterministically on the pre-#151 code and passes on the
// fixed one, at any hour the suite happens to run.
const ARBITRARY_DATE = '2030/01/01'

function idEncodedDate(flight) {
  return `${flight.id.slice(0, 4)}/${flight.id.slice(4, 6)}/${flight.id.slice(6, 8)}`
}

describe('getMockFlightData fixture self-consistency (issue #151)', () => {
  it('places every row on the day its id encodes, for an arbitrary passed date', () => {
    const data = getMockFlightData(ARBITRARY_DATE)
    expect(data.length).toBeGreaterThan(0)
    for (const flight of data) {
      expect(flight.id).toMatch(/^20300101_A_/)
      expect(flight.ODate).toBe(ARBITRARY_DATE)
      expect(flight.RDate).toBe(ARBITRARY_DATE)
      expect(idEncodedDate(flight)).toBe(ARBITRARY_DATE)
    }
  })

  it('keeps ODate/RDate consistent with the id-encoded day on the default (wall-clock) path', () => {
    for (const flight of getMockFlightData()) {
      expect(flight.ODate).toBe(idEncodedDate(flight))
      expect(flight.RDate).toBe(flight.ODate)
    }
  })

  it('keeps fixture times inside the fixture day (no midnight straddle)', () => {
    // Same UTC+8 wall-date the app derives everywhere (getUTC8Date style):
    // shift the absolute instant +8h, then read the calendar date. Reading
    // toISOString() directly would render UTC and be off by one for
    // early-UTC+8 times.
    const utc8Date = (date, time) => new Date(
      new Date(`${date.replace(/\//g, '-')}T${time}+08:00`).getTime() + 8 * 60 * 60 * 1000
    ).toISOString().slice(0, 10).replace(/-/g, '/')
    for (const flight of getMockFlightData(ARBITRARY_DATE)) {
      expect(utc8Date(flight.ODate, flight.OTime)).toBe(ARBITRARY_DATE)
      expect(utc8Date(flight.RDate, flight.RTime)).toBe(ARBITRARY_DATE)
    }
  })
})
