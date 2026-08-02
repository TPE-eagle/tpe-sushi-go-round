#!/usr/bin/env node
// Hourly API availability + contract canary for the Taoyuan Airport flight API.
//
// State model: healthy / down-availability (non-200) / down-contract (shape drift) /
// canary-blocked (Cloudflare served a challenge to the canary itself — a canary problem,
// not necessarily an API outage).
// State is stored in open GitHub issues (label: status:incident) — Upptime pattern —
// tracked PER FAILURE CLASS (issue #86), via an additional `canary:<failureType>` label:
// a contract incident staying open must never silence a later, unrelated availability
// outage (or vice versa), so only an incident carrying the SAME class's label counts as
// "already open" for transition purposes.
//
// Each class gets a per-run verdict of 'fail' / 'pass' / 'skip' (issue #86 PR #99
// review), not just "did anything fail" — a class the probe didn't meaningfully exercise
// this cycle (an empty rendered window, a too-small sample, or a class that was never
// reached because a different class short-circuited it) is 'skip', and an open incident
// for a 'skip' class is left exactly as it is: not a failure, not a recovery. Only 'pass'
// closes an open incident. Discord alerts fire only on state TRANSITIONS, not every run:
//   fail, no matching open incident      : open GitHub issue + Discord 🚨 alert
//   fail, matching open incident         : silent (that class's incident already open)
//   pass, matching open incident         : close it, its own recovery comment + Discord ✅
//   pass, no matching open incident      : silent
//   skip                                 : silent; any open incident for that class untouched
//
// The API sits behind a Cloudflare managed challenge, so the probe is a stealth browser
// (see canary/probe.mjs — curl/undici get 403, cf_clearance is IP-bound). Discord +
// GitHub API calls use native fetch (those services aren't gated). Each run fetches both
// AState=A (arrivals) and AState=D (departures) for today, in one browser session.
//
// Contract is derived from the app's own render path (main.js / blockTimes.js /
// flightUtils.js) and the "Response fields consumed" list in CLAUDE.md. Required-field
// shape is sampled on both payloads — arrivals against ARRIVALS_FIELDS (including
// `StopCode`, the arrivals carousel), departures against the separately-derived
// DEPARTURES_FIELDS (issue #83) — via the shared sampleAndCheckShape()/checkRecordShape();
// rename / type-change is caught there with no threshold. `StopCode` (arrivals) and `Gate`
// (departures) additionally get a population-ratio + absolute-floor check over the rows
// the app actually renders (today, inside the mode's time window) — see
// checkFieldPopulation — because both are legitimately empty on some rows even on a
// healthy day, so full-payload / per-row assertions on "present but empty" would misfire
// (issue #77 / #67 R13, PR #84 review R1).

import { fileURLToPath } from 'url';
import { probeFlightApiPair, isChallengeHtml } from './probe.mjs';
import { filterSupportedAirlines, filterFlightsByTime } from '../src/utils/flightUtils.js';

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// Set CANARY_DRY_RUN=1 to probe the API and log what would happen without opening/closing
// issues or posting to Discord. Use for self-tests and CI smoke runs.
const DRY_RUN = process.env.CANARY_DRY_RUN === '1';
// Delay between GitHub API read retries (ms). Set to 0 via env var in tests or dry runs.
const GH_RETRY_DELAY_MS = parseInt(process.env.CANARY_GH_RETRY_DELAY_MS ?? '5000', 10);
// Set CANARY_SIMULATE=availability|contract (workflow_dispatch input) to force a failure
// and exercise the incident/Discord alert path end-to-end without a real outage. A drill
// is marked 🧪 [DRILL] in the issue + Discord titles so it's never mistaken for a real
// outage in the audit trail (or paged as one).
const SIMULATE = process.env.CANARY_SIMULATE;
const IS_DRILL = SIMULATE === 'availability' || SIMULATE === 'contract';
const REPO = 'TPE-eagle/tpe-sushi-go-round';
const [REPO_OWNER, REPO_NAME] = REPO.split('/');
const INCIDENT_LABEL = 'status:incident';

// Fields parseApiResponse() and the rendering pipeline depend on.
// StopCode (arrivals carousel, e.g. "01".."08") is zero-padded in the live payload
// (#77/#67 R13) — a JSON number literal can't carry a leading zero, so the field is a
// string on the wire. Rename / type-change is caught here with no threshold; the
// present-but-empty failure mode (the one that DOES need a threshold) is handled
// separately below by checkFieldPopulation, since an empty string is still a valid string.
const REQUIRED_STRING_FIELDS = ['ACode', 'AName', 'FlightNo', 'ODate', 'OTime', 'CityCode', 'CityEname', 'Memo', 'StopCode'];
const REQUIRED_NUMBER_FIELDS = ['BNO'];
// Must be present; may be empty string (Gate, PlaneNo) or a derived string.
const EXPECTED_PRESENT_FIELDS = ['Gate', 'PlaneNo', 'CityName', 'flightCode'];
const ARRIVALS_FIELDS = {
  requiredString: REQUIRED_STRING_FIELDS,
  requiredNumber: REQUIRED_NUMBER_FIELDS,
  expectedPresent: EXPECTED_PRESENT_FIELDS,
};

// Departures (AState=D) field lists — issue #83. Derived from the AState=D render path
// (displayFlights/generateAirlineLinks in main.js, findReturnLeg in blockTimes.js,
// filterSupportedAirlines/filterFlightsByTime in flightUtils.js), not copied from
// arrivals. Same as the arrivals lists minus StopCode (arrivals carousel column, never
// read on the departures path — grepped, zero hits outside StopCode's own arrivals-only
// call site) and minus flightCode: despite being in EXPECTED_PRESENT_FIELDS above and in
// CLAUDE.md's "Response fields consumed" list, it is not read by main.js in *either* mode
// (grepped main.js + src/utils/*.js — zero hits outside test fixtures/mocks), so it isn't
// something a rename/drop here would actually break. Left out rather than carried over by
// habit; the arrivals list itself is unchanged (scope lock, #83 review item 6).
const DEPARTURES_REQUIRED_STRING_FIELDS = ['ACode', 'AName', 'FlightNo', 'ODate', 'OTime', 'CityCode', 'CityEname', 'Memo'];
const DEPARTURES_REQUIRED_NUMBER_FIELDS = ['BNO'];
const DEPARTURES_EXPECTED_PRESENT_FIELDS = ['Gate', 'PlaneNo', 'CityName'];
const DEPARTURES_FIELDS = {
  requiredString: DEPARTURES_REQUIRED_STRING_FIELDS,
  requiredNumber: DEPARTURES_REQUIRED_NUMBER_FIELDS,
  expectedPresent: DEPARTURES_EXPECTED_PRESENT_FIELDS,
};

// Issue #77 / #67 R13: StopCode (arrivals carousel) and Gate (departures boarding gate)
// are populated well below 100% even on a healthy day, so a per-row hard fail would page
// on normal rows. A population ratio over the rows the app actually renders — today's
// payload, filtered the same way main.js filters it, inside the mode's configured time
// window — catches a real regression (upstream returning it empty) while tolerating
// legitimate per-row gaps. Measured healthy-day ratios inside the rendered window: 98.5%
// (StopCode, 132/134) and 100% (Gate, 151/151); a real drift case (Gate on a future-date
// payload) measured 2.7%. 95% leaves headroom on both sides.
//
// A ratio alone isn't enough at the rendered window's size (~2h, n≈15-34 rows per PR #84
// review R1): at n≈34, two legitimate gaps is already 94.1% — below threshold, on a normal
// day. MIN_BLANKS_TO_FIRE is an absolute floor alongside the ratio, not instead of it, so
// one or a few legitimately-unassigned rows can never page; a real regression (rename,
// emptying, type change) is still ~100% blank and clears the floor on the first run.
const POPULATION_RATIO_THRESHOLD = 0.95;
const POPULATION_MIN_BLANKS_TO_FIRE = 5;

// "" / whitespace / "-" are this API's TBD sentinels (see extractPlaneFamily() in
// src/utils/flightUtils.js) — not real values. #67 found a predicate that only checked
// `!= null` counted every one of these as populated and produced a false 100% reading.
function isPopulated(value) {
  if (value === null || value === undefined) return false;
  const s = String(value).trim();
  return s !== '' && s !== '-';
}

// Population-ratio guard, shared by the arrivals/StopCode and departures/Gate call
// sites. `records` is the full-day payload for one AState; `mode` picks the matching
// time window ('A' or 'D'). `now` defaults to the real clock; tests pass a fixed instant
// for determinism.
//
// Returns `{ status, detail }`, not a bare string|null (issue #86 PR #99 review): a run()
// that only sees "no issue" can't tell a genuine pass apart from a sample too small to have
// ever failed, and closing an open incident on the strength of the latter is the same
// "unevaluated ≠ passed" mistake the ticket exists to fix on the state-machine side —
// `status` is one of:
//   'fail' — either populated below both the ratio and blank-count thresholds, or row
//            filtering itself threw on a malformed record (PR #84 review R4 — that's a
//            real contract problem, not an inconclusive sample); `detail` is set.
//   'skip' — the rendered window was empty, OR (below) the window was too small for the
//            floor to ever have fired even at 0% populated — neither says anything about
//            the field's real health, so this cycle can't confirm it either way.
//   'pass' — evaluated on a window large enough that the floor *could* have fired, and it
//            didn't.
//
// Every call logs n/blanks/ratio, healthy or not (PR #84 review R3) — the rendered window
// is small (~2h) and its per-hour row count is otherwise never observed in production, so
// POPULATION_MIN_BLANKS_TO_FIRE can only be retuned from real logged data, not from a
// single measurement run.
export function checkFieldPopulation(records, field, mode, label, now = new Date()) {
  let rendered;
  try {
    rendered = filterFlightsByTime(filterSupportedAirlines(records), mode, now);
  } catch (err) {
    return { status: 'fail', detail: `${label}: \`${field}\` check — row filtering threw on a malformed record: ${err.message}` };
  }
  if (rendered.length === 0) {
    console.log(`[canary] ${label} \`${field}\`: rendered window empty (n=0) — check skipped`);
    return { status: 'skip', detail: null }; // nothing in the rendered window right now
  }
  const populated = rendered.filter(r => isPopulated(r[field])).length;
  const n = rendered.length;
  const blanks = n - populated;
  const ratio = populated / n;
  const pct = (ratio * 100).toFixed(1);
  console.log(`[canary] ${label} \`${field}\`: n=${n} blanks=${blanks} ratio=${pct}%`);
  // issue #86 PR #99 review, case 2: at n < the blank floor, even a 100%-blank sample can't
  // clear POPULATION_MIN_BLANKS_TO_FIRE — the check is structurally incapable of failing,
  // so a "no issue" result here is not evidence of health, real or otherwise.
  if (n < POPULATION_MIN_BLANKS_TO_FIRE) {
    console.log(`[canary] ${label} \`${field}\`: n=${n} below the ${POPULATION_MIN_BLANKS_TO_FIRE}-blank floor — even a fully-blank sample couldn't clear it, so this cycle can't confirm health (skipped)`);
    return { status: 'skip', detail: null };
  }
  if (blanks < POPULATION_MIN_BLANKS_TO_FIRE || ratio >= POPULATION_RATIO_THRESHOLD) return { status: 'pass', detail: null };
  return {
    status: 'fail',
    detail: `${label}: \`${field}\` populated in only ${populated}/${n} (${pct}%) of rendered-window rows (${blanks} blanks) — below both the ${POPULATION_RATIO_THRESHOLD * 100}% threshold and the ${POPULATION_MIN_BLANKS_TO_FIRE}-blank floor.`,
  };
}

const ODATE_RE = /^\d{4}\/\d{2}\/\d{2}$/;
const OTIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function getTaiwanDate() {
  const now = new Date();
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return tw.toISOString().split('T')[0].replace(/-/g, '/');
}

// ── GitHub API helpers ────────────────────────────────────────────────────────

async function ghApi(method, path, body) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set — cannot manage incident issues');
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`GitHub API ${method} ${path} → ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

// Sentinel returned by findOpenIncidents() when GitHub's own API is unavailable.
// Distinct from null ("no open incident") so run() can skip state management without crashing.
export const GH_READ_FAILED = Symbol('GH_READ_FAILED');

// Retry a GitHub API GET up to maxAttempts times on 5xx / 429 / network errors.
// Write calls (POST / PATCH) are never auto-retried — use ghApi() directly for those.
export async function ghApiRetry(path, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await ghApi('GET', path);
    } catch (err) {
      const retriable =
        /→ (429|5\d{2}):/.test(err.message) ||
        /fetch failed|failed to fetch|network error/i.test(err.message);
      if (retriable && attempt < maxAttempts) {
        const delay = attempt * GH_RETRY_DELAY_MS;
        console.log(
          `[canary] GitHub API GET attempt ${attempt}/${maxAttempts} failed — retrying in ${delay / 1000}s: ${err.message.slice(0, 80)}`,
        );
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

// Issue #86: state is tracked per failure class, not as one repo-wide open/closed bit —
// a `status:incident` label groups every incident issue this canary manages, and a
// `canary:<failureType>` label on top of that records *which* class opened it. Without
// the class label, `run()` could only ask "is anything open", so a contract incident
// left open would make a *different*, unrelated availability outage take the silent
// `down → down` branch instead of alerting — the failure this ticket exists to fix.
const CANARY_CLASS_LABEL_PREFIX = 'canary:';
const classLabel = (failureType) => `${CANARY_CLASS_LABEL_PREFIX}${failureType}`;

// Reads the failure class an incident issue was opened for, from its `canary:<type>`
// label. Returns null when there isn't one — an issue opened before this per-class
// tracking existed. Treated as an unknown class rather than guessed at: it never matches
// the current run's `failureType`, so a real failure of any class still opens its own
// incident and alerts instead of silently deferring to an unclassified open issue.
export function incidentClass(issue) {
  const label = (issue.labels ?? []).find((l) => {
    const name = typeof l === 'string' ? l : l?.name;
    return typeof name === 'string' && name.startsWith(CANARY_CLASS_LABEL_PREFIX);
  });
  const name = typeof label === 'string' ? label : label?.name;
  return name ? name.slice(CANARY_CLASS_LABEL_PREFIX.length) : null;
}

// Fetches every currently-open incident issue, across all failure classes — plural,
// unlike the old single-incident lookup, because more than one class's incident can be
// open at the same time (e.g. a contract drift and a later, independent availability
// outage). `run()` matches the current failureType against this list itself rather than
// this function pre-filtering, so a healthy run can close every open incident in one pass.
export async function findOpenIncidents() {
  if (!GITHUB_TOKEN) return []; // local/no-token run: skip state management, probe only
  try {
    const issues = await ghApiRetry(
      `/repos/${REPO_OWNER}/${REPO_NAME}/issues?labels=${INCIDENT_LABEL}&state=open&per_page=100`,
    );
    return Array.isArray(issues) ? issues : [];
  } catch (err) {
    console.warn(
      `[canary] ⚠️  GitHub API read failed after retries — skipping state management this run: ${err.message.slice(0, 150)}`,
    );
    return GH_READ_FAILED;
  }
}

async function ensureLabel(name, color, description) {
  try {
    await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/labels/${encodeURIComponent(name)}`);
  } catch {
    // 404 = not found; create it. Any other error is unexpected but non-fatal.
    await ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/labels`, {
      name, color, description,
    }).catch(() => {}); // ignore 422 if another run just created it concurrently
  }
}

const INCIDENT_TITLES = {
  availability: '🚨 API down (availability)',
  contract: '🚨 API contract drift',
  'canary-blocked': '⚠️ Canary blocked by Cloudflare — verify API manually',
};

async function openIncidentIssue(failureType, detail, startedAt) {
  await ensureLabel(INCIDENT_LABEL, 'e11d48', 'API canary incident');
  await ensureLabel(classLabel(failureType), '5319e7', `API canary incident class: ${failureType}`);
  return ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/issues`, {
    title: `${IS_DRILL ? '🧪 [DRILL] ' : ''}${INCIDENT_TITLES[failureType] ?? `API issue (${failureType})`} — started ${startedAt.slice(0, 16)}Z`,
    body: [
      `## Taoyuan Airport API Outage`,
      ``,
      `**Started:** ${startedAt}`,
      `**Type:** ${failureType}`,
      ``,
      `### Failure detail`,
      detail,
      ``,
      `---`,
      `*Opened by api-canary. Will be auto-closed on recovery.*`,
    ].join('\n'),
    labels: [INCIDENT_LABEL, classLabel(failureType)],
  });
}

async function closeIncidentIssue(issue, recoveredAt) {
  const durationMs = new Date(recoveredAt) - new Date(issue.created_at);
  const hours = Math.floor(durationMs / 3_600_000);
  const mins = Math.floor((durationMs % 3_600_000) / 60_000);
  const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  await ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue.number}/comments`, {
    body: [
      `## ✅ Recovered`,
      ``,
      `**Recovered:** ${recoveredAt}`,
      `**Outage duration:** ${duration}`,
      ``,
      `*Closed by api-canary.*`,
    ].join('\n'),
  });
  await ghApi('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${issue.number}`, {
    state: 'closed',
  });
}

// ── Discord helper ────────────────────────────────────────────────────────────

async function sendDiscordAlert(title, description, isOk = false) {
  if (!DISCORD_WEBHOOK) {
    console.error('[canary] DISCORD_WEBHOOK_URL not set — alert not sent');
    return;
  }
  const color = isOk ? 0x57f287 : 0xed4245;
  const payload = {
    embeds: [{
      title: `${isOk ? '✅' : '🚨'} [${REPO}] API Canary — ${title}`,
      description,
      color,
      timestamp: new Date().toISOString(),
    }],
  };
  try {
    const r = await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error('[canary] Discord responded', r.status, await r.text().catch(() => ''));
  } catch (e) {
    console.error('[canary] Discord request failed:', e.message);
  }
}

// `fields` is one of ARRIVALS_FIELDS / DEPARTURES_FIELDS — the caller picks the bundle,
// this function stays mode-agnostic (issue #83: one shape checker, not two).
function checkRecordShape(record, index, fields) {
  const issues = [];
  for (const f of fields.requiredString) {
    if (!(f in record)) { issues.push(`record[${index}] missing \`${f}\``); continue; }
    if (record[f] !== null && typeof record[f] !== 'string') issues.push(`record[${index}].${f}: expected string|null, got ${typeof record[f]}`);
  }
  for (const f of fields.requiredNumber) {
    if (!(f in record)) { issues.push(`record[${index}] missing \`${f}\``); continue; }
    if (record[f] !== null && typeof record[f] !== 'number') issues.push(`record[${index}].${f}: expected number|null, got ${typeof record[f]}`);
  }
  for (const f of fields.expectedPresent) {
    if (!(f in record)) issues.push(`record[${index}] missing \`${f}\``);
  }
  if (record.ODate && !ODATE_RE.test(record.ODate))
    issues.push(`record[${index}].ODate format unexpected: "${record.ODate}"`);
  if (record.OTime && !OTIME_RE.test(record.OTime))
    issues.push(`record[${index}].OTime format unexpected: "${record.OTime}"`);
  return issues;
}

// Samples up to 5 records (indices 0, 1, 2, middle, last — de-duped) from `data`, runs
// checkRecordShape() over each with the given field-list bundle, and formats a single
// contract-issue string if any sampled record fails. Shared by the arrivals and
// departures legs (issue #83 item 1) so the sampling recipe and the liveKeys-on-mismatch
// reporting can't drift between the two the way two independent samplers would.
function sampleAndCheckShape(data, fields, label) {
  const idxs = [...new Set([0, 1, 2, Math.floor(data.length / 2), data.length - 1])]
    .filter(i => i < data.length);
  const shapeIssues = [...new Set(idxs.flatMap(i => checkRecordShape(data[i], i, fields)))];
  if (shapeIssues.length === 0) return null;
  const liveKeys = Object.keys(data[0]).join(', ');
  return [
    `${label}: shape mismatch (${data.length} records; sampled indices ${idxs.join(', ')}):`,
    shapeIssues.map(s => `• ${s}`).join('\n'),
    ``,
    `Live record keys: \`${liveKeys}\``,
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

// One retry after 30s absorbs transient runner jitter (shared-IP reputation, network
// noise, high runner load) so a single bad probe on a healthy API doesn't page. A 200
// with wrong shape (contract drift) is deterministic, so it isn't retried here.
async function probeWithRetry(date) {
  const isOk = (r) => !r.networkError && r.status === 200;
  const first = await probeFlightApiPair(date);
  if (isOk(first.arrivals) && isOk(first.departures)) return first;
  console.log('[canary] first probe pair not fully healthy — retrying once in 30s to absorb runner jitter');
  await new Promise((r) => setTimeout(r, 30_000));
  return probeFlightApiPair(date);
}

// Availability / canary-blocked classification, shared by the arrivals and departures
// legs of the probe pair. Returns null when this leg reached the API fine (a 200,
// whatever the body turns out to hold) — contract checking happens one level up, once
// both legs have cleared this.
function classifyLegAvailability(result, label) {
  if (result.networkError || result.status === 0) {
    return { failureType: 'availability', failureDetail: `${label}: network / browser failure: \`${result.networkError ?? 'unknown'}\`` };
  }
  if (result.status === 403 && isChallengeHtml(result.body)) {
    return {
      failureType: 'canary-blocked',
      failureDetail: [
        `${label}: Cloudflare served a challenge to the canary browser instead of API data.`,
        'This is a **canary** problem — Cloudflare likely tightened and the stealth browser',
        'needs updating — **not** necessarily an API outage. Verify the API in a real browser',
        'before treating this as downtime.',
      ].join('\n'),
    };
  }
  if (result.status !== 200) {
    return { failureType: 'availability', failureDetail: `${label}: HTTP \`${result.status}\` from Taoyuan Airport API\n\`\`\`\n${result.body.slice(0, 300)}\n\`\`\`` };
  }
  return null;
}

// Parses a leg's body into a flight array. Returns { data } on success, or
// { contractDetail } when the body itself isn't usable — a JSON/array-shape problem is a
// contract failure regardless of which leg it came from.
function parseLegBody(rawBody, label) {
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return { contractDetail: `${label}: response is not valid JSON:\n\`\`\`\n${rawBody.slice(0, 300)}\n\`\`\`` };
  }
  if (!Array.isArray(data)) {
    return { contractDetail: `${label}: response is not an array (got \`${typeof data}\`):\n\`\`\`json\n${JSON.stringify(data).slice(0, 400)}\n\`\`\`` };
  }
  return { data };
}

// Shared healthy-run summary label — both the GH-read-failed fallback log and the
// steady-state healthy log report the same two counts (PR #84 review R3: departures is
// fetched every run now but was never reported).
//
// Both branches key off `=== 0`, not `=== null` (issue #86 minor item): on the healthy
// path departuresRecordCount is always a number (set the moment the departures leg
// parses; a parse failure routes to the failure branch instead and never reaches this
// function with recordCount/departuresRecordCount populated), so an `=== null` check was
// dead code — a genuinely empty departures window printed a bare "0 departures" with no
// off-peak marker, unlike the arrivals leg right next to it.
function formatHealthyLabel(recordCount, departuresRecordCount) {
  if (recordCount === null) return 'drill (probe skipped)';
  const arrivalsLabel = recordCount === 0 ? '0 arrivals (off-peak window)' : `${recordCount} arrivals`;
  const departuresLabel = departuresRecordCount === 0
    ? '0 departures (off-peak window)'
    : `${departuresRecordCount} departures`;
  return `${arrivalsLabel}, ${departuresLabel}, contract intact`;
}

// Evaluates one probe leg's contract (shape + field population) and reduces it to a
// three-state verdict, mirroring checkFieldPopulation's own states (issue #86 PR #99
// review): 'fail' (a real issue), 'skip' (an empty payload, or the population check
// itself couldn't confirm health on too small a sample — see checkFieldPopulation),
// or 'pass' (shape held and population was evaluated on a meaningful sample).
// `recordCount` is returned alongside for formatHealthyLabel's summary whenever the body
// parsed (including 'skip' on an empty array) — null only when parsing itself failed, in
// which case `verdict` is 'fail' and `failureType` ends up set, so formatHealthyLabel's
// null-means-drill branch is never actually reached with this kind of null.
function evaluateLegContract(rawBody, fields, popField, mode, label) {
  const parsed = parseLegBody(rawBody, label);
  if (parsed.contractDetail) {
    return { verdict: 'fail', issues: [parsed.contractDetail], recordCount: null };
  }
  const data = parsed.data;
  const recordCount = data.length;
  // Empty array is legitimate during off-peak windows — not a failure, but nothing here
  // confirms contract health either, so this leg is unevaluated, not passed.
  if (data.length === 0) {
    return { verdict: 'skip', issues: [], recordCount };
  }
  const issues = [];
  const shapeIssue = sampleAndCheckShape(data, fields, label);
  if (shapeIssue) issues.push(shapeIssue);
  const popResult = checkFieldPopulation(data, popField, mode, label);
  if (popResult.status === 'fail') issues.push(popResult.detail);
  if (issues.length > 0) return { verdict: 'fail', issues, recordCount };
  if (popResult.status === 'skip') return { verdict: 'skip', issues: [], recordCount };
  return { verdict: 'pass', issues: [], recordCount };
}

async function run() {
  const date = getTaiwanDate();
  const now = new Date().toISOString();

  // Probe the API — arrivals (AState=A) and departures (AState=D), same date, one
  // browser session (see probe.mjs).
  let failureType = null;
  let failureDetail = null;
  let recordCount = null;
  let departuresRecordCount = null;

  // Per-class verdict for this cycle (issue #86 PR #99 review): 'skip' by default —
  // a class only becomes 'fail' or 'pass' when this cycle's probe actually exercised it.
  // A single scalar `failureType` can't carry this (it only names the one *failing*
  // class, if any), so the state-machine below reads this map instead of inferring
  // "everything else must be fine" from `failureType` being null.
  const verdicts = { availability: 'skip', 'canary-blocked': 'skip', contract: 'skip' };

  const drillPair = {
    arrivals: { status: -1, body: '', networkError: null },
    departures: { status: -1, body: '', networkError: null },
  };
  const { arrivals, departures } = IS_DRILL ? drillPair : await probeWithRetry(date);

  if (IS_DRILL) {
    failureType = SIMULATE;
    failureDetail = `**SIMULATED ${SIMULATE} failure** — manual alert-path test via workflow_dispatch. Not a real outage.`;
    verdicts[SIMULATE] = 'fail'; // the other two classes stay 'skip' — a drill exercises one path only
    console.log(`[canary] ⚙️  SIMULATE=${SIMULATE} — exercising the incident/Discord state machine`);
  } else {
    const availabilityIssue =
      classifyLegAvailability(arrivals, 'Arrivals (AState=A)') ??
      classifyLegAvailability(departures, 'Departures (AState=D)');

    if (availabilityIssue) {
      failureType = availabilityIssue.failureType;
      failureDetail = availabilityIssue.failureDetail;
      verdicts[failureType] = 'fail';
      // contract never ran this cycle (short-circuited below), and whichever of
      // {availability, canary-blocked} didn't fire was never checked either — both
      // stay 'skip', not 'pass'.
    } else {
      // Both legs cleared availability/canary-blocked classification this cycle.
      verdicts.availability = 'pass';
      verdicts['canary-blocked'] = 'pass';

      const arrivalsResult = evaluateLegContract(arrivals.body, ARRIVALS_FIELDS, 'StopCode', 'A', 'Arrivals (AState=A)');
      const departuresResult = evaluateLegContract(departures.body, DEPARTURES_FIELDS, 'Gate', 'D', 'Departures (AState=D)');
      recordCount = arrivalsResult.recordCount;
      departuresRecordCount = departuresResult.recordCount;

      const contractIssues = [...arrivalsResult.issues, ...departuresResult.issues];
      if (contractIssues.length > 0) {
        failureType = 'contract';
        failureDetail = contractIssues.join('\n\n');
        verdicts.contract = 'fail';
      } else if (arrivalsResult.verdict === 'skip' || departuresResult.verdict === 'skip') {
        verdicts.contract = 'skip';
      } else {
        verdicts.contract = 'pass';
      }
    }
  }

  // Determine current incident state — every currently-open incident, across all failure
  // classes (issue #86: a contract incident and a later, independent availability outage
  // can be open at the same time, so this can no longer be a single open/closed bit).
  const incidents = await findOpenIncidents();

  // GitHub's own API was unavailable (even after retries) — skip state management for
  // this run so a GitHub control-plane blip never causes a false-red canary exit.
  if (incidents === GH_READ_FAILED) {
    if (failureType) {
      console.error(
        `[canary] ⚠️  GitHub API unavailable — state management skipped. Flight probe: ❌ ${failureType}. Manual follow-up required.`,
      );
      // Best-effort Discord alert so the flight failure isn't completely silent.
      await sendDiscordAlert(
        `GitHub API unavailable + flight probe: ${failureType}`,
        `GitHub API was unreachable — no incident issue was opened.\n\nFlight probe result:\n${failureDetail ?? '(no detail)'}`,
        false,
      );
      process.exit(1);
    }
    const ghLabel = formatHealthyLabel(recordCount, departuresRecordCount);
    console.log(`[canary] ⚠️  GitHub API unavailable — state management skipped. Flight probe: ✅ ${ghLabel}`);
    return; // exit 0: flight API is healthy; don't turn a GitHub blip into a false red
  }

  // State transitions — per failure class (issue #86).
  if (failureType) {
    // Only an incident already open for *this* failureType silences a new alert. An
    // incident open for a different class (or no class label at all — pre-migration/
    // unknown) never matches, so an availability outage still alerts even while a
    // contract incident sits open, and vice versa — the acceptance property this
    // ticket exists to enforce.
    const matching = incidents.find((i) => incidentClass(i) === failureType);
    if (!matching) {
      // healthy → down (for this class): open incident issue + Discord alert.
      if (DRY_RUN) {
        console.log(`[canary] [DRY RUN] ❌ ${failureType} failure — would open incident issue and alert Discord`);
        console.log(`[canary] [DRY RUN] failure detail: ${failureDetail}`);
      } else {
        console.log(`[canary] ❌ ${failureType} failure — opening incident issue`);
        const issue = await openIncidentIssue(failureType, failureDetail, now);
        const alertTitle = `${IS_DRILL ? '🧪 [DRILL] ' : ''}${{
          availability: 'API unavailable',
          contract: 'Contract drift',
          'canary-blocked': 'Canary blocked by Cloudflare (verify API manually)',
        }[failureType] ?? failureType}`;
        await sendDiscordAlert(
          alertTitle,
          `${failureDetail}\n\nIncident tracking: ${issue.html_url}`,
          false,
        );
      }
    } else {
      // down → down (same class): silent, incident already open.
      console.log(`[canary] ❌ ${failureType} failure — incident #${matching.number} already open, no new alert`);
    }
    process.exit(1);
  } else {
    // No class actively failed this cycle, but that's not the same as every class
    // having passed (issue #86 PR #99 review) — only close an incident whose class's
    // verdict this cycle is 'pass'. A 'skip' class (e.g. an empty rendered window, or a
    // contract incident sitting open while today's window is too small to re-check it)
    // leaves that incident exactly as it is: not a failure, not a recovery.
    console.log(`[canary] ✅ Probe healthy this cycle — ${formatHealthyLabel(recordCount, departuresRecordCount)}`);
    for (const incident of incidents) {
      const cls = incidentClass(incident);
      if (cls && verdicts[cls] === 'pass') {
        if (DRY_RUN) {
          console.log(`[canary] [DRY RUN] ✅ would close incident #${incident.number} (${cls}) and alert Discord`);
          continue;
        }
        console.log(`[canary] ✅ Closing incident #${incident.number} (${cls}) — recovered`);
        await closeIncidentIssue(incident, now);
        await sendDiscordAlert(
          'API recovered',
          `Service restored (${cls}). Incident: ${incident.html_url}`,
          true,
        );
      } else {
        console.log(`[canary] ⏭️  Incident #${incident.number} (${cls ?? 'unknown'}) left open — not evaluated this cycle`);
      }
    }
  }
}

// Only execute when invoked as the entry script, not when imported (e.g. for testing).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch(async err => {
    console.error('[canary] Fatal:', err.stack ?? err.message);
    await sendDiscordAlert('Canary crashed', `\`\`\`\n${(err.stack ?? err.message).slice(0, 500)}\n\`\`\``);
    process.exit(1);
  });
}

export { run, checkRecordShape, sampleAndCheckShape, ARRIVALS_FIELDS, DEPARTURES_FIELDS };
