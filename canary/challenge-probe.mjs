// PR-time reachability check: does the stealth browser still clear Cloudflare and reach
// the flight API from this (US datacenter) runner? Runs on every canary PR so a Cloudflare
// tightening that breaks the approach is caught before merge. No incident/Discord side
// effects — just a pass/fail probe. exit 0 = reachable, exit 1 = blocked.
import { probeFlightApi, isChallengeHtml } from './probe.mjs';

function getTaiwanDate() {
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.toISOString().split('T')[0].replace(/-/g, '/');
}

const { status, body, networkError } = await probeFlightApi(getTaiwanDate());

console.log(`[probe] status=${status} len=${body?.length ?? 0}`);
console.log(`[probe] head: ${(body || networkError || '').replace(/\s+/g, ' ').slice(0, 200)}`);

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
