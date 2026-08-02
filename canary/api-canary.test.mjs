import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs synchronously before any static imports are evaluated.
// This lets us set process.env before api-canary.mjs captures GITHUB_TOKEN as a const.
vi.hoisted(() => {
  process.env.GITHUB_TOKEN = 'test-token';
  process.env.CANARY_GH_RETRY_DELAY_MS = '0'; // no sleep during tests
  process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test/token';
});

// Mock the playwright probe so importing api-canary.mjs doesn't require a real browser.
vi.mock('./probe.mjs', () => ({
  probeFlightApiPair: vi.fn(),
  isChallengeHtml: vi.fn(() => false),
}));

import { probeFlightApiPair } from './probe.mjs';
import {
  findOpenIncidents,
  incidentClass,
  ghApiRetry,
  GH_READ_FAILED,
  checkFieldPopulation,
  checkRecordShape,
  sampleAndCheckShape,
  ARRIVALS_FIELDS,
  DEPARTURES_FIELDS,
  run,
} from './api-canary.mjs';

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

describe('findOpenIncidents', () => {
  it('returns an empty array when no open incidents', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await findOpenIncidents();
    expect(result).toEqual([]);
  });

  it('returns every open incident, not just the first (issue #86)', async () => {
    const contractIssue = { number: 41, title: '🚨 API contract drift', created_at: '2026-07-17T00:00:00Z', labels: [{ name: 'status:incident' }, { name: 'canary:contract' }] };
    const availabilityIssue = { number: 42, title: '🚨 API down (availability)', created_at: '2026-07-18T00:00:00Z', labels: [{ name: 'status:incident' }, { name: 'canary:availability' }] };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [contractIssue, availabilityIssue] });
    const result = await findOpenIncidents();
    expect(result).toEqual([contractIssue, availabilityIssue]);
  });

  it('returns GH_READ_FAILED when GitHub API returns 503 on every attempt (default 3 retries)', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'Service Unavailable' });
    const result = await findOpenIncidents();
    expect(result).toBe(GH_READ_FAILED);
    expect(fetch).toHaveBeenCalledTimes(3); // exhausted all 3 attempts
  });

  it('recovers and returns an empty array when a retry succeeds after an initial 503', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    const result = await findOpenIncidents();
    expect(result).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('GH_READ_FAILED is a Symbol distinct from an empty array', () => {
    expect(typeof GH_READ_FAILED).toBe('symbol');
    expect(GH_READ_FAILED).not.toEqual([]);
  });
});

describe('incidentClass', () => {
  it('reads the failure class from a canary:<type> label', () => {
    const issue = { labels: [{ name: 'status:incident' }, { name: 'canary:availability' }] };
    expect(incidentClass(issue)).toBe('availability');
  });

  it('handles labels returned as plain strings (some GitHub API responses use this shape)', () => {
    const issue = { labels: ['status:incident', 'canary:contract'] };
    expect(incidentClass(issue)).toBe('contract');
  });

  it('returns null for an issue with no canary:<type> label (pre-migration/unknown class)', () => {
    const issue = { labels: [{ name: 'status:incident' }] };
    expect(incidentClass(issue)).toBeNull();
  });

  it('returns null for an issue with no labels array at all', () => {
    expect(incidentClass({})).toBeNull();
  });
});

describe('checkFieldPopulation', () => {
  // Fixed reference instant so window math is deterministic. Arrival window for this
  // `now` is 03:20:00-05:20:59; departure window is 04:00:00-06:00:59 (see
  // getTimeWindowConfig in src/utils/flightUtils.js).
  const NOW = new Date('2026-01-15T04:00:00+08:00');
  const ARRIVAL_OTIME = '04:00:00'; // inside both windows' overlap, used for mode 'A' rows
  const DEPARTURE_OTIME = '04:30:00'; // inside the departure window, used for mode 'D' rows

  function makeRecord(otime, value, overrides = {}) {
    return {
      ACode: 'BR',
      Memo: '',
      ODate: '2026/01/15',
      OTime: otime,
      StopCode: value,
      Gate: value,
      ...overrides,
    };
  }

  // Baseline value is always populated ('05'); only the target `field` gets the
  // populated/unpopulated split, via override — avoids double-writing the same field
  // through both the positional arg and the override (PR #84 review non-blocking #2).
  function makeRecords(otime, count, unpopulatedCount, field = 'StopCode') {
    return Array.from({ length: count }, (_, i) =>
      makeRecord(otime, '05', { [field]: i < unpopulatedCount ? '' : '05' }),
    );
  }

  it('returns null when the ratio is at or above the 95% threshold', () => {
    const records = makeRecords(ARRIVAL_OTIME, 20, 1); // 19/20 = 95%
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('returns a detail string when both the ratio is below threshold and blanks clear the floor', () => {
    const records = makeRecords(ARRIVAL_OTIME, 20, 6); // 14/20 = 70%, 6 blanks >= floor of 5
    const detail = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW);
    expect(detail).not.toBeNull();
    expect(detail).toContain('StopCode');
    expect(detail).toContain('14/20');
  });

  it('does not fire when blanks are below the absolute floor, even below the ratio threshold', () => {
    // 16/20 = 80%, below the 95% ratio threshold, but only 4 blanks — below the 5-blank floor.
    const records = makeRecords(ARRIVAL_OTIME, 20, 4);
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('never fires when the rendered window has fewer rows than the absolute floor', () => {
    const records = makeRecords(ARRIVAL_OTIME, 3, 3); // all 3 rows blank, window smaller than the floor
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('returns null (skips the check) when no rows fall in the rendered window', () => {
    const records = makeRecords('23:00:00', 20, 20); // all rows outside the window, none populated
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW)).toBeNull();
  });

  it('treats "", whitespace-only, and "-" as unpopulated', () => {
    const records = [
      makeRecord(ARRIVAL_OTIME, '05'),
      makeRecord(ARRIVAL_OTIME, '05'),
      makeRecord(ARRIVAL_OTIME, '05'),
      makeRecord(ARRIVAL_OTIME, ''),
      makeRecord(ARRIVAL_OTIME, '   '),
      makeRecord(ARRIVAL_OTIME, '-'),
      makeRecord(ARRIVAL_OTIME, ''),
      makeRecord(ARRIVAL_OTIME, '-'),
    ];
    // 5 unpopulated of 8 clears the floor.
    const detail = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW);
    expect(detail).toContain('3/8');
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
    const records = makeRecords(DEPARTURE_OTIME, 20, 6, 'Gate'); // 14/20 = 70%, 6 blanks >= floor
    const detail = checkFieldPopulation(records, 'Gate', 'D', 'Departures', NOW);
    expect(detail).not.toBeNull();
    expect(detail).toContain('Gate');
    expect(detail).toContain('14/20');
  });

  it('returns a contract-detail string instead of throwing when a record is malformed', () => {
    // Memo missing — filterSupportedAirlines() calls flight.Memo.toLowerCase() unguarded
    // (PR #84 review R4); checkRecordShape's own contract treats null Memo as valid, so
    // this must degrade to a reported detail, not crash the run.
    const records = [
      { ACode: 'BR', ODate: '2026/01/15', OTime: ARRIVAL_OTIME, StopCode: '05' },
    ];
    const detail = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals', NOW);
    expect(detail).toContain('row filtering threw');
  });
});

describe('checkRecordShape / sampleAndCheckShape (departures, issue #83)', () => {
  // A valid AState=D record covering every field in DEPARTURES_FIELDS, so a single
  // drop/rename per test is the only thing that can make it fail.
  function makeDeparturesRecord(overrides = {}) {
    return {
      ACode: 'BR',
      AName: 'EVA Air',
      FlightNo: 'BR087',
      ODate: '2026/01/15',
      OTime: '04:30:00',
      CityCode: 'NRT',
      CityEname: 'Tokyo Narita',
      CityName: '東京成田',
      Memo: '',
      BNO: 5,
      Gate: 'C5',
      PlaneNo: 'B-18316',
      ...overrides,
    };
  }

  it('passes shape check on a well-formed departures record', () => {
    const record = makeDeparturesRecord();
    expect(checkRecordShape(record, 0, DEPARTURES_FIELDS)).toEqual([]);
  });

  it('fires when a required departures field is dropped (rename/removal regression)', () => {
    const record = makeDeparturesRecord();
    delete record.CityEname;
    const issues = checkRecordShape(record, 0, DEPARTURES_FIELDS);
    expect(issues).toContain('record[0] missing `CityEname`');
  });

  it('fires when a required departures field is renamed to an unexpected type', () => {
    // e.g. the API starts sending BNO as a numeric string instead of a number.
    const record = makeDeparturesRecord({ BNO: '5' });
    const issues = checkRecordShape(record, 0, DEPARTURES_FIELDS);
    expect(issues).toContain('record[0].BNO: expected number|null, got string');
  });

  it('does not require StopCode (arrivals-only) on departures records', () => {
    const record = makeDeparturesRecord();
    expect('StopCode' in record).toBe(false);
    expect(checkRecordShape(record, 0, DEPARTURES_FIELDS)).toEqual([]);
  });

  it('sampleAndCheckShape returns null across a healthy departures sample', () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeDeparturesRecord({ FlightNo: `BR0${80 + i}` }),
    );
    expect(sampleAndCheckShape(records, DEPARTURES_FIELDS, 'Departures (AState=D)')).toBeNull();
  });

  it('sampleAndCheckShape reports the mismatch and the live key set when a field is dropped', () => {
    const records = Array.from({ length: 6 }, (_, i) =>
      makeDeparturesRecord({ FlightNo: `BR0${80 + i}` }),
    );
    delete records[2].Gate; // sampled index (0, 1, 2, 3, 5) includes index 2
    const detail = sampleAndCheckShape(records, DEPARTURES_FIELDS, 'Departures (AState=D)');
    expect(detail).not.toBeNull();
    expect(detail).toContain('Departures (AState=D): shape mismatch');
    expect(detail).toContain('missing `Gate`');
    expect(detail).toContain('Live record keys:');
  });

  it('arrivals field-list checks are unaffected by the departures bundle (scope lock, issue #83 item 6)', () => {
    // ARRIVALS_FIELDS still requires StopCode; a departures-shaped record (no StopCode)
    // must still fail against it, proving the two bundles stayed independent.
    const record = makeDeparturesRecord();
    const issues = checkRecordShape(record, 0, ARRIVALS_FIELDS);
    expect(issues).toContain('record[0] missing `StopCode`');
  });
});

describe('run() — per-class incident state machine (issue #86)', () => {
  // Routes the GitHub + Discord fetch calls run() makes to whichever callback the test
  // supplied, so each test only asserts on the calls it cares about. Throws on anything
  // unhandled rather than silently returning ok — an unexpected call is a sign the test's
  // mental model of the request sequence is wrong.
  function mockFetchRouter({ openIncidents = [], onIssuePost, onPatch, onComment, onDiscordPost } = {}) {
    fetch.mockImplementation(async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      if (url.includes('/issues?labels=')) {
        return { ok: true, json: async () => openIncidents };
      }
      if (url.includes('/labels/') && method === 'GET') {
        return { ok: true, json: async () => ({}) }; // label already exists, skip creation
      }
      if (/\/issues\/\d+\/comments$/.test(url) && method === 'POST') {
        onComment?.(url, JSON.parse(opts.body));
        return { ok: true, json: async () => ({}) };
      }
      if (/\/issues\/\d+$/.test(url) && method === 'PATCH') {
        onPatch?.(url, JSON.parse(opts.body));
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith('/issues') && method === 'POST') {
        const body = JSON.parse(opts.body);
        onIssuePost?.(body);
        return { ok: true, json: async () => ({ number: 99, html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/99' }) };
      }
      if (url.includes('discord.com') && method === 'POST') {
        onDiscordPost?.(JSON.parse(opts.body));
        return { ok: true, text: async () => '' };
      }
      throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    });
  }

  const UNHEALTHY_PROBE = {
    arrivals: { status: 500, body: 'Internal Server Error', networkError: null },
    departures: { status: 500, body: 'Internal Server Error', networkError: null },
  };
  // Empty arrays are a legitimate off-peak result (see run()'s own comment on
  // recordCount), so this clears both the availability and contract checks without
  // needing well-formed flight records.
  const HEALTHY_PROBE = {
    arrivals: { status: 200, body: '[]', networkError: null },
    departures: { status: 200, body: '[]', networkError: null },
  };

  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an availability outage still opens a new incident and alerts while a contract incident is already open', async () => {
    const contractIncident = {
      number: 41,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/41',
      labels: [{ name: 'status:incident' }, { name: 'canary:contract' }],
    };
    let issuePost = null;
    const discordPosts = [];
    mockFetchRouter({
      openIncidents: [contractIncident],
      onIssuePost: (b) => { issuePost = b; },
      onDiscordPost: (b) => discordPosts.push(b),
    });
    probeFlightApiPair.mockResolvedValue(UNHEALTHY_PROBE);

    // probeWithRetry absorbs one bad probe with a real 30s wait before giving up — fast
    // -forward it rather than actually sleeping.
    vi.useFakeTimers();
    const runPromise = run();
    await vi.advanceTimersByTimeAsync(30_000);
    await runPromise;

    expect(issuePost).not.toBeNull();
    expect(issuePost.labels).toEqual(expect.arrayContaining(['status:incident', 'canary:availability']));
    expect(discordPosts).toHaveLength(1);
    expect(discordPosts[0].embeds[0].title).toContain('API unavailable');
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('a repeat availability failure stays silent and never touches a separate open contract incident', async () => {
    const contractIncident = {
      number: 41,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/41',
      labels: [{ name: 'status:incident' }, { name: 'canary:contract' }],
    };
    const availabilityIncident = {
      number: 42,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/42',
      labels: [{ name: 'status:incident' }, { name: 'canary:availability' }],
    };
    let issuePosted = false;
    let patched = false;
    mockFetchRouter({
      openIncidents: [contractIncident, availabilityIncident],
      onIssuePost: () => { issuePosted = true; },
      onPatch: () => { patched = true; },
    });
    probeFlightApiPair.mockResolvedValue(UNHEALTHY_PROBE);

    vi.useFakeTimers();
    const runPromise = run();
    await vi.advanceTimersByTimeAsync(30_000);
    await runPromise;

    expect(issuePosted).toBe(false); // no duplicate incident for the same class
    expect(patched).toBe(false); // the still-open contract incident is untouched
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it('a healthy run closes every open incident, each with its own class in the recovery detail', async () => {
    const contractIncident = {
      number: 41,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/41',
      labels: [{ name: 'status:incident' }, { name: 'canary:contract' }],
      created_at: '2026-07-19T00:00:00Z',
    };
    const availabilityIncident = {
      number: 42,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/42',
      labels: [{ name: 'status:incident' }, { name: 'canary:availability' }],
      created_at: '2026-07-19T00:00:00Z',
    };
    const patchedUrls = [];
    const discordPosts = [];
    mockFetchRouter({
      openIncidents: [contractIncident, availabilityIncident],
      onPatch: (url) => patchedUrls.push(url),
      onDiscordPost: (b) => discordPosts.push(b),
    });
    probeFlightApiPair.mockResolvedValue(HEALTHY_PROBE); // healthy on the first attempt — no retry wait

    await run();

    expect(patchedUrls).toHaveLength(2);
    expect(patchedUrls.some((u) => u.endsWith('/issues/41'))).toBe(true);
    expect(patchedUrls.some((u) => u.endsWith('/issues/42'))).toBe(true);
    expect(discordPosts).toHaveLength(2);
    const descriptions = discordPosts.map((p) => p.embeds[0].description);
    expect(descriptions.some((d) => d.includes('(contract)'))).toBe(true);
    expect(descriptions.some((d) => d.includes('(availability)'))).toBe(true);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
