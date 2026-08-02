import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted runs synchronously before any static imports are evaluated.
// This lets us set process.env before api-canary.mjs captures GITHUB_TOKEN as a const.
vi.hoisted(() => {
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.CANARY_GH_RETRY_DELAY_MS = '0'; // no sleep during tests
});

// Mock the playwright probe so importing api-canary.mjs doesn't require a real browser.
vi.mock('./probe.mjs', () => ({
  probeFlightApiPair: vi.fn(),
  isChallengeHtml: vi.fn(() => false),
}));

import { findOpenIncident, ghApiRetry, GH_READ_FAILED, checkFieldPopulation } from './api-canary.mjs';

// fetch is set to vi.fn() globally by src/test/setup.js.
// Each test configures its own responses; vi.resetAllMocks() wipes them between tests.

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ghApiRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ number: 1 }] });
    const result = await ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1');
    expect(result).toEqual([{ number: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and succeeds on the next attempt', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1');
    expect(result).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws after all retry attempts are exhausted', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    await expect(
      ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1', 2),
    ).rejects.toThrow('503');
    expect(fetch).toHaveBeenCalledTimes(2); // exactly maxAttempts
  });

  it('does not retry on 404 (non-retriable error)', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not Found' });
    await expect(
      ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1'),
    ).rejects.toThrow('404');
    expect(fetch).toHaveBeenCalledTimes(1); // no retry for 404
  });

  it('retries on 429 (rate limit)', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Too Many Requests' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await ghApiRetry('/repos/TPE-eagle/tpe-sushi-go-round/issues?labels=x&state=open&per_page=1');
    expect(result).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('findOpenIncident', () => {
  it('returns null when no open incidents', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await findOpenIncident();
    expect(result).toBeNull();
  });

  it('returns the open incident object when one exists', async () => {
    const issue = { number: 42, title: '🚨 API down (availability)', created_at: '2026-07-17T00:00:00Z' };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [issue] });
    const result = await findOpenIncident();
    expect(result).toEqual(issue);
  });

  it('returns GH_READ_FAILED when GitHub API returns 503 on every attempt (default 3 retries)', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    const result = await findOpenIncident();
    expect(result).toBe(GH_READ_FAILED);
    expect(fetch).toHaveBeenCalledTimes(3); // exhausted all 3 attempts
  });

  it('recovers and returns null when a retry succeeds after an initial 503', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await findOpenIncident();
    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('GH_READ_FAILED is a Symbol distinct from null', () => {
    expect(typeof GH_READ_FAILED).toBe('symbol');
    expect(GH_READ_FAILED).not.toBeNull();
  });
});

describe('checkFieldPopulation', () => {
  // Fixed reference instant so window math is deterministic. Arrival window for this
  // `now` is 03:20:00-05:20:59; departure window is 04:00:00-06:00:59 (see
  // getTimeWindowConfig in src/utils/flightUtils.js).
  const NOW = new Date('2026-01-15T04:00:00+08:00');
  const ARRIVAL_OTIME = '04:00:00'; // inside both windows' overlap, used for mode 'A' rows
  const DEPARTURE_OTIME = '04:30:00'; // inside the departure window, used for mode 'D' rows

  function makeRecord(otime, stopCodeValue, overrides = {}) {
    return {
      ACode: 'BR',
      Memo: '',
      ODate: '2026/01/15',
      OTime: otime,
      StopCode: stopCodeValue,
      Gate: stopCodeValue,
      ...overrides,
    };
  }

  function makeRecords(otime, count, unpopulatedCount, field = 'StopCode') {
    return Array.from({ length: count }, (_, i) =>
      makeRecord(otime, i < unpopulatedCount ? '' : '05', { [field]: i < unpopulatedCount ? '' : '05' }),
    );
  }

  it('returns null when the ratio is at or above the 95% threshold', () => {
    const records = makeRecords(ARRIVAL_OTIME, 20, 1); // 19/20 = 95%
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('returns a detail string when the ratio is below the 95% threshold', () => {
    const records = makeRecords(ARRIVAL_OTIME, 20, 2); // 18/20 = 90%
    const detail = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW);
    expect(detail).not.toBeNull();
    expect(detail).toContain('StopCode');
    expect(detail).toContain('18/20');
  });

  it('returns null (skips the check) when no rows fall in the rendered window', () => {
    const records = makeRecords('23:00:00', 20, 20); // all rows outside the window, none populated
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('treats "", whitespace-only, and "-" as unpopulated', () => {
    const records = [
      makeRecord(ARRIVAL_OTIME, '05'),
      makeRecord(ARRIVAL_OTIME, ''),
      makeRecord(ARRIVAL_OTIME, '   '),
      makeRecord(ARRIVAL_OTIME, '-'),
    ];
    const detail = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW);
    expect(detail).toContain('1/4');
  });

  it('excludes unsupported airlines and cancelled flights from the denominator', () => {
    const records = [
      makeRecord(ARRIVAL_OTIME, '05'),
      makeRecord(ARRIVAL_OTIME, '', { ACode: 'XX' }), // not a supported airline — excluded
      makeRecord(ARRIVAL_OTIME, '', { Memo: '取消' }), // cancelled — excluded
    ];
    // Only the first row counts; it's populated, so the ratio is 1/1 = 100%.
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('uses the departure window and Gate field for mode D', () => {
    const records = makeRecords(DEPARTURE_OTIME, 20, 2, 'Gate'); // 18/20 = 90%
    const detail = checkFieldPopulation(records, 'Gate', 'D', 'Departures', NOW);
    expect(detail).not.toBeNull();
    expect(detail).toContain('Gate');
    expect(detail).toContain('18/20');
  });
});
