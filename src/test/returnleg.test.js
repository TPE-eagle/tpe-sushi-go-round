// Tests for findReturnLeg() (issue #33). Fixtures are real flight records
// pulled from the live Taoyuan Airport API on 2026/07/31 — same date, same
// flights, same times the issue's own analysis used, so these double as a
// reproduction of the issue's validation set (5 must-kill + 5 must-survive
// rows) rather than synthetic examples.
import { describe, it, expect } from 'vitest'
import { findReturnLeg, getMinPlausibleRoundTripMinutes, BLOCK_TIME_MINUTES } from '../utils/blockTimes.js'

function dep(ACode, FlightNo, CityCode, ODate, OTime, Gate) {
    return { ACode, FlightNo, CityCode, ODate, OTime, Gate, AState: 'D' }
}
function arr(ACode, FlightNo, CityCode, ODate, OTime, Gate) {
    return { ACode, FlightNo, CityCode, ODate, OTime, Gate, AState: 'A' }
}

describe('findReturnLeg — happy path', () => {
    it('pairs a departure with its adjacent, later-scheduled, plausible-gap arrival', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        const a = arr('BR', '396', 'SGN', '2026/07/31', '20:10:00', 'C4')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('returns null when there are no candidates at all', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        expect(findReturnLeg(d, [])).toBeNull()
    })

    it('adjacency alone is not enough — an adjacent-numbered arrival for a different city is ignored', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        const wrongCity = arr('BR', '396', 'BKK', '2026/07/31', '20:10:00', 'C4')
        expect(findReturnLeg(d, [wrongCity])).toBeNull()
    })

    it('an arrival scheduled before the departure is never a candidate, even if otherwise adjacent', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        const earlier = arr('BR', '396', 'SGN', '2026/07/31', '06:00:00', 'C4')
        expect(findReturnLeg(d, [earlier])).toBeNull()
    })

    it('a neighbouring ODate (day before/after in a full-day pull) is never matched', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        const nextDay = arr('BR', '396', 'SGN', '2026/08/01', '20:10:00', 'C4')
        expect(findReturnLeg(d, [nextDay])).toBeNull()
    })

    it('unknown city (not in the block-time table) abstains rather than guessing', () => {
        const d = dep('BR', '999', 'ZZZ', '2026/07/31', '07:40:00', 'C3')
        const a = arr('BR', '1000', 'ZZZ', '2026/07/31', '20:10:00', 'C4')
        expect(findReturnLeg(d, [a])).toBeNull()
        expect(BLOCK_TIME_MINUTES.ZZZ).toBeUndefined()
    })
})

describe('findReturnLeg — 5 must-kill false-positive rows (issue #33)', () => {
    it('JX12 SFO 00:05 -> JX11 arr 04:50 (4.8h, SFO needs ~27h): no match', () => {
        const d = dep('JX', '12', 'SFO', '2026/07/31', '00:05:00', 'D12')
        const a = arr('JX', '11', 'SFO', '2026/07/31', '04:50:00', 'D2')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('JX2 LAX 00:10 -> JX1 arr 05:20 (5.2h, LAX needs ~28h): no match', () => {
        const d = dep('JX', '2', 'LAX', '2026/07/31', '00:10:00', 'D11')
        const a = arr('JX', '1', 'LAX', '2026/07/31', '05:20:00', 'D8')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('BR6 LAX 10:10 -> BR5 arr 16:55 (6.8h): no match', () => {
        const d = dep('BR', '6', 'LAX', '2026/07/31', '10:10:00', 'C2')
        const a = arr('BR', '5', 'LAX', '2026/07/31', '16:55:00', 'C3')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('BR8 SFO 10:15 -> BR7 arr 16:50 (6.6h): no match', () => {
        const d = dep('BR', '8', 'SFO', '2026/07/31', '10:15:00', 'C1')
        const a = arr('BR', '7', 'SFO', '2026/07/31', '16:50:00', 'C4')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('CI835 BKK 13:30 -> CI834 arr 15:30 (2.0h, CI834 is actually CI833\'s return): no match', () => {
        const d = dep('CI', '835', 'BKK', '2026/07/31', '13:30:00', 'A9')
        const a = arr('CI', '834', 'BKK', '2026/07/31', '15:30:00', 'A2')
        expect(findReturnLeg(d, [a])).toBeNull()
    })
})

describe('findReturnLeg — 5 must-survive long-gap rows (issue #33)', () => {
    it('JX761 CGK 06:55 -> JX762 arr 19:00 (~12.1h): matches', () => {
        const d = dep('JX', '761', 'CGK', '2026/07/31', '06:55:00', 'D12')
        const a = arr('JX', '762', 'CGK', '2026/07/31', '19:00:00', 'D12')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('BR395 SGN 07:40 -> BR396 arr 20:10 (~12.5h): matches', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        const a = arr('BR', '396', 'SGN', '2026/07/31', '20:10:00', 'C4')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('BR67 BKK 08:20 -> BR68 arr 21:35 (~13.2h): matches', () => {
        const d = dep('BR', '67', 'BKK', '2026/07/31', '08:20:00', 'C2')
        const a = arr('BR', '68', 'BKK', '2026/07/31', '21:35:00', 'C9')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('CI771 DPS 09:10 -> CI772 arr 21:15 (~12.1h): matches', () => {
        const d = dep('CI', '771', 'DPS', '2026/07/31', '09:10:00', 'B4')
        const a = arr('CI', '772', 'DPS', '2026/07/31', '21:15:00', 'D2')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('BR255 DPS 09:50 -> BR256 arr 22:00 (~12.2h): matches', () => {
        const d = dep('BR', '255', 'DPS', '2026/07/31', '09:50:00', 'D9')
        const a = arr('BR', '256', 'DPS', '2026/07/31', '22:00:00', 'B9')
        expect(findReturnLeg(d, [a])).toBe(a)
    })
})

describe('findReturnLeg — multi-candidate tie-break (real dense-route case, CI835/833/834/836)', () => {
    // Same live data: CI835 has TWO flight-number-adjacent BKK arrivals —
    // CI834 (gap 2.0h, fails the gate) and CI836 (gap ~8.6h, passes). Only
    // CI836 should ever be returned; CI834 must never win even though it's
    // the closer flight number.
    const CI834 = arr('CI', '834', 'BKK', '2026/07/31', '15:30:00', 'A2')
    const CI836 = arr('CI', '836', 'BKK', '2026/07/31', '22:05:00', 'A5')

    it('picks the gate-passing candidate (CI836) over the gate-failing closer one (CI834)', () => {
        const d = dep('CI', '835', 'BKK', '2026/07/31', '13:30:00', 'A9')
        expect(findReturnLeg(d, [CI834, CI836])).toBe(CI836)
    })

    it('when multiple candidates all pass the gate, the smallest gap wins', () => {
        const d = dep('CI', '835', 'BKK', '2026/07/31', '13:30:00', 'A9')
        const alsoPasses = arr('CI', '836', 'BKK', '2026/07/31', '23:59:00', 'A6') // larger gap than CI836 above
        expect(findReturnLeg(d, [CI836, alsoPasses])).toBe(CI836)
    })
})

describe('getMinPlausibleRoundTripMinutes', () => {
    it('returns 2x block time + 40min turnaround for a known city', () => {
        // SGN block = 195min -> 2*195+40 = 430min
        expect(getMinPlausibleRoundTripMinutes('SGN')).toBe(430)
    })

    it('returns null for an unknown city', () => {
        expect(getMinPlausibleRoundTripMinutes('ZZZ')).toBeNull()
    })
})
