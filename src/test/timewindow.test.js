import { describe, it, expect } from 'vitest'
import {
    parseApiResponse,
    filterFlightsByTime,
    getTimeWindow,
    getTimeWindowConfig,
    endOfUTC8Day,
    formatToUTC8_HHMM
} from '../utils/flightUtils.js'

// Issue #88 — time-window selector: cycle +2/+4/+6/+8h on today's payload,
// truncate the window at the end of now's UTC+8 day. All times are pinned
// with explicit +08:00 offsets so the assertions are timezone-independent.

describe('getTimeWindowConfig forwardHours (issue #88)', () => {
    it('defaults to forwardHours 2 for both modes, with no durationMinutes left behind', () => {
        // Single source of truth: the old `durationMinutes: 120` is gone.
        expect(getTimeWindowConfig('A')).toEqual({
            roundingStepMinutes: 10,
            offsetFromRoundedMinutes: -40,
            forwardHours: 2
        });
        expect(getTimeWindowConfig('D')).toEqual({
            roundingStepMinutes: 10,
            offsetFromRoundedMinutes: 0,
            forwardHours: 2
        });
        expect(getTimeWindowConfig('A')).not.toHaveProperty('durationMinutes');
        expect(getTimeWindowConfig('D')).not.toHaveProperty('durationMinutes');
    });

    it('threads a custom forwardHours through for both modes', () => {
        expect(getTimeWindowConfig('A', 8).forwardHours).toBe(8);
        expect(getTimeWindowConfig('D', 4).forwardHours).toBe(4);
    });
});

describe('+2h default reproduces the historical window (regression)', () => {
    const fixedTime = new Date('2025-06-08T06:00:00+08:00'); // 6:00 AM UTC+8

    it('arrivals: 05:20 → 07:20 (now−40 → +80)', () => {
        const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('A'), fixedTime);
        expect(formatToUTC8_HHMM(windowStart)).toBe('05:20');
        expect(formatToUTC8_HHMM(windowEnd)).toBe('07:20');
    });

    it('departures: 06:00 → 08:00 (now → +120)', () => {
        const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('D'), fixedTime);
        expect(formatToUTC8_HHMM(windowStart)).toBe('06:00');
        expect(formatToUTC8_HHMM(windowEnd)).toBe('08:00');
    });
});

describe('+4/+6/+8h extend the forward edge only (issue #88 D1)', () => {
    const fixedTime = new Date('2025-06-08T06:00:00+08:00');

    it('arrivals: the −40 min backward component never scales', () => {
        const expectations = { 4: '09:20', 6: '11:20', 8: '13:20' };
        for (const [hours, expectedEnd] of Object.entries(expectations)) {
            const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('A', Number(hours)), fixedTime);
            expect(formatToUTC8_HHMM(windowStart)).toBe('05:20'); // unchanged at every width
            expect(formatToUTC8_HHMM(windowEnd)).toBe(expectedEnd);
        }
    });

    it('departures: start stays at the rounded now', () => {
        const expectations = { 4: '10:00', 6: '12:00', 8: '14:00' };
        for (const [hours, expectedEnd] of Object.entries(expectations)) {
            const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('D', Number(hours)), fixedTime);
            expect(formatToUTC8_HHMM(windowStart)).toBe('06:00');
            expect(formatToUTC8_HHMM(windowEnd)).toBe(expectedEnd);
        }
    });
});

describe('midnight truncation (issue #88)', () => {
    const taipeiEndOfDay = new Date('2025-06-08T23:59:59.999+08:00').getTime();

    it('bites windowEnd at Taipei 23:59:59.999 — arrivals +2h started at 23:00', () => {
        const now = new Date('2025-06-08T23:00:00+08:00');
        const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('A', 2), now);
        expect(formatToUTC8_HHMM(windowStart)).toBe('22:20');
        expect(windowEnd.getTime()).toBe(taipeiEndOfDay); // would be 00:20 next day untruncated
    });

    it('bites at +8h well before midnight — departures 17:00 would reach 01:20 next day', () => {
        const now = new Date('2025-06-08T17:00:00+08:00');
        const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('D', 8), now);
        expect(formatToUTC8_HHMM(windowStart)).toBe('17:00');
        expect(windowEnd.getTime()).toBe(taipeiEndOfDay);
    });

    it('never touches windowStart — arrivals around Taipei midnight keep their previous-day start', () => {
        // 00:10 arrivals: windowStart legally sits on the previous day
        // (23:30, June 7). Truncation anchors on now's UTC+8 day and only
        // ever bites the end, so the start must stay on June 7.
        const now = new Date('2025-06-08T00:10:00+08:00');
        const { windowStart, windowEnd } = getTimeWindow(getTimeWindowConfig('A', 2), now);
        expect(windowStart.getTime()).toBe(new Date('2025-06-07T23:30:00+08:00').getTime());
        expect(windowEnd.getTime()).toBe(new Date('2025-06-08T01:30:59.999+08:00').getTime());
    });

    it('leaves mid-day windows untouched (+4h at noon is not truncated)', () => {
        const now = new Date('2025-06-08T12:00:00+08:00');
        const { windowEnd } = getTimeWindow(getTimeWindowConfig('D', 4), now);
        // :59.999 of the end minute is the pre-existing inclusive-end behaviour.
        expect(windowEnd.getTime()).toBe(new Date('2025-06-08T16:00:59.999+08:00').getTime());
    });
});

describe('endOfUTC8Day (issue #88)', () => {
    it('returns 23:59:59.999 of the UTC+8 day containing now', () => {
        // 2025-06-08T17:00Z == Taipei 2025-06-09 01:00
        expect(endOfUTC8Day(new Date('2025-06-08T17:00:00Z')).getTime())
            .toBe(new Date('2025-06-09T15:59:59.999Z').getTime());
    });

    it('treats UTC 16:00 as the Taipei-midnight day boundary', () => {
        // Exactly Taipei midnight rolls the day over…
        expect(endOfUTC8Day(new Date('2025-06-08T16:00:00Z')).getTime())
            .toBe(new Date('2025-06-09T15:59:59.999Z').getTime());
        // …while the last millisecond of the day still belongs to it.
        expect(endOfUTC8Day(new Date('2025-06-08T15:59:59.999Z')).getTime())
            .toBe(new Date('2025-06-08T15:59:59.999Z').getTime());
    });
});

describe('filterFlightsByTime forwardHours (issue #88)', () => {
    const now = new Date('2025-06-08T06:00:00+08:00'); // A window: 05:20 → 07:20

    const flight = (oTime, rTime = null) => ({
        ODate: '2025/06/08',
        OTime: oTime,
        RDate: rTime ? '2025/06/08' : null,
        RTime: rTime,
        Memo: ''
    });

    it('excludes a flight beyond +2h and includes it at +8h', () => {
        const flights = [flight('10:00:00')];
        expect(filterFlightsByTime(flights, 'A', now)).toHaveLength(0);
        expect(filterFlightsByTime(flights, 'A', now, 8)).toHaveLength(1);
    });

    it('keeps the legacy 3-argument call at +2h (api-canary contract)', () => {
        expect(filterFlightsByTime([flight('07:00:00')], 'A', now)).toHaveLength(1);
        expect(filterFlightsByTime([flight('08:00:00')], 'A', now)).toHaveLength(0);
    });

    it('still matches on RDateTime within a wider window', () => {
        const revised = [flight('04:00:00', '06:30:00')]; // O out of window, R in
        expect(filterFlightsByTime(revised, 'A', now, 8)).toHaveLength(1);
    });

    it('truncation keeps a revised time past Taipei midnight out of the board', () => {
        // Departures 23:00 +8h would reach 07:00 next day untruncated. A
        // delayed row whose revised (RDate) time lands after midnight must
        // not match — the window never crosses the day boundary.
        const lateNow = new Date('2025-06-08T23:00:00+08:00');
        const delayedPastMidnight = [{
            ODate: '2025/06/08', OTime: '22:00:00',
            RDate: '2025/06/09', RTime: '00:30:00',
            Memo: 'delay'
        }];
        expect(filterFlightsByTime(delayedPastMidnight, 'D', lateNow, 8)).toHaveLength(0);
    });
});

describe('parseApiResponse threads forwardHours (issue #88)', () => {
    const now = new Date('2025-06-08T06:00:00+08:00');

    const payload = () => ([{
        ACode: 'BR', FlightNo: '35', ODate: '2025/06/08', OTime: '10:00:00',
        RDate: '2025/06/08', RTime: '10:30:00', Memo: '', PlaneNo: 'B777-300'
    }]);

    it('defaults to the +2h window', () => {
        expect(parseApiResponse(payload(), 'A', now)).toHaveLength(0);
    });

    it('accepts an explicit forwardHours', () => {
        expect(parseApiResponse(payload(), 'A', now, 8)).toHaveLength(1);
    });
});
