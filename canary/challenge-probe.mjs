// Probe: can a headless browser on THIS runner pass Taoyuan Airport's Cloudflare
// JS challenge and reach the flight API?
//
// Why this exists: the flight API sits behind a Cloudflare managed challenge.
//   - curl always gets HTTP 403 "Just a moment" (it can't run the challenge JS).
//   - the cf_clearance cookie the challenge grants is bound to the IP that solved it,
//     so a cookie captured elsewhere can't be shipped in (verified: a Taiwan-browser
//     cookie replayed from a Japan host → challenge again).
// The only way to probe is a REAL browser that solves the challenge from its own IP.
// This script proves whether that works on a GitHub-hosted (US datacenter) runner.
//
// exit 0 = passed (got flight JSON) · exit 1 = blocked (challenge not cleared).
import { chromium } from '@playwright/test';

const PAGE_URL = 'https://www.taoyuan-airport.com/flight_arrival?lang=en';
const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const browser = await chromium.launch({
  headless: true,
  args: ['--disable-blink-features=AutomationControlled'],
});
const context = await browser.newContext({
  userAgent: UA,
  locale: 'en-US',
  timezoneId: 'Asia/Taipei',
  viewport: { width: 1366, height: 768 },
});
const page = await context.newPage();

let passed = false;
try {
  console.log(`[probe] goto ${PAGE_URL}`);
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Let the CF managed challenge run its JS and clear (title stops being "Just a moment...").
  await page
    .waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  console.log(`[probe] page title after challenge window: "${await page.title()}"`);

  // Ask the real browser (with whatever cf_clearance it just earned) to hit the API same-origin.
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  const res = await page.evaluate(async ({ url, today }) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' },
        body: JSON.stringify({ ODate: today, OTimeOpen: null, OTimeClose: null, BNO: null, AState: 'A', language: 'en', keyword: '' }),
      });
      const text = await r.text();
      return { status: r.status, len: text.length, head: text.slice(0, 300) };
    } catch (e) {
      return { status: -1, err: String(e) };
    }
  }, { url: API_URL, today });

  console.log(`[probe] API status=${res.status} len=${res.len ?? 0}`);
  console.log(`[probe] body head: ${(res.head ?? res.err ?? '').replace(/\s+/g, ' ').slice(0, 200)}`);

  const head = (res.head || '').trimStart();
  if (res.status === 200 && head.startsWith('[') && (head.includes('FlightNo') || head.includes('"AState"'))) {
    passed = true;
  } else if ((res.head || '').includes('Just a moment')) {
    console.log('[probe] verdict: still challenged — headless browser was detected/blocked.');
  }
} finally {
  await browser.close();
}

if (passed) {
  console.log('✅ PASS — headless browser cleared the CF challenge and got flight JSON. A Playwright canary is viable on GitHub Actions (no Tailscale / no infra needed).');
  process.exit(0);
}
console.log('❌ FAIL — did not get flight data (challenge not cleared). Needs stealth/headed browser, or another approach.');
process.exit(1);
