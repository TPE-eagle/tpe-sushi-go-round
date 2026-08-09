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
  // Issue #115: scope is today's airline-filtered day pool, not a time-window slice —
  // OTime is arbitrary here (any time of day) since it no longer affects the check.
  const OTIME = '04:00:00';

  function makeRecord(otime, value, overrides = {}) {
    return {
      ACode: 'BR',
      FlightNo: '100',
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

  it('returns status "pass" when the ratio is at or above the 95% threshold', () => {
    const records = makeRecords(OTIME, 20, 1); // 19/20 = 95%
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals')).toEqual({ status: 'pass', detail: null });
  });

  it('returns status "fail" with a detail string when both the ratio is below threshold and blanks clear the floor', () => {
    const records = makeRecords(OTIME, 20, 6); // 14/20 = 70%, 6 blanks >= floor of 5
    const result = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('StopCode');
    expect(result.detail).toContain('14/20');
  });

  it('passes (not skips) when blanks are below the absolute floor but n itself clears it', () => {
    // 16/20 = 80%, below the 95% ratio threshold, but only 4 blanks — below the 5-blank
    // floor. n=20 itself is well above the floor, so this is a real, meaningful pass —
    // not the "n too small to ever fire" skip case below (issue #86 PR #99 review).
    const records = makeRecords(OTIME, 20, 4);
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals')).toEqual({ status: 'pass', detail: null });
  });

  it('returns status "skip" when the day pool has fewer rows than the absolute floor (issue #86)', () => {
    // n=3 rows, all blank — even 100% blank can't clear the 5-blank floor, so this
    // sample is structurally incapable of failing and must not read as a pass either.
    const records = makeRecords(OTIME, 3, 3);
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals')).toEqual({ status: 'skip', detail: null });
  });

  it('returns status "skip" when the day pool is empty', () => {
    expect(checkFieldPopulation([], 'StopCode', 'A', 'Arrivals')).toEqual({ status: 'skip', detail: null });
  });

  it('counts rows regardless of time of day — the time-window narrowing was dropped (issue #115)', () => {
    // Same fixture as the ratio-below-threshold 'fail' case above, but at a time of day
    // that would have fallen outside the old ~2h rendered window (an overnight OTime is
    // well outside both the arrival and departure windows in src/utils/flightUtils.js).
    // Pre-#115 this returned 'skip' (n=0, nothing "rendered"); now it must still evaluate
    // and fail — proof the guard is no longer blind outside the rendered window.
    const records = makeRecords('02:00:00', 20, 6); // 14/20 = 70%, 6 blanks >= floor of 5
    const result = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('14/20');
  });

  it('treats "", whitespace-only, and "-" as unpopulated', () => {
    const records = [
      makeRecord(OTIME, '05'),
      makeRecord(OTIME, '05'),
      makeRecord(OTIME, '05'),
      makeRecord(OTIME, ''),
      makeRecord(OTIME, '   '),
      makeRecord(OTIME, '-'),
      makeRecord(OTIME, ''),
      makeRecord(OTIME, '-'),
    ];
    // 5 unpopulated of 8 clears the floor.
    const result = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('3/8');
  });

  it('excludes unsupported airlines and cancelled flights from the denominator', () => {
    // 6 supported/populated rows + 5 excluded (unsupported airline / cancelled) rows that
    // are all blank. If exclusion were broken, n=11, blanks=5 (>= floor), ratio=6/11=54.5%
    // (< threshold) => 'fail'. With exclusion working, n=6, blanks=0 => 'pass' — the two
    // outcomes are distinguishable, unlike a smaller fixture where both paths agree.
    const records = [
      ...Array.from({ length: 6 }, () => makeRecord(OTIME, '05')),
      ...Array.from({ length: 5 }, () => makeRecord(OTIME, '', { ACode: 'XX' })), // unsupported — excluded
      makeRecord(OTIME, '', { Memo: '取消' }), // cancelled — excluded
    ];
    expect(checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals')).toEqual({ status: 'pass', detail: null });
  });

  it('uses the Gate field for mode D', () => {
    const records = makeRecords(OTIME, 20, 6, 'Gate'); // 14/20 = 70%, 6 blanks >= floor
    const result = checkFieldPopulation(records, 'Gate', 'D', 'Departures');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('Gate');
    expect(result.detail).toContain('14/20');
  });

  it('logs blank row natural-key ids when blanks are present (issue #115)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const records = [
      makeRecord(OTIME, '05', { FlightNo: '101' }),
      makeRecord(OTIME, '', { FlightNo: '102' }),
    ];
    checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals');
    const idLog = logSpy.mock.calls.map(c => c[0]).find(msg => msg.includes('blank row ids'));
    expect(idLog).toContain('20260115_A_BR102');
    expect(idLog).not.toContain('BR101');
    logSpy.mockRestore();
  });

  it('returns status "fail" instead of throwing when a record is malformed', () => {
    // Memo missing — filterSupportedAirlines() calls flight.Memo.toLowerCase() unguarded
    // (PR #84 review R4); checkRecordShape's own contract treats null Memo as valid, so
    // this must degrade to a reported detail, not crash the run. Status is 'fail', not
    // 'skip' (issue #86 PR #99 review): a malformed record is a real contract problem,
    // not an inconclusive sample.
    const records = [
      { ACode: 'BR', ODate: '2026/01/15', OTime: OTIME, StopCode: '05' },
    ];
    const result = checkFieldPopulation(records, 'StopCode', 'A', 'Arrivals');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('row filtering threw');
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

    // gemini-code-assist review on #105 R2: the close loop now also sees incidents whose
    // class failed this cycle, not just classes never evaluated — the audit log must say
    // which, or it contradicts itself against the "already open, no new alert" line right
    // after it. #42 (availability) failed THIS cycle; #41 (contract) was never reached.
    const logs = console.log.mock.calls.map((args) => args[0]);
    expect(logs.some((l) => l.includes('#42') && l.includes('still failing'))).toBe(true);
    expect(logs.some((l) => l.includes('#41') && l.includes('not evaluated this cycle'))).toBe(true);
  });

  // Fixed reference instant + well-formed, well-populated records for both legs, so
  // *every* class — including contract — reaches a genuine 'pass' verdict this cycle,
  // not just 'no failure'. (issue #86 PR #99 review: an empty/off-peak payload is
  // healthy but 'skip', not 'pass' — see the dedicated test below for that case.)
  const CONTRACT_HEALTHY_NOW = new Date('2026-01-15T04:00:00+08:00');
  function makeHealthyArrivalsRecord(i) {
    return {
      ACode: 'BR', AName: 'EVA Air', FlightNo: `BR${100 + i}`,
      ODate: '2026/01/15', OTime: '04:00:00', // inside the arrivals render window
      CityCode: 'NRT', CityEname: 'Tokyo Narita', CityName: '東京成田', Memo: '',
      BNO: i, StopCode: '05', Gate: 'C5', PlaneNo: 'B-18316', flightCode: `BR${100 + i}`,
    };
  }
  function makeHealthyDeparturesRecord(i) {
    return {
      ACode: 'BR', AName: 'EVA Air', FlightNo: `BR${200 + i}`,
      ODate: '2026/01/15', OTime: '04:30:00', // inside the departures render window
      CityCode: 'NRT', CityEname: 'Tokyo Narita', CityName: '東京成田', Memo: '',
      BNO: i, Gate: 'C5', PlaneNo: 'B-18316',
    };
  }

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
    // n=6 on each leg, fully populated — clears the population floor with a genuine
    // 100% ratio, so contract's verdict this cycle is 'pass', not merely 'not failing'.
    probeFlightApiPair.mockResolvedValue({
      arrivals: { status: 200, body: JSON.stringify(Array.from({ length: 6 }, (_, i) => makeHealthyArrivalsRecord(i))), networkError: null },
      departures: { status: 200, body: JSON.stringify(Array.from({ length: 6 }, (_, i) => makeHealthyDeparturesRecord(i))), networkError: null },
    });

    vi.useFakeTimers();
    vi.setSystemTime(CONTRACT_HEALTHY_NOW);
    await run(); // healthy on the first probe attempt — no retry wait

    expect(patchedUrls).toHaveLength(2);
    expect(patchedUrls.some((u) => u.endsWith('/issues/41'))).toBe(true);
    expect(patchedUrls.some((u) => u.endsWith('/issues/42'))).toBe(true);
    expect(discordPosts).toHaveLength(2);
    const descriptions = discordPosts.map((p) => p.embeds[0].description);
    expect(descriptions.some((d) => d.includes('(contract)'))).toBe(true);
    expect(descriptions.some((d) => d.includes('(availability)'))).toBe(true);
    expect(process.exit).not.toHaveBeenCalled();
  });

  it('a contract incident stays open when this run\'s rendered window is empty — "no failure" is not "recovered" (issue #86 PR #99 review)', async () => {
    const contractIncident = {
      number: 41,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/41',
      labels: [{ name: 'status:incident' }, { name: 'canary:contract' }],
    };
    let patched = false;
    let discordPosted = false;
    mockFetchRouter({
      openIncidents: [contractIncident],
      onPatch: () => { patched = true; },
      onDiscordPost: () => { discordPosted = true; },
    });
    // Empty arrays: availability/canary-blocked pass cleanly, but contract's own
    // per-leg check never runs (empty payload is legitimate off-peak, but it means
    // this cycle can't confirm the field-population regression that might have opened
    // the incident is actually gone) — contract's verdict is 'skip', not 'pass'.
    probeFlightApiPair.mockResolvedValue(HEALTHY_PROBE);

    await run();

    expect(patched).toBe(false); // the open contract incident is left exactly as it was
    expect(discordPosted).toBe(false); // no false "API recovered"
    expect(process.exit).not.toHaveBeenCalled();
  });

  // issue #101 F2: the discriminating test #99 was missing. The two existing tests above
  // each cover one incident in isolation — "everything passes ⇒ close" and "empty window
  // ⇒ contract stays open" — but neither proves the close loop tells the two classes
  // *apart* within the same run. A regression such as an early return on an empty window
  // would leave both of those tests green while wrongly stranding the availability
  // incident too; this is the one test that would catch it.
  it('one empty-window run leaves a contract incident open while closing a separate availability incident (issue #101 F2)', async () => {
    const contractIncident = {
      number: 41,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/41',
      labels: [{ name: 'status:incident' }, { name: 'canary:contract' }],
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
    // Empty arrays: both legs are a clean 200, so availability/canary-blocked reach a
    // genuine 'pass' verdict; contract's own check never runs on an empty payload, so its
    // verdict is 'skip', not 'pass'.
    probeFlightApiPair.mockResolvedValue(HEALTHY_PROBE);

    await run();

    expect(patchedUrls).toEqual(['https://api.github.com/repos/TPE-eagle/tpe-sushi-go-round/issues/42']);
    expect(discordPosts).toHaveLength(1);
    expect(discordPosts[0].embeds[0].description).toContain('(availability)');
    expect(process.exit).not.toHaveBeenCalled();
  });

  // issue #101 F4: a failing cycle used to exit(1) before the close loop ever ran, so a
  // class that genuinely recovered THIS cycle stayed open as long as some other class
  // failed in the same cycle. Reproduces the mechanism directly: contract fails on a real
  // shape/population problem while both legs are a clean 200 (availability/canary-blocked
  // verdict 'pass'), with a pre-existing open availability incident that this cycle's
  // verdict says should close.
  it('a failing cycle still closes a different class\'s incident that genuinely recovered this cycle (issue #101 F4)', async () => {
    const availabilityIncident = {
      number: 42,
      html_url: 'https://github.com/TPE-eagle/tpe-sushi-go-round/issues/42',
      labels: [{ name: 'status:incident' }, { name: 'canary:availability' }],
      created_at: '2026-07-19T00:00:00Z',
    };
    let issuePost = null;
    const patchedUrls = [];
    const discordPosts = [];
    mockFetchRouter({
      openIncidents: [availabilityIncident],
      onIssuePost: (b) => { issuePost = b; },
      onPatch: (url) => patchedUrls.push(url),
      onDiscordPost: (b) => discordPosts.push(b),
    });
    // Both legs 200 (availability/canary-blocked pass), departures fully healthy, but
    // arrivals' StopCode population fails: n=6, 5 blanks — below both the ratio and the
    // absolute floor, same fixture shape as the checkFieldPopulation 'fail' tests above.
    probeFlightApiPair.mockResolvedValue({
      arrivals: {
        status: 200,
        body: JSON.stringify(Array.from({ length: 6 }, (_, i) => makeHealthyArrivalsRecord(i)).map((r, i) => ({ ...r, StopCode: i < 5 ? '' : '05' }))),
        networkError: null,
      },
      departures: {
        status: 200,
        body: JSON.stringify(Array.from({ length: 6 }, (_, i) => makeHealthyDeparturesRecord(i))),
        networkError: null,
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(CONTRACT_HEALTHY_NOW);
    await run(); // healthy probe (both legs 200) — no retry wait

    // The recovered availability incident closes even though this cycle exits 1 for contract.
    expect(patchedUrls).toEqual(['https://api.github.com/repos/TPE-eagle/tpe-sushi-go-round/issues/42']);
    // A new contract incident opens — this class has no prior open incident.
    expect(issuePost).not.toBeNull();
    expect(issuePost.labels).toEqual(expect.arrayContaining(['status:incident', 'canary:contract']));
    const descriptions = discordPosts.map((p) => p.embeds[0].description);
    expect(descriptions.some((d) => d.includes('(availability)'))).toBe(true); // recovery alert
    expect(descriptions.some((d) => d.includes('StopCode'))).toBe(true); // new contract alert
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  // issue #101 F1: the write path (closing incidents) had no equivalent to GH_READ_FAILED
  // on the read path. A transient GitHub error closing one incident must not abort the
  // rest of the loop or crash an otherwise-healthy run.
  it('a transient error closing one incident does not abort the rest of the close loop (issue #101 F1)', async () => {
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
    fetch.mockImplementation(async (url, opts = {}) => {
      const method = opts.method ?? 'GET';
      if (url.includes('/issues?labels=')) {
        return { ok: true, json: async () => [contractIncident, availabilityIncident] };
      }
      // #41's comment POST (first ghApi call inside closeIncidentIssue) fails every time —
      // simulates a transient GitHub error on that one incident's close.
      if (url === 'https://api.github.com/repos/TPE-eagle/tpe-sushi-go-round/issues/41/comments' && method === 'POST') {
        return { ok: false, status: 502, text: async () => 'Bad Gateway' };
      }
      if (/\/issues\/\d+\/comments$/.test(url) && method === 'POST') {
        return { ok: true, json: async () => ({}) };
      }
      if (/\/issues\/\d+$/.test(url) && method === 'PATCH') {
        patchedUrls.push(url);
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes('discord.com') && method === 'POST') {
        discordPosts.push(JSON.parse(opts.body));
        return { ok: true, text: async () => '' };
      }
      throw new Error(`Unhandled fetch in test: ${method} ${url}`);
    });
    probeFlightApiPair.mockResolvedValue({
      arrivals: { status: 200, body: JSON.stringify(Array.from({ length: 6 }, (_, i) => makeHealthyArrivalsRecord(i))), networkError: null },
      departures: { status: 200, body: JSON.stringify(Array.from({ length: 6 }, (_, i) => makeHealthyDeparturesRecord(i))), networkError: null },
    });

    vi.useFakeTimers();
    vi.setSystemTime(CONTRACT_HEALTHY_NOW);
    await expect(run()).resolves.not.toThrow();

    // #41 (contract) failed to close, but #42 (availability) still did — the loop
    // continued past the failure instead of aborting.
    expect(patchedUrls).toEqual(['https://api.github.com/repos/TPE-eagle/tpe-sushi-go-round/issues/42']);
    // Two Discord posts: #42's own recovery alert, plus a best-effort alert about #41's
    // failed close (jonatw-eagle review on #105 R1) — the swallowed error must not be
    // silent outside the Actions log, since the residue left behind (an incident that
    // should have closed but didn't) is exactly the F4 failure mode this issue is about.
    expect(discordPosts).toHaveLength(2);
    const descriptions = discordPosts.map((p) => p.embeds[0].description);
    expect(descriptions.some((d) => d.includes('(availability)'))).toBe(true);
    expect(descriptions.some((d) => d.includes('issues/41') && d.includes('502'))).toBe(true);
    expect(process.exit).not.toHaveBeenCalled(); // both classes passed this cycle — still a healthy run
  });
});
