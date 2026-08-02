#!/usr/bin/env node
// Hourly API availability + contract canary for the Taoyuan Airport flight API.
//
// State model: healthy / down-availability (non-200) / down-contract (shape drift) /
// canary-blocked (Cloudflare served a challenge to the canary itself — a canary problem,
// not necessarily an API outage).
// State is stored in open GitHub issues (label: status:incident) — Upptime pattern.
// Discord alerts fire only on state TRANSITIONS, not every run:
//   healthy → down : open GitHub issue + Discord 🚨 alert
//   down    → down : silent (incident issue already open)
//   down    → healthy : close issue with recovery comment + Discord ✅ alert
//   healthy → healthy : silent
//
// The API sits behind a Cloudflare managed challenge, so the probe is a stealth browser
// (see canary/probe.mjs — curl/undici get 403, cf_clearance is IP-bound). Discord +
// GitHub API calls use native fetch (those services aren't gated). Each run fetches both
// AState=A (arrivals) and AState=D (departures) for today, in one browser session.
//
// Contract is derived from getMockFlightData() in e2e/test-helpers.js and the
// "Response fields consumed" list in CLAUDE.md. Required-field shape is sampled on the
// arrivals payload only. `StopCode` (arrivals) and `Gate` (departures) additionally get a
// population-ratio check over the rows the app actually renders (today, inside the
// mode's time window) — see checkFieldPopulation — because both are legitimately empty
// on some rows even on a healthy day, so full-payload / per-row assertions on them would
// misfire (issue #77 / #67 R13).

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
const REQUIRED_STRING_FIELDS = ['ACode', 'AName', 'FlightNo', 'ODate', 'OTime', 'CityCode', 'CityEname', 'Memo'];
const REQUIRED_NUMBER_FIELDS = ['BNO'];
// Must be present; may be empty string (Gate, PlaneNo) or a derived string.
const EXPECTED_PRESENT_FIELDS = ['Gate', 'PlaneNo', 'CityName', 'flightCode'];

// Issue #77 / #67 R13: StopCode (arrivals carousel) and Gate (departures boarding gate)
// are populated well below 100% even on a healthy day (4/285 and 3/285 gaps measured),
// so a per-row hard fail would page on normal rows. A population ratio over the rows the
// app actually renders — today's payload, filtered the same way main.js filters it,
// inside the mode's configured time window — catches a real regression (rename, type
// change, upstream returning it empty) while tolerating legitimate per-row gaps.
// Measured healthy-day ratios were 98.5% (StopCode) / ~100% (Gate) inside the rendered
// window; a real drift case (Gate on a future-date payload) measured 2.7%. 95% leaves
// headroom on both sides.
const POPULATION_RATIO_THRESHOLD = 0.95;

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
// time window ('A' or 'D'). Returns null when the check can't fire (no rows currently
// rendered — off-peak, not a failure) or when the ratio holds; otherwise a detail string.
// `now` defaults to the real clock; tests pass a fixed instant for determinism.
export function checkFieldPopulation(records, field, mode, label, now = new Date()) {
  const rendered = filterFlightsByTime(filterSupportedAirlines(records), mode, now);
  if (rendered.length === 0) return null; // nothing in the rendered window right now
  const populated = rendered.filter(r => isPopulated(r[field])).length;
  const ratio = populated / rendered.length;
  if (ratio >= POPULATION_RATIO_THRESHOLD) return null;
  const pct = (ratio * 100).toFixed(1);
  return `${label}: \`${field}\` populated in only ${populated}/${rendered.length} (${pct}%) of rendered-window rows — below the ${POPULATION_RATIO_THRESHOLD * 100}% threshold.`;
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

// Sentinel returned by findOpenIncident() when GitHub's own API is unavailable.
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

export async function findOpenIncident() {
  if (!GITHUB_TOKEN) return null; // local/no-token run: skip state management, probe only
  try {
    const issues = await ghApiRetry(
      `/repos/${REPO_OWNER}/${REPO_NAME}/issues?labels=${INCIDENT_LABEL}&state=open&per_page=1`,
    );
    return Array.isArray(issues) && issues.length > 0 ? issues[0] : null;
  } catch (err) {
    console.warn(
      `[canary] ⚠️  GitHub API read failed after retries — skipping state management this run: ${err.message.slice(0, 150)}`,
    );
    return GH_READ_FAILED;
  }
}

async function ensureLabel() {
  try {
    await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/labels/${encodeURIComponent(INCIDENT_LABEL)}`);
  } catch {
    // 404 = not found; create it. Any other error is unexpected but non-fatal.
    await ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/labels`, {
      name: INCIDENT_LABEL, color: 'e11d48', description: 'API canary incident',
    }).catch(() => {}); // ignore 422 if another run just created it concurrently
  }
}

const INCIDENT_TITLES = {
  availability: '🚨 API down (availability)',
  contract: '🚨 API contract drift',
  'canary-blocked': '⚠️ Canary blocked by Cloudflare — verify API manually',
};

async function openIncidentIssue(failureType, detail, startedAt) {
  await ensureLabel();
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
    labels: [INCIDENT_LABEL],
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

function checkRecordShape(record, index) {
  const issues = [];
  for (const f of REQUIRED_STRING_FIELDS) {
    if (!(f in record)) { issues.push(`record[${index}] missing \`${f}\``); continue; }
    if (record[f] !== null && typeof record[f] !== 'string') issues.push(`record[${index}].${f}: expected string|null, got ${typeof record[f]}`);
  }
  for (const f of REQUIRED_NUMBER_FIELDS) {
    if (!(f in record)) { issues.push(`record[${index}] missing \`${f}\``); continue; }
    if (record[f] !== null && typeof record[f] !== 'number') issues.push(`record[${index}].${f}: expected number|null, got ${typeof record[f]}`);
  }
  for (const f of EXPECTED_PRESENT_FIELDS) {
    if (!(f in record)) issues.push(`record[${index}] missing \`${f}\``);
  }
  if (record.ODate && !ODATE_RE.test(record.ODate))
    issues.push(`record[${index}].ODate format unexpected: "${record.ODate}"`);
  if (record.OTime && !OTIME_RE.test(record.OTime))
    issues.push(`record[${index}].OTime format unexpected: "${record.OTime}"`);
  return issues;
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

async function run() {
  const date = getTaiwanDate();
  const now = new Date().toISOString();

  // Probe the API — arrivals (AState=A) and departures (AState=D), same date, one
  // browser session (see probe.mjs).
  let failureType = null;
  let failureDetail = null;
  let recordCount = null;

  const drillPair = {
    arrivals: { status: -1, body: '', networkError: null },
    departures: { status: -1, body: '', networkError: null },
  };
  const { arrivals, departures } = IS_DRILL ? drillPair : await probeWithRetry(date);

  if (IS_DRILL) {
    failureType = SIMULATE;
    failureDetail = `**SIMULATED ${SIMULATE} failure** — manual alert-path test via workflow_dispatch. Not a real outage.`;
    console.log(`[canary] ⚙️  SIMULATE=${SIMULATE} — exercising the incident/Discord state machine`);
  } else {
    const availabilityIssue =
      classifyLegAvailability(arrivals, 'Arrivals (AState=A)') ??
      classifyLegAvailability(departures, 'Departures (AState=D)');

    if (availabilityIssue) {
      failureType = availabilityIssue.failureType;
      failureDetail = availabilityIssue.failureDetail;
    } else {
      const contractIssues = [];

      const arrivalsParsed = parseLegBody(arrivals.body, 'Arrivals (AState=A)');
      if (arrivalsParsed.contractDetail) {
        contractIssues.push(arrivalsParsed.contractDetail);
      } else {
        const data = arrivalsParsed.data;
        recordCount = data.length;
        // Empty array is legitimate during off-peak windows — not a failure.
        if (data.length > 0) {
          const idxs = [...new Set([0, 1, 2, Math.floor(data.length / 2), data.length - 1])]
            .filter(i => i < data.length);
          const shapeIssues = [...new Set(idxs.flatMap(i => checkRecordShape(data[i], i)))];
          if (shapeIssues.length > 0) {
            const liveKeys = Object.keys(data[0]).join(', ');
            contractIssues.push([
              `Arrivals (AState=A): shape mismatch (${data.length} records; sampled indices ${idxs.join(', ')}):`,
              shapeIssues.map(s => `• ${s}`).join('\n'),
              ``,
              `Live record keys: \`${liveKeys}\``,
            ].join('\n'));
          }
          const stopCodeIssue = checkFieldPopulation(data, 'StopCode', 'A', 'Arrivals (AState=A)');
          if (stopCodeIssue) contractIssues.push(stopCodeIssue);
        }
      }

      const departuresParsed = parseLegBody(departures.body, 'Departures (AState=D)');
      if (departuresParsed.contractDetail) {
        contractIssues.push(departuresParsed.contractDetail);
      } else if (departuresParsed.data.length > 0) {
        const gateIssue = checkFieldPopulation(departuresParsed.data, 'Gate', 'D', 'Departures (AState=D)');
        if (gateIssue) contractIssues.push(gateIssue);
      }

      if (contractIssues.length > 0) {
        failureType = 'contract';
        failureDetail = contractIssues.join('\n\n');
      }
    }
  }

  // Determine current incident state (open issue = currently down).
  const openIncident = await findOpenIncident();

  // GitHub's own API was unavailable (even after retries) — skip state management for
  // this run so a GitHub control-plane blip never causes a false-red canary exit.
  if (openIncident === GH_READ_FAILED) {
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
    const ghLabel = recordCount === null
      ? 'drill (probe skipped)'
      : recordCount === 0 ? '0 records (off-peak window)' : `${recordCount} records, contract intact`;
    console.log(`[canary] ⚠️  GitHub API unavailable — state management skipped. Flight probe: ✅ ${ghLabel}`);
    return; // exit 0: flight API is healthy; don't turn a GitHub blip into a false red
  }

  // State transitions.
  if (failureType) {
    if (!openIncident) {
      // healthy → down: open incident issue + Discord alert.
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
      // down → down: silent, incident already open.
      console.log(`[canary] ❌ ${failureType} failure — incident #${openIncident.number} already open, no new alert`);
    }
    process.exit(1);
  } else {
    if (openIncident) {
      // down → healthy: close incident + Discord recovery alert.
      if (DRY_RUN) {
        console.log(`[canary] [DRY RUN] ✅ Healthy — would close incident #${openIncident.number} and alert Discord`);
      } else {
        console.log(`[canary] ✅ Healthy — closing incident #${openIncident.number}`);
        await closeIncidentIssue(openIncident, now);
        await sendDiscordAlert(
          'API recovered',
          `Service restored. Incident: ${openIncident.html_url}`,
          true,
        );
      }
    } else {
      // healthy → healthy: silent.
      const label = recordCount === 0
        ? '0 records (off-peak window)'
        : `${recordCount} records, contract intact`;
      console.log(`[canary] ✅ Healthy — ${label}`);
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

export { run };
