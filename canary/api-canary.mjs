#!/usr/bin/env node
// API availability + contract canary for the Taoyuan Airport flight API.
// Runs hourly via GHA. On failure, posts an embed to Discord #gh-events.
//
// Uses curl rather than Node.js native fetch: Cloudflare's TLS/JA3 fingerprint
// checks block undici (Node 22 built-in fetch) even with a browser UA, while
// curl's OpenSSL TLS profile passes. Both issue the exact same HTTP headers.
//
// Contract is derived from getMockFlightData() in e2e/test-helpers.js and
// the "Response fields consumed" list in CLAUDE.md. Only shape is asserted —
// no flight counts, no specific values (volatile; legitimately empty at night).

import { execFileSync } from 'child_process';

const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const REPO = 'TPE-eagle/tpe-sushi-go-round';

// Fields parseApiResponse() and the rendering pipeline depend on.
const REQUIRED_STRING_FIELDS = ['ACode', 'AName', 'FlightNo', 'ODate', 'OTime', 'CityCode', 'CityEname', 'Memo'];
const REQUIRED_NUMBER_FIELDS = ['BNO'];
// Must be present; may be empty string (Gate, PlaneNo) or a derived string.
const EXPECTED_PRESENT_FIELDS = ['Gate', 'PlaneNo', 'CityName', 'flightCode'];

const ODATE_RE = /^\d{4}\/\d{2}\/\d{2}$/;
const OTIME_RE = /^\d{2}:\d{2}:\d{2}$/;

function getTaiwanDate() {
  const now = new Date();
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return tw.toISOString().split('T')[0].replace(/-/g, '/');
}

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

function callApi(date) {
  const body = JSON.stringify({
    ODate: date, OTimeOpen: null, OTimeClose: null,
    BNO: null, AState: 'A', language: 'ch', keyword: '',
  });
  // Separator appended by curl's -w flag; split on last occurrence.
  const SEP = '\n__STATUS__';
  try {
    const raw = execFileSync('curl', [
      '-s',
      '-X', 'POST', API_URL,
      '-H', 'Content-Type: application/json',
      '-H', 'Accept: application/json',
      '-H', 'Accept-Language: zh-TW,zh;q=0.9',
      '-H', 'Origin: https://www.taoyuan-airport.com',
      '-H', 'Referer: https://www.taoyuan-airport.com/flight_arrival',
      '-H', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '-w', `${SEP}%{http_code}`,
      '--data-raw', body,
    ], { encoding: 'utf8', timeout: 30_000 });
    const sepIdx = raw.lastIndexOf(SEP);
    return {
      status: parseInt(raw.slice(sepIdx + SEP.length), 10),
      body: raw.slice(0, sepIdx),
    };
  } catch (err) {
    // curl exits non-zero only on network/protocol failure (not HTTP errors).
    return { status: 0, body: '', networkError: err.message };
  }
}

function checkRecordShape(record, index) {
  const issues = [];
  for (const f of REQUIRED_STRING_FIELDS) {
    if (!(f in record)) { issues.push(`record[${index}] missing \`${f}\``); continue; }
    if (typeof record[f] !== 'string') issues.push(`record[${index}].${f}: expected string, got ${typeof record[f]}`);
  }
  for (const f of REQUIRED_NUMBER_FIELDS) {
    if (!(f in record)) { issues.push(`record[${index}] missing \`${f}\``); continue; }
    if (typeof record[f] !== 'number') issues.push(`record[${index}].${f}: expected number, got ${typeof record[f]}`);
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

async function run() {
  const date = getTaiwanDate();

  // 1 — Availability
  const { status, body: rawBody, networkError } = callApi(date);

  if (networkError || status === 0) {
    await sendDiscordAlert('API unreachable', `curl network error: \`${networkError ?? 'unknown'}\``);
    process.exit(1);
  }
  if (status !== 200) {
    await sendDiscordAlert(
      'Availability failure',
      `HTTP \`${status}\` from Taoyuan Airport API\n\`\`\`\n${rawBody.slice(0, 300)}\n\`\`\``
    );
    process.exit(1);
  }

  // 2 — Contract: response must be a JSON array
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    await sendDiscordAlert('Contract drift', `Response is not valid JSON:\n\`\`\`\n${rawBody.slice(0, 300)}\n\`\`\``);
    process.exit(1);
  }
  if (!Array.isArray(data)) {
    await sendDiscordAlert(
      'Contract drift',
      `Response is not an array (got \`${typeof data}\`):\n\`\`\`json\n${JSON.stringify(data).slice(0, 400)}\n\`\`\``
    );
    process.exit(1);
  }

  // Empty array is legitimate during off-peak windows — not an alert.
  if (data.length === 0) {
    console.log('[canary] ✅ 200 OK, 0 records (off-peak window) — no alert');
    return;
  }

  // 3 — Contract: sample 5 records (head + midpoint + tail) for shape
  const idxs = [...new Set([0, 1, 2, Math.floor(data.length / 2), data.length - 1])].filter(i => i < data.length);
  const issues = idxs.flatMap(i => checkRecordShape(data[i], i));
  const unique = [...new Set(issues)];

  if (unique.length > 0) {
    const detail = unique.map(s => `• ${s}`).join('\n');
    const liveKeys = Object.keys(data[0]).join(', ');
    await sendDiscordAlert(
      'Contract drift',
      `Shape mismatch (${data.length} records; sampled indices ${idxs.join(', ')}):\n${detail}\n\nLive record keys: \`${liveKeys}\``
    );
    process.exit(1);
  }

  console.log(`[canary] ✅ 200 OK, ${data.length} records, contract intact`);
}

run().catch(async err => {
  await sendDiscordAlert('Canary crashed', `\`\`\`\n${(err.stack ?? err.message).slice(0, 500)}\n\`\`\``);
  process.exit(1);
});
