// PR-time reachability check: does the stealth browser still clear Cloudflare and reach
// the flight API from this (US datacenter) runner? Runs on every canary PR so a Cloudflare
// tightening that breaks the approach is caught before merge. No incident/Discord side
// effects — just a pass/fail probe. exit 0 = reachable, exit 1 = blocked.
//
// Also logs the live record count + key set for both legs (arrivals and departures),
// unconditionally, on every PR run — issue #83. This is evidence for whoever is deriving
// or reviewing api-canary.mjs's field-list contracts (ARRIVALS_FIELDS / DEPARTURES_FIELDS):
// a standing log line here means the next field-list change gets a real sample for free
// instead of needing its own one-off dispatch. Pass/fail stays arrivals-reachability-only
// (below) — departures is log-only and never fails this job, including when it comes back
// empty (0 records is a legitimate off-peak result, not a probe failure).
import { probeFlightApiPair, isChallengeHtml } from './probe.mjs';

function getTaiwanDate() {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.toISOString().split('T')[0].replace(/-/g, '/');
}

function logLeg(label, { status, body, networkError }) {
  console.log(`[probe] ${label}: status=${status} len=${body?.length ?? 0}`);
  console.log(`[probe] ${label} head: ${(body || networkError || '').replace(/\s+/g, ' ').slice(0, 200)}`);
  const head = (body || '').trimStart();
  if (head.startsWith('[')) {
    try {
      const data = JSON.parse(body);
      console.log(`[probe] ${label} records: ${data.length}`);
      console.log(`[probe] ${label} keys: ${data.length > 0 ? Object.keys(data[0]).join(', ') : '(empty — no record to sample)'}`);
    } catch {
      console.log(`[probe] ${label} records: (JSON.parse failed)`);
    }
  }
}

const { arrivals, departures } = await probeFlightApiPair(getTaiwanDate());
logLeg('arrivals', arrivals);
logLeg('departures', departures);

const { status, body } = arrivals;
const head = (body || '').trimStart();
if (status === 200 && head.startsWith('[') && (head.includes('FlightNo') || head.includes('"AState"'))) {
  console.log('✅ PASS — stealth browser cleared Cloudflare and got flight JSON. Playwright canary is viable on GitHub Actions.');
  process.exit(0);
}
if (isChallengeHtml(body)) {
  console.log('[probe] still challenged — Cloudflare blocked the stealth browser. Escalate: rebrowser-playwright → headed+xvfb → CF-solver.');
}
console.log('❌ FAIL — did not get flight data.');
process.exit(1);
