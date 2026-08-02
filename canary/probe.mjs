// Shared browser probe for the Taoyuan Airport flight API.
//
// The API sits behind a Cloudflare managed challenge. curl / undici (Node fetch) get
// HTTP 403 "Just a moment" — they can't run the challenge JS — and the cf_clearance
// cookie a browser earns is bound to the IP that solved it, so a captured cookie can't
// be shipped in. The only way to reach the API from CI is a real browser whose
// fingerprint passes Cloudflare's bot check. playwright-extra + the stealth plugin keep
// that bot score low enough that the request passes without a challenge — verified from
// a GitHub-hosted (US datacenter) runner.
//
// Returns { status, body, networkError } — same shape the state machine expects.
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

export const API_URL =
  process.env.CANARY_API_URL ?? 'https://www.taoyuan-airport.com/api/api/flight/a_flight';

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

// True when a response body is a Cloudflare challenge page rather than API output.
// Lets the caller distinguish "the canary itself was blocked" from "the API is down".
export function isChallengeHtml(body) {
  return typeof body === 'string' && /just a moment|cf-mitigated|__cf_chl|cf_chl_opt/i.test(body);
}

// Opens one browser/page, clears Cloudflare's challenge once, and hands the page to
// `fn`. A second `chromium.launch()` just to change a request param would double this
// probe's bot-score exposure from the same runner IP for no reason — #67 hit this
// directly ("repeated chromium.launch() from the same runner IP is exactly what raises
// the bot score") when it needed several (date, AState) fetches in one run.
async function withProbePage(fn) {
  let browser;
  try {
    browser = await chromium.launch({
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

    // A top-level navigation to the API origin passes Cloudflare's bot check (with
    // stealth) and gives us a same-origin context to fetch from.
    await page.goto(API_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    await page.waitForFunction(() => !/just a moment/i.test(document.title), { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(2_000);

    return await fn(page);
  } finally {
    if (browser) await browser.close();
  }
}

async function fetchOnPage(page, date, state) {
  const payload = JSON.stringify({
    ODate: date, OTimeOpen: null, OTimeClose: null,
    BNO: null, AState: state, language: 'ch', keyword: '',
  });
  const res = await page.evaluate(async ({ url, payload }) => {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/plain, */*' },
        body: payload,
      });
      return { status: r.status, body: await r.text() };
    } catch (e) {
      return { status: 0, body: '', error: String(e) };
    }
  }, { url: API_URL, payload });

  if (res.status === 0) return { status: 0, body: '', networkError: res.error };
  return { status: res.status, body: res.body };
}

export async function probeFlightApi(date, state = 'A') {
  try {
    return await withProbePage(page => fetchOnPage(page, date, state));
  } catch (err) {
    return { status: 0, body: '', networkError: err.message };
  }
}

// Fetches AState=A (arrivals) and AState=D (departures) for the same date in one
// browser session — see withProbePage for why this isn't two probeFlightApi() calls.
export async function probeFlightApiPair(date) {
  try {
    return await withProbePage(async page => ({
      arrivals: await fetchOnPage(page, date, 'A'),
      departures: await fetchOnPage(page, date, 'D'),
    }));
  } catch (err) {
    const failed = { status: 0, body: '', networkError: err.message };
    return { arrivals: failed, departures: failed };
  }
}
