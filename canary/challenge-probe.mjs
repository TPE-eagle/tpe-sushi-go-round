// Probe: can a STEALTH headless browser on this runner pass Taoyuan's Cloudflare
// managed challenge and reach the flight API?
//
// v1 (vanilla headless) result: the flight_arrival HTML page loaded fine, but the
// same-origin fetch to the API returned 403 "Just a moment" — the browser never
// earned a cf_clearance cookie (headless was detected; and the HTML page itself
// isn't challenged, so nothing triggered a solve). Two changes here:
//   1. playwright-extra + stealth plugin to evade headless detection.
//   2. drive a TOP-LEVEL navigation to the API URL, which is what actually triggers
//      the CF interstitial — solving it grants cf_clearance. A fetch() can't: it just
//      receives the challenge HTML without running its JS.
//
// exit 0 = passed (got flight JSON) · exit 1 = blocked.
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

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
  // A top-level navigation to the API path triggers the CF interstitial; a real
  // (stealth) browser runs its JS and is granted cf_clearance.
  console.log(`[probe] top-level goto ${API_URL} to trigger + solve the challenge`);
  await page.goto(API_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
    .catch((e) => console.log(`[probe] goto note: ${String(e).slice(0, 90)}`));
  await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(4000);

  const cookies = await context.cookies();
  const hasClearance = cookies.some((c) => c.name === 'cf_clearance');
  console.log(`[probe] cookies: [${cookies.map((c) => c.name).join(', ')}]`);
  console.log(`[probe] cf_clearance earned: ${hasClearance}; title now: "${await page.title()}"`);

  // Now POST the API from inside the page (real browser fetch + earned cf_clearance).
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
    console.log('[probe] verdict: still challenged — stealth was not enough to earn cf_clearance.');
  }
} finally {
  await browser.close();
}

if (passed) {
  console.log('✅ PASS — stealth headless browser cleared the CF challenge and got flight JSON. Playwright canary is viable on GitHub Actions (no Tailscale / no infra).');
  process.exit(0);
}
console.log('❌ FAIL — did not get flight data. Escalate: rebrowser-playwright → headed+xvfb → CF-solver.');
process.exit(1);
