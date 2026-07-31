// Tests for findReturnLeg() / dayReturn() (issue #33). Fixtures for the
// original 5 must-kill + 5 must-survive rows are real flight records pulled
// from the live Taoyuan Airport API on 2026/07/31 by the issue's original
// analysis. Fixtures added for the amended rule (PlaneNo, implied-ground
// upper bound, dayReturn override, and the newly-enumerated must-match rows)
// are constructed from the gap/time relationships already stated in the
// issue text — this environment has no live network access (the airport API
// sits behind a Cloudflare challenge from here), so these are NOT an
// independent live re-pull, just a faithful encoding of the numbers the
// issue already gives (e.g. "BR67 BKK 08:20 -> BR68 arr 21:35 (~13.2h)").
import { describe, it, expect } from 'vitest'
import {
    findReturnLeg,
    getMinPlausibleRoundTripMinutes,
    getUncoveredCityCodes,
    dayReturn,
    BLOCK_TIME_MINUTES,
} from '../utils/blockTimes.js'

const DEFAULT_PLANE_NO = 'A321-200';

function dep(ACode, FlightNo, CityCode, ODate, OTime, Gate, PlaneNo = DEFAULT_PLANE_NO) {
    return { ACode, FlightNo, CityCode, ODate, OTime, Gate, PlaneNo, AState: 'D' }
}
function arr(ACode, FlightNo, CityCode, ODate, OTime, Gate, PlaneNo = DEFAULT_PLANE_NO) {
    return { ACode, FlightNo, CityCode, ODate, OTime, Gate, PlaneNo, AState: 'A' }
}

describe('findReturnLeg — happy path', () => {
    it('pairs a departure with its adjacent, later-scheduled, plausible-gap, same-type arrival', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('returns null when there are no candidates at all', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        expect(findReturnLeg(d, [])).toBeNull()
    })

    it('adjacency alone is not enough — an adjacent-numbered arrival for a different city is ignored', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        const wrongCity = arr('CI', '111', 'BKK', '2026/07/31', '13:40:00', 'C4')
        expect(findReturnLeg(d, [wrongCity])).toBeNull()
    })

    it('an arrival scheduled before the departure is never a candidate, even if otherwise adjacent', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        const earlier = arr('CI', '111', 'FUK', '2026/07/31', '06:00:00', 'C4')
        expect(findReturnLeg(d, [earlier])).toBeNull()
    })

    it('a neighbouring ODate (day before/after in a full-day pull) is never matched', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        const nextDay = arr('CI', '111', 'FUK', '2026/08/01', '13:40:00', 'C4')
        expect(findReturnLeg(d, [nextDay])).toBeNull()
    })

    it('unknown city (not in the block-time table) abstains rather than guessing', () => {
        const d = dep('BR', '999', 'ZZZ', '2026/07/31', '07:40:00', 'C3')
        const a = arr('BR', '1000', 'ZZZ', '2026/07/31', '20:10:00', 'C4')
        expect(findReturnLeg(d, [a])).toBeNull()
        expect(BLOCK_TIME_MINUTES.ZZZ).toBeUndefined()
    })

    it('one representative case of "return arrival earlier than departure" (long-haul inbound already on the arrivals board) — the same structural invariant as the generic case above, using an issue-listed flight number', () => {
        // Issue #33 lists 13 flight numbers in this bucket (BR12, BR16, BR18,
        // CI4, CI8, JX12, JX2, CI837, BR205, BR261, BR381, CI755, CI150).
        // Reproducing all 13 would need their real scheduled times, which
        // requires live API access this environment doesn't have. This one
        // case pins the invariant the code actually implements; the other 12
        // are the same code path (aTime > dTime), already covered generically
        // above.
        const d = dep('BR', '12', 'LAX', '2026/07/31', '18:00:00', 'C1')
        const inboundAlreadyLanded = arr('BR', '11', 'LAX', '2026/07/31', '09:00:00', 'C2')
        expect(findReturnLeg(d, [inboundAlreadyLanded])).toBeNull()
    })
})

describe('findReturnLeg — F1 (issue #33 amendment): PlaneNo (aircraft type) must match', () => {
    it('BR130 B777-300ER -> BR129 B787-10 (KIX, 6.9h): equipment swap, no match even though timing is plausible', () => {
        const d = dep('BR', '130', 'KIX', '2026/07/31', '07:00:00', 'C1', 'B777-300ER')
        const a = arr('BR', '129', 'KIX', '2026/07/31', '13:54:00', 'C2', 'B787-10')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('CI505 A321-271N -> CI504 A350-900 (PVG, 4.3h): equipment swap, no match even though timing is plausible', () => {
        const d = dep('CI', '505', 'PVG', '2026/07/31', '07:00:00', 'A1', 'A321-271N')
        const a = arr('CI', '504', 'PVG', '2026/07/31', '11:18:00', 'A2', 'A350-900')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('missing PlaneNo on the departure is treated as no match, not as equal to anything', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3', '-')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4', 'A321-200')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('missing PlaneNo on the arrival is treated as no match, not as equal to anything', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3', 'A321-200')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4', '')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('missing PlaneNo on BOTH legs is still no match — two unknowns are never treated as equal', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3', '-')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4', '-')
        expect(findReturnLeg(d, [a])).toBeNull()
    })
})

describe('findReturnLeg — R1 (PR #35 review): aircraft FAMILY equality, not exact PlaneNo string', () => {
    it('same family, different variant (B787-9 -> B787-10) still matches — type ratings are family-level', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3', 'B787-9')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4', 'B787-10')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('unresolvable family on either leg is no match, even when the raw PlaneNo strings are identical (E190 does not parse as [AB]\\d{3})', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3', 'E190')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4', 'E190')
        expect(findReturnLeg(d, [a])).toBeNull()
    })
})

describe('findReturnLeg — F2 (issue #33 amendment): implied-ground upper bound (2*block + 4h)', () => {
    it('BR67 BKK 08:20 -> BR68 arr 21:35 (~13.2h gap, ~6.0h implied ground): no match — implied ground exceeds the 4h ceiling', () => {
        const d = dep('BR', '67', 'BKK', '2026/07/31', '08:20:00', 'C2')
        const a = arr('BR', '68', 'BKK', '2026/07/31', '21:35:00', 'C9')
        expect(findReturnLeg(d, [a])).toBeNull()
    })

    it('BR395 SGN 07:40 -> BR396 arr 20:10 (~12.5h gap, ~6.0h implied ground): no match — implied ground exceeds the 4h ceiling (superseded; this pair was a must-survive row before the amendment)', () => {
        const d = dep('BR', '395', 'SGN', '2026/07/31', '07:40:00', 'C3')
        const a = arr('BR', '396', 'SGN', '2026/07/31', '20:10:00', 'C4')
        expect(findReturnLeg(d, [a])).toBeNull()
    })
})

describe('findReturnLeg — 5 must-kill false-positive rows (issue #33, gap too short)', () => {
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

describe('findReturnLeg — must-match rows newly enumerated in the issue (issue #33 S2)', () => {
    it('BR112 -> BR113 (OKA)', () => {
        const d = dep('BR', '112', 'OKA', '2026/07/31', '08:00:00', 'B3')
        const a = arr('BR', '113', 'OKA', '2026/07/31', '13:00:00', 'B4')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('CI110 -> CI111 (FUK)', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        const a = arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('CI278 -> CI279 (TAK)', () => {
        const d = dep('CI', '278', 'TAK', '2026/07/31', '08:00:00', 'D1')
        const a = arr('CI', '279', 'TAK', '2026/07/31', '15:20:00', 'D2')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('JX800 -> JX801 (NRT)', () => {
        const d = dep('JX', '800', 'NRT', '2026/07/31', '06:30:00', 'D9')
        const a = arr('JX', '801', 'NRT', '2026/07/31', '15:20:00', 'D10')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('CI861 -> CI862 (city not specified in the issue text — HKG chosen as a plausible short/medium-haul city for an 8xx-series CI pair; the assertion tests the pairing/gate logic, not this specific route)', () => {
        const d = dep('CI', '861', 'HKG', '2026/07/31', '08:00:00', 'A1')
        const a = arr('CI', '862', 'HKG', '2026/07/31', '12:40:00', 'A2')
        expect(findReturnLeg(d, [a])).toBe(a)
    })

    it('BR265 -> BR266 (KTI — the non-IATA city code for Phnom Penh, the silent-blank trap the issue calls out)', () => {
        const d = dep('BR', '265', 'KTI', '2026/07/31', '07:00:00', 'C5')
        const a = arr('BR', '266', 'KTI', '2026/07/31', '16:00:00', 'C6')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(BLOCK_TIME_MINUTES.KTI).toBeDefined()
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

describe('dayReturn — F3 (issue #33 amendment): crew-pattern night-stop override', () => {
    it('defaults to true for any (airline, city) pair not in the override list', () => {
        expect(dayReturn('BR', 'OKA')).toBe(true)
        expect(dayReturn('CI', 'FUK')).toBe(true)
    })

    it.each(['CTS', 'SIN', 'KUL', 'PEN', 'CGK', 'DPS'])(
        '%s is a night stop for every carrier (airline-agnostic override)',
        (city) => {
            expect(dayReturn('BR', city)).toBe(false)
            expect(dayReturn('CI', city)).toBe(false)
            expect(dayReturn('JX', city)).toBe(false)
        },
    )

    it('BKK is a night stop for BR only — pilot ruling is the BKK day return belongs to CI/JX, not EVA', () => {
        expect(dayReturn('BR', 'BKK')).toBe(false)
        expect(dayReturn('CI', 'BKK')).toBe(true)
        expect(dayReturn('JX', 'BKK')).toBe(true)
    })
})

describe('dayReturn override applied independently of the pairing/time gate (issue #33 F3 + review requirement: "assert both paths independently")', () => {
    it('BR67/BKK: findReturnLeg already rejects it on the implied-ground gate AND dayReturn independently says false — both paths reject it on their own', () => {
        const d = dep('BR', '67', 'BKK', '2026/07/31', '08:20:00', 'C2')
        const a = arr('BR', '68', 'BKK', '2026/07/31', '21:35:00', 'C9')
        expect(findReturnLeg(d, [a])).toBeNull() // rejected by the gate
        expect(dayReturn('BR', 'BKK')).toBe(false) // independently rejected by the override
    })

    it('JX761/CGK: findReturnLeg finds a plausible pairing (proving the gate alone would show a gate) but dayReturn says false — the override must still blank it', () => {
        const d = dep('JX', '761', 'CGK', '2026/07/31', '06:55:00', 'D12')
        const a = arr('JX', '762', 'CGK', '2026/07/31', '19:00:00', 'D12')
        expect(findReturnLeg(d, [a])).toBe(a) // the pairing gate alone says "match"
        expect(dayReturn('JX', 'CGK')).toBe(false) // the override says "but it's a night stop"
    })

    it('CI771/DPS: same shape — plausible pairing, overridden to blank', () => {
        const d = dep('CI', '771', 'DPS', '2026/07/31', '09:10:00', 'B4')
        const a = arr('CI', '772', 'DPS', '2026/07/31', '21:15:00', 'D2')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(dayReturn('CI', 'DPS')).toBe(false)
    })

    it('BR255/DPS: same shape — plausible pairing, overridden to blank', () => {
        const d = dep('BR', '255', 'DPS', '2026/07/31', '09:50:00', 'D9')
        const a = arr('BR', '256', 'DPS', '2026/07/31', '22:00:00', 'B9')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(dayReturn('BR', 'DPS')).toBe(false)
    })

    it('BR166/CTS: same shape — plausible pairing, overridden to blank', () => {
        const d = dep('BR', '166', 'CTS', '2026/07/31', '07:00:00', 'C7')
        const a = arr('BR', '167', 'CTS', '2026/07/31', '17:00:00', 'C8')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(dayReturn('BR', 'CTS')).toBe(false)
    })

    it('BR225/SIN: same shape — plausible pairing, overridden to blank', () => {
        const d = dep('BR', '225', 'SIN', '2026/07/31', '07:00:00', 'D3')
        const a = arr('BR', '226', 'SIN', '2026/07/31', '17:50:00', 'D4')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(dayReturn('BR', 'SIN')).toBe(false)
    })

    it('BR217/KUL: same shape — plausible pairing, overridden to blank', () => {
        const d = dep('BR', '217', 'KUL', '2026/07/31', '07:00:00', 'C1')
        const a = arr('BR', '218', 'KUL', '2026/07/31', '17:50:00', 'C2')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(dayReturn('BR', 'KUL')).toBe(false)
    })

    it('CI/PEN: same shape — plausible pairing, overridden to blank (issue does not give the exact flight number for this row; representative number used)', () => {
        const d = dep('CI', '751', 'PEN', '2026/07/31', '07:00:00', 'B1')
        const a = arr('CI', '752', 'PEN', '2026/07/31', '17:50:00', 'B2')
        expect(findReturnLeg(d, [a])).toBe(a)
        expect(dayReturn('CI', 'PEN')).toBe(false)
    })
})

describe('getUncoveredCityCodes — N1 (issue #33): fail loudly when a CityCode has no block-time entry', () => {
    it('returns an empty array when every CityCode in the feed is covered', () => {
        const feed = [
            dep('BR', '112', 'OKA', '2026/07/31', '08:00:00', 'B3'),
            arr('CI', '111', 'FUK', '2026/07/31', '13:40:00', 'C4'),
        ]
        expect(getUncoveredCityCodes(feed)).toEqual([])
    })

    it('surfaces a missing CityCode instead of silently dropping the row (KTI is the real-world example — Phnom Penh, not the IATA code PNH)', () => {
        const feed = [
            dep('BR', '999', 'ZZZ', '2026/07/31', '07:40:00', 'C3'),
            arr('BR', '1000', 'ZZZ', '2026/07/31', '20:10:00', 'C4'),
        ]
        expect(getUncoveredCityCodes(feed)).toEqual(['ZZZ'])
    })
})

describe('findReturnLeg — R2 (PR #35 review): the adjacency rule rejects non-adjacent flight numbers', () => {
    it('a ΔFlightNo == 2 candidate that is otherwise perfectly plausible (same carrier/city/date/family, gap inside the band) is not matched', () => {
        const d = dep('CI', '110', 'FUK', '2026/07/31', '07:00:00', 'C3')
        const notAdjacent = arr('CI', '112', 'FUK', '2026/07/31', '13:40:00', 'C4')
        expect(findReturnLeg(d, [notAdjacent])).toBeNull()
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
