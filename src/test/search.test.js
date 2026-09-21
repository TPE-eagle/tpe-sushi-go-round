import { describe, it, expect } from 'vitest'
import { normalizeFlightQuery, matchFlights, filterFutureFlights } from '../utils/flightUtils.js'

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

// Issue #160 — search cutoff. Fixture times live on TODAY
// (2026/09/05); `now` is frozen at 22:00 UTC+8. The lower bound is the
// board window's START per mode (owner update 14:50Z): departures cut at
// 22:00 (roundDown10(now)), arrivals at 21:20 (roundDown10(now) − 40 min
// grace), no upper bound.
describe('filterFutureFlights (search cutoff at windowStart)', () => {
    const now = new Date('2026-09-05T22:00:00+08:00')
    const mk = (over = {}) => ({ ACode: 'BR', FlightNo: '900', AState: 'D', ODate: TODAY, OTime: '08:30:00', Gate: 'C5', Memo: '', ...over })

    it('cuts today flights whose scheduled time already passed, keeps the ones ahead', () => {
        const kept = filterFutureFlights([mk(), mk({ FlightNo: '901', OTime: '23:30:00' })], now)
        expect(kept.map(f => f.FlightNo)).toEqual(['901'])
    })

    it('keeps a departure exactly at the windowStart (roundDown10(now))', () => {
        expect(filterFutureFlights([mk({ OTime: '22:00:00' })], now)).toHaveLength(1)
        // 21:55 is inside the rounding gap but still before windowStart — cut.
        expect(filterFutureFlights([mk({ FlightNo: '906', OTime: '21:55:00' })], now)).toEqual([])
    })

    it('grace zone: an arrival landed minutes ago stays findable (windowStart = roundDown10(now) − 40 min)', () => {
        // now 22:00 -> arrivals windowStart 21:20. A 21:50 arrival (10 min
        // ago) is the pickup case the lower bound exists for.
        const kept = filterFutureFlights([
            mk({ FlightNo: '903', AState: 'A', OTime: '21:50:00' }),
            mk({ FlightNo: '904', AState: 'A', OTime: '21:10:00' }),
            mk({ FlightNo: '905', AState: 'A', OTime: '21:20:00' }),
        ], now)
        expect(kept.map(f => f.FlightNo)).toEqual(['903', '905'])
    })

    it('prefers the revised RDate/RTime over the scheduled time', () => {
        // Scheduled 08:30 (past) revised to 23:10 (ahead) -> kept.
        expect(filterFutureFlights([mk({ RDate: TODAY, RTime: '23:10:00' })], now)).toHaveLength(1)
        // Scheduled 23:30 (ahead) revised to 09:00 (past) -> cut.
        expect(filterFutureFlights([mk({ FlightNo: '902', OTime: '23:30:00', RDate: TODAY, RTime: '09:00:00' })], now)).toEqual([])
    })

    it('an incomplete R pair falls back to the scheduled time', () => {
        // RDate without RTime is ignored — the 08:30 schedule is still past.
        expect(filterFutureFlights([mk({ RDate: TODAY })], now)).toEqual([])
    })

    it('applies to cancelled rows too — past cancellations are cut, future ones stay', () => {
        const kept = filterFutureFlights([
            mk({ FlightNo: '881', Memo: '取消' }),
            mk({ FlightNo: '882', OTime: '23:00:00', Memo: '取消' }),
        ], now)
        expect(kept.map(f => f.FlightNo)).toEqual(['882'])
    })

    it('a row with a missing or unparseable time abstains (kept)', () => {
        expect(filterFutureFlights([mk({ OTime: '' })], now)).toHaveLength(1)
        expect(filterFutureFlights([mk({ OTime: 'not-a-time' })], now)).toHaveLength(1)
    })

    it('is purely time-based — a stale row from another day is cut too', () => {
        expect(filterFutureFlights([mk({ ODate: YESTERDAY, OTime: '08:00:00' })], now)).toEqual([])
    })

    it('defaults `now` to the real clock (search path calls it without args)', () => {
        const farFuture = new Date(Date.now() + 365 * 86400 * 1000)
        const dateStr = new Date(farFuture.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '/')
        expect(filterFutureFlights([mk({ ODate: dateStr, OTime: '23:59:00' })])).toHaveLength(1)
    })
})
