import { describe, it, expect } from 'vitest'
import { normalizeFlightQuery, matchFlights } from '../utils/flightUtils.js'

const TODAY = '2026/09/05'
const YESTERDAY = '2026/09/04'

// Full-day search store fixture (issue #130). Pre-cancelled-drop, so the
// cancelled BR881 row is present exactly as processFetchedData stores it.
const store = [
    { ACode: 'BR', FlightNo: '178', AState: 'D', ODate: TODAY, OTime: '08:30:00', Gate: 'C5', StopCode: '', Terminal: '2', BNO: 2, CityCode: 'KIX', Memo: '' },
    { ACode: 'BR', FlightNo: '881', AState: 'D', ODate: TODAY, OTime: '09:15:00', Gate: '', Memo: '取消' },
    { ACode: 'B7', FlightNo: '681', AState: 'D', ODate: TODAY, OTime: '07:00:00', Gate: 'A2', Memo: null },
    { ACode: 'CI', FlightNo: '810', AState: 'A', ODate: TODAY, OTime: '12:05:00', Gate: 'B3', StopCode: '12', Memo: '' },
    { ACode: 'JX', FlightNo: '810', AState: 'A', ODate: TODAY, OTime: '13:40:00', Gate: 'D4', StopCode: '5', Memo: '' },
    { ACode: 'BR', FlightNo: '350', AState: 'A', ODate: TODAY, OTime: '23:30:00', Gate: '', StopCode: '101', Memo: '' },
    { ACode: 'BR', FlightNo: '35', AState: 'A', ODate: TODAY, OTime: '05:10:00', Gate: 'C3', StopCode: '05', Memo: '' },
    { ACode: 'CI', FlightNo: '150', AState: 'A', ODate: YESTERDAY, OTime: '23:30:00', Gate: 'A1', StopCode: '3', Memo: '' },
]

describe('normalizeFlightQuery (digits-only quick dial)', () => {
    it('strips letters and separators — the digits are the query', () => {
        expect(normalizeFlightQuery('BR178')).toBe('178')
        expect(normalizeFlightQuery('br-178')).toBe('178')
        expect(normalizeFlightQuery(' br 178 ')).toBe('178')
    })

    it('folds full-width IME digits via NFKC', () => {
        expect(normalizeFlightQuery('１７８')).toBe('178')
        expect(normalizeFlightQuery('ＢＲ１７８')).toBe('178')
    })

    it('returns empty for empty or letter-only input', () => {
        expect(normalizeFlightQuery('')).toBe('')
        expect(normalizeFlightQuery('BR')).toBe('')
        expect(normalizeFlightQuery(null)).toBe('')
    })
})

describe('matchFlights', () => {
    it('finds flights by digit prefix across all airlines', () => {
        const codes = matchFlights(store, '810', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['CI810', 'JX810'])
    })

    it('matches by PREFIX, not substring', () => {
        // "81" must hit 810 but not 881
        const codes = matchFlights(store, '81', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['CI810', 'JX810'])
    })

    it('exact flight number sorts before prefix hits', () => {
        // "35" hits 35 (exact) and 350 (prefix) — exact first
        const codes = matchFlights(store, '35', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes[0]).toBe('BR35')
        expect(codes).toContain('BR350')
    })

    it('strips leading zeros from the query', () => {
        const codes = matchFlights(store, '035', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes[0]).toBe('BR35')
    })

    it('letters are ignored entirely — "BR178" searches "178"', () => {
        const codes = matchFlights(store, 'BR178', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['BR178'])
    })

    it('all-zeros query matches nothing', () => {
        expect(matchFlights(store, '0', TODAY)).toEqual([])
        expect(matchFlights(store, '000', TODAY)).toEqual([])
    })

    it('excludes rows from another operating day', () => {
        const codes = matchFlights(store, '150', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual([])
    })

    it('RETAINS cancelled rows — search must answer "cancelled", not "no flight"', () => {
        const codes = matchFlights(store, '881', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['BR881'])
    })

    it('is window-independent: a flight 11 hours from now is searchable', () => {
        // BR350 departs 23:30 — far outside the 2-hour display window for any
        // daytime query — and must still be found.
        const codes = matchFlights(store, 'BR350', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['BR350'])
    })

    it('returns empty for empty queries', () => {
        expect(matchFlights(store, '', TODAY)).toEqual([])
        expect(matchFlights(store, '   ', TODAY)).toEqual([])
        expect(matchFlights(store, '今日', TODAY)).toEqual([])
    })
})
