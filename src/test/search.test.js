import { describe, it, expect } from 'vitest'
import { normalizeFlightQuery, matchFlights } from '../utils/flightUtils.js'

const TODAY = '2026/09/05'
const YESTERDAY = '2026/09/04'

// Full-day search store fixture (issue #130). Pre-cancelled-drop, so the
// cancelled BR881 row is present exactly as processFetchedData stores it.
const store = [
    { ACode: 'BR', FlightNo: '178', AState: 'D', ODate: TODAY, OTime: '08:30:00', Gate: 'C5', StopCode: '', Terminal: '2', BNO: 2, CityCode: 'KIX', Memo: '' },
    { ACode: 'BR', FlightNo: '881', AState: 'D', ODate: TODAY, OTime: '09:15:00', Gate: '', Memo: '取消', AState_: undefined },
    { ACode: 'B7', FlightNo: '681', AState: 'D', ODate: TODAY, OTime: '07:00:00', Gate: 'A2', Memo: null },
    { ACode: 'CI', FlightNo: '810', AState: 'A', ODate: TODAY, OTime: '12:05:00', Gate: 'B3', StopCode: '12', Memo: '' },
    { ACode: 'JX', FlightNo: '810', AState: 'A', ODate: TODAY, OTime: '13:40:00', Gate: 'D4', StopCode: '5', Memo: '' },
    { ACode: 'BR', FlightNo: '350', AState: 'A', ODate: TODAY, OTime: '23:30:00', Gate: '', StopCode: '101', Memo: '' },
    { ACode: 'BR', FlightNo: '35', AState: 'A', ODate: TODAY, OTime: '05:10:00', Gate: 'C3', StopCode: '05', Memo: '' },
    { ACode: 'CI', FlightNo: '150', AState: 'A', ODate: YESTERDAY, OTime: '23:30:00', Gate: 'A1', StopCode: '3', Memo: '' },
]

describe('normalizeFlightQuery', () => {
    it('uppercases and strips separators', () => {
        expect(normalizeFlightQuery('br-178')).toBe('BR178')
        expect(normalizeFlightQuery(' br 178 ')).toBe('BR178')
        expect(normalizeFlightQuery('Br178')).toBe('BR178')
    })

    it('folds full-width IME input via NFKC', () => {
        expect(normalizeFlightQuery('ＢＲ１７８')).toBe('BR178')
    })

    it('keeps bare digits', () => {
        expect(normalizeFlightQuery('178')).toBe('178')
    })

    it('returns empty for empty input', () => {
        expect(normalizeFlightQuery('')).toBe('')
        expect(normalizeFlightQuery('   ')).toBe('')
        expect(normalizeFlightQuery(null)).toBe('')
    })
})

describe('matchFlights', () => {
    it('finds flights by digit prefix across all airlines', () => {
        const q = '810'
        const codes = matchFlights(store, q, TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toContain('CI810')
        expect(codes).toContain('JX810')
    })

    it('matches by PREFIX, not substring', () => {
        // "81" must hit 810 but not 881
        const codes = matchFlights(store, '81', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toContain('CI810')
        expect(codes).not.toContain('BR881')
    })

    it('exact flight number sorts before prefix hits', () => {
        // "35" hits 35 (exact) and 350 (prefix) — exact first
        const codes = matchFlights(store, '35', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes[0]).toBe('BR35')
        expect(codes).toContain('BR350')
    })

    it('strips leading zeros from the query', () => {
        const codes = matchFlights(store, 'BR035', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes[0]).toBe('BR35')
    })

    it('resolves a two-character airline prefix including the digit-carrying B7', () => {
        const codes = matchFlights(store, 'B7681', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['B7681'])
    })

    it('applies the airline prefix at GROUP level — BR covers B7', () => {
        const codes = matchFlights(store, 'BR681', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['B7681'])
    })

    it('letters-only query lists that group for the whole day', () => {
        const codes = matchFlights(store, 'BR', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        expect(codes).toEqual(['B7681', 'BR35', 'BR178', 'BR350', 'BR881'])
    })

    it('returns nothing for airlines outside the five supported groups', () => {
        expect(matchFlights(store, 'UA178', TODAY)).toEqual([])
    })

    it('ignores a single stray letter and searches the digits', () => {
        const codes = matchFlights(store, 'B810', TODAY).map(f => `${f.ACode}${f.FlightNo}`)
        // "B8" is not a code; single letter ignored → digits 810
        expect(codes).toEqual(['CI810', 'JX810'])
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

    it('returns empty for empty or unusable queries', () => {
        expect(matchFlights(store, '', TODAY)).toEqual([])
        expect(matchFlights(store, '   ', TODAY)).toEqual([])
        expect(matchFlights(store, '今日', TODAY)).toEqual([])
    })
})
