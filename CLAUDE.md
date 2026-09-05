# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project

Mobile-first web app for Taoyuan International Airport flight info, aimed at pilots and cabin crew on BR / CI / JX (including B7 / AE subsidiaries).

- **Live site:** https://tpe-eagle.github.io/tpe-sushi-go-round/
- **Stack:** Vanilla JS (ES module), Bootstrap 5, Vite 8, SCSS, Vitest, Playwright, vite-plugin-pwa (Workbox)
- **CI/CD:** GitHub Actions → GitHub Pages (Node 22 LTS)

## Essential Commands

```bash
npm install
npx playwright install --with-deps    # once, for E2E

npm run dev                # Vite dev server at http://localhost:8080
npm run build              # Production build → dist/ (emits SW + manifest)

npm run test:run           # Unit tests (Vitest, single run)
npm run test:e2e:local     # Local E2E (Playwright, chromium, max workers)
npm run test:e2e:prod      # Production E2E against the live site
```

## Key Files

| File | Purpose |
|------|---------|
| `main.js` | Application logic: data fetching, filtering, rendering, i18n, theme, offline state, events |
| `style.scss` | All styling (CSS variables, responsive breakpoints, animations) |
| `index.html` | SPA entry point (meta tags, CSP, preloads, deferred GTM) |
| `vite.config.js` | Vite build + Vitest config + `vite-plugin-pwa` (Workbox generateSW) + manifest |
| `src/utils/flightUtils.js` | Shared utilities (imported by unit tests; mirrored inline in `main.js`) |
| `src/utils/blockTimes.js` | Hand-maintained TPE block-time table + `findReturnLeg()` return-leg pairing (issue #33; mirrored inline in `main.js`) |
| `e2e/test-helpers.js` | Smart API caching, GA blocking, mock flight generation |

## Data Flow

1. `fetchData()` — POST to Taoyuan Airport API with `OTimeOpen: null, OTimeClose: null` (full day).
2. Sort by airline code then flight number (numeric ascending).
3. Keep BR/CI/JX groups (BR+B7, CI+AE, JX), drop cancelled flights.
4. `filterFlightsByTime()` narrows to the current time window.
5. `renderFilteredView()` applies the airline + plane type pins and renders the airline row, plane type row, flight number row, and table.

## Global State (main.js)

```javascript
let flightData = [];              // Airline-group-filtered, time-windowed flights
let currentFilteredFlights = [];  // After airline + plane type pins
let currentLanguage = 'zh';       // 'zh' | 'en' | 'jp'
let currentACode = null;          // null = all airlines
let currentPlaneType = null;      // null = all families; family strings like 'A330', 'B777'
let currentTheme = 'light';       // 'light' | 'dark'
let currentFlightMode = 'A';      // 'A' (Arrival) | 'D' (Departure)
let currentForwardHours = 2;      // Issue #88: board window reach, cycled +2/+4/+6/+8; in-memory only, reload resets to +2
let allSupportedFlights = [];     // Issue #88: airline-supported, pre-time-filter copy of the day payload (for window re-filtering)
let returnLegArrivals = null;     // Departures-only (issue #33): null = pairing fetch pending, array = resolved
let returnLegFetchToken = 0;      // Bumped every fetchData() call; guards returnLegArrivals against a stale resolve
```

## API Contract

- Endpoint: `https://www.taoyuan-airport.com/api/api/flight/a_flight` (POST)
- Always send `OTimeOpen: null, OTimeClose: null` — fetch full day, filter client-side.
- `language` field: `ch` for Traditional Chinese (not `zh`); `en` and `jp` as-is.
- `Accept-Language` header: `zh-TW`, `ja-JP`, or `en-US` based on current language.
- Response fields consumed: `ACode`, `AName`, `FlightNo`, `Gate`, `ODate`/`OTime`, `RDate`/`RTime`, `CityCode`, `CityEname`, `CityName`, `Memo`, `PlaneNo`, `StopCode`, `BNO`, `flightCode`.

## Time Window

- **Arrival (A):** round current time down to 10-min interval, offset −40 min, then `forwardHours` past the window start (default +2h ⇒ the historical `now−40 → +80` window).
- **Departure (D):** round down to 10-min interval, offset 0, `forwardHours` forward (default +2h ⇒ `now → +120`).
- **Window selector (issue #88):** a button between the plane-type row and the flight-number row cycles `+2h → +4h → +6h → +8h → +2h`. Forward edge only — the arrivals −40 min backward component never scales with the cycle. `currentForwardHours` is in-memory only: preserved across mode/language switches and pull-to-refresh (like the plane type pin's in-session behaviour), reset to +2 on reload. **No cookie/localStorage** — cookie policy is issue #70's. Cycling re-filters the already-fetched day payload (`allSupportedFlights`, the pre-time-filter copy kept in `processFetchedData`) — zero new fetch. `generateFlightNumberButtons()` renders only under an airline pin; with no pin the row is cleared (D2).
- **Midnight truncation (issue #88):** `windowEnd` is clamped to 23:59:59.999 of `now`'s own UTC+8 calendar day — the day of `now`, not of `windowStart` (the arrivals backward component legally places `windowStart` on the previous day around Taipei midnight; truncation only ever bites the end). No second-day fetch, ever: truncation is by design so tomorrow's payload (2.7% `Gate` population, marketing-carrier duplicate rows — #67) can never enter the board, and `findReturnLeg()`'s same-day pairing is untouched.
- The window math lives twice on purpose: pure + unit-tested in `src/utils/flightUtils.js` (`filterFlightsByTime(flights, mode, now, forwardHours = 2)` — the default keeps the 3-argument canary call at +2) and mirrored inline in `main.js` (reads the `currentForwardHours` global). Keep the two copies in sync.
- A flight is shown when **either** `ODateTime` or `RDateTime` falls in the window.
- All times are UTC+8.

## Departures Return-Leg Gate (issue #33)

Departures mode shows a 5th column: the same-day return leg's TPE arrival gate, for crew on a day-return duty.

- **Pairing rule** (`findReturnLeg()` in `src/utils/blockTimes.js`, mirrored inline in `main.js`): same `ACode`, same `CityCode` (arrival's origin == departure's destination), same `ODate` as the departure's own record, same aircraft **family** (`extractPlaneFamily(PlaneNo)`, e.g. `A321-271N` → `A321` — a same-day return doesn't change equipment, and type ratings are family-level, so a `-9`/`-10` or `-200`/`-271N` variant swap is still a match; an unresolvable family, empty/`-`/no `[AB]\d{3}` prefix, on either leg is never treated as a match — the opposite of `filterByPlaneType()`'s TBD-always-passes rule, because here a wrong gate is worse than a blank), arrival scheduled later than the departure, `|FlightNo(arrival) − FlightNo(departure)| == 1`, and the gap must fall in `[2 × blockTime(city) + 40 min turnaround, 2 × blockTime(city) + 4h]` (lower bound rejects adjacency coincidences that aren't physically the same rotation; upper bound rejects implausibly long implied ground time). Unknown city (not in `BLOCK_TIME_MINUTES`) → abstain, don't guess.
- **`dayReturn(ACode, CityCode)` override**: applied at render time, on top of `findReturnLeg()`'s result — blanks the cell regardless of what the pairing found. Defaults `true`; hand-maintained 7-entry override list (`CTS`/`SIN`/`KUL`/`PEN`/`CGK`/`DPS` for every carrier, `BKK` for `BR` only) encodes crew-pattern night stops that aren't derivable from block time (CTS at 3.9h block is a night stop, BKK at 3.6h is a day return — no threshold separates them). Do not widen this list or compute it without a new pilot ruling.
- **Multi-candidate tie-break**: a departure can have adjacency candidates at both `FlightNo−1` and `FlightNo+1` on dense same-city routes. Every candidate is gated independently; if more than one passes, the smallest gap wins. There is **no** global one-to-one exclusivity across different departures — on rare dense routes the same arrival can be the best match for two different departure rows.
- **Extra fetch**: departures mode triggers a second, non-blocking full-day `AState=A` fetch (`fetchReturnLegArrivals()`) — NOT time-window-filtered, since a return leg's gate may already be published well before the display window reaches it. Cache key is naturally distinct from the departures entry (AState is part of the cached postData). `returnLegFetchToken` guards against a slow resolve clobbering the UI after the user has moved on (mode toggle, language change, another refresh). First paint never blocks on this fetch — the table renders immediately with the 5th column showing the previous cycle's pairing (or blank, on the very first departures fetch), then back-fills via `renderFilteredView()` once the fetch resolves. `fetchData()` deliberately does **not** reset `returnLegArrivals` to `null` on every call (issue #40 item 1) — doing so used to blank the column on every refresh/language-switch/mode-toggle before the new fetch resolved; keeping the previous array avoids that flicker at the cost of briefly showing stale pairing data. `returnLegFetchToken` only guards against a stale *response* overwriting a newer in-flight fetch's result — it says nothing about stale data already sitting in `returnLegArrivals` being rendered against a new day's `flightData`. The actual cross-day backstop is `findReturnLeg()`'s requirement that the arrival's `ODate` equal the departure's own: yesterday's leftover arrivals stop matching and the cell goes blank rather than showing a wrong gate. On a failed or offline-with-no-cache pairing fetch, `fetchReturnLegArrivals()` blanks `returnLegArrivals` explicitly rather than leaving the previous cycle's array in place indefinitely — item 1's flicker trade-off only applies to a *successful* refresh, not to "nothing new is ever coming for this token" (issue #40 PR #56 review). `mainDataReadyForToken` is reset to `-1` at the top of every `fetchData()` call (issue #40 item 2) so a value left over from a previous token can't spuriously satisfy a later token's render-gate check in `fetchReturnLegArrivals()`.
- **Layout / display design**: the return-gate cell always carries a `←` (U+2190) direction glyph, in every viewport — never a `title`-only distinction (touch devices have no hover) and never dependent on comparing against a neighbouring cell (the single-flight filtered view has no neighbour). One line only, both breakpoints: `← C5` at ≤768px, `← BR178 C5` above it. The departure's own gate (column 4) stays bold/primary; the return gate (`.return-gate-cell` in `style.scss`) is regular weight in a secondary colour mixed toward `--background-color` (not `opacity`/alpha — read outdoors in daylight, needs a real 4.5:1 contrast floor in both themes). Column only renders in `AState=D` mode.
- **Primary-fetch staleness guard (issue #39)**: `fetchData()`'s main fetch is guarded by its own `mainFetchToken`, bumped at the top of every `fetchData()` call — mirrors `returnLegFetchToken` but tracks the primary flight-data fetch instead of the return-leg pairing fetch. A resolve whose captured token no longer matches `mainFetchToken` (a mode/language toggle or another refresh started after this fetch was issued) drops silently after still writing to the offline cache (a superseded response is still valid fallback data) but before touching `flightData`, the offline banner, or `mainDataReadyForToken`. Covered end to end by `e2e/fetch-staleness.spec.js`, which holds the initial fetch open, toggles mode before it resolves, and asserts the board still shows the new mode's data once the stale response lands late.

## PWA and Offline UX

- `vite-plugin-pwa` generates `dist/sw.js` + `dist/manifest.webmanifest` on build. `registerType: 'autoUpdate'` so new deploys replace the SW without user action.
- Precache is limited to the app shell (`**/*.{js,css,html,ico,png,svg,webmanifest}`). External origins (Taoyuan Airport API, Google Fonts, GTM) fall through to the network.
- The airport API is untouched by Workbox: Workbox never caches `POST` requests by default, and the API URL is never added to a runtime caching route.
- `index.html` intentionally carries **no** `Cache-Control: no-store` meta; those headers defeat Workbox precaching of the shell.
- `#offline-banner` is a thin amber strip above the main container. It renders:
  - generic "Offline" when `navigator.onLine === false` with no cache context;
  - "Offline — showing data from N min ago" when a cached response is used as a fallback.
- `fetchData()` never serves `localStorage` when online — it always hits the API so gate / carousel updates surface immediately. The cache is read only when `navigator.onLine === false`, in which case any age is accepted and shown with a staleness banner. The `online` event automatically re-fetches fresh data. The fetch itself passes `cache: 'no-store'` as a belt-and-braces measure against intermediate HTTP caches. If the request fails while online, the user sees the generic error message rather than a stale cache fallback.
- `manifest` fields are generated by `vite-plugin-pwa` from `vite.config.js`, including `start_url`, `scope`, `id`, `categories`, and a maskable icon variant. Do not re-add a static `public/site.webmanifest`; it would shadow the generated one.

## Plane Type Filter

Pilots pin their airline first, then optionally pin an aircraft family.

- Family granularity: regex `/^([AB]\d{3})/` on `PlaneNo` (e.g., `A321-271N` → `A321`, `B777-300ER` → `B777`). `-`, empty, or unparseable values are TBD.
- **TBD flights always pass the plane type filter** so a pilot does not miss a flight before the fleet is assigned by the airline.
- The plane type row only renders when an airline is pinned. Its buttons are dynamically generated from the families actually present in the current airline's flights (`getAvailableFamilies`).
- Switching airline always clears the plane type pin (families rarely carry meaningful intent across carriers).
- Every other action (flight mode toggle, language change, pull-to-refresh, cold load from cookie) **preserves** the plane type pin, even when the family has no matching flights in the current fetched list. The app never silently drops a user-set pin: the empty-state block surfaces with a "clear aircraft type" button, and `generatePlaneTypeLinks` keeps the pinned family's button visible so the user can see and remove the pin deliberately.
- Cookies are restored once per page load via the `initialPinsRestored` guard in `processFetchedData`; in-session refetches preserve the in-memory state as-is.
- The one tidy-up on cold load: a `PlaneType` cookie with no corresponding `ACode` cookie is cleared, because plane type is scoped to an airline pin.

## Pull-to-refresh

Mobile gesture implemented with three visual states, all driven by CSS transitions on `#refresh-icon`:

- **Pulling** (below threshold): pill fades in and slides down proportional to pull distance, shows just the 🔄 emoji.
- **Armed** (at or past the 200px threshold): pill locks into the EVA sage colour and swaps copy to the `releaseToRefresh` translation key.
- **Refreshing** (after release): pill pulses while `fetchData` runs; text becomes the existing `refreshing` copy.

`hideRefreshIndicator()` is the shared exit animation, called from `displayFlights` (fetch complete), the cancel path in `touchend` (released without crossing threshold), and the safety `setTimeout` in `triggerRefresh`.

## Cookies

| Name | Scope | Expiry |
|---|---|---|
| `ACode` | Selected airline | 400 days (sliding, renewed each load) |
| `PlaneType` | Selected aircraft family | 400 days (sliding, renewed each load) |
| `theme` | `light` / `dark` (falls back to `prefers-color-scheme`) | 400 days (sliding, renewed each load) |

Language is detected from `navigator.language` on each load; not persisted.

## Responsive

- Breakpoint: 768px (`isSmallScreen()`).
- Mobile: abbreviated table headers, city codes instead of names, smaller airline logos.
- `resize` and `orientationchange` trigger re-render.

## i18n

- Languages: `zh` (Traditional Chinese), `en`, `jp`.
- Dynamic Google Font loading: Noto Sans / Noto Sans TC / Noto Sans JP.
- `translations` object in `main.js` is the single source of truth for UI strings, including plane type filter copy (`flightsInWindow`, `currentFilter`, `noMatch`, `clearAircraftType`, `airlineNoFlights`), offline UX copy (`offlineBanner`, `offlineFresh`, `offlineNoCache`), pull-to-refresh state copy (`releaseToRefresh`, plus the existing `refreshing`), and the departures return-leg gate header (`tableHeaders.ReturnGate` / `ReturnGateShort`).
- Airline and city names come from the API (localized by the `language` field); do not hardcode.

## Key Design Decisions

**Never set time range in API requests.** Always send `OTimeOpen: null, OTimeClose: null`; rely on client-side `filterFlightsByTime()`. Historical rationale: a flight with scheduled time outside the window but actual time inside was being dropped at the server. Server-side filtering uses one of the two fields, not both.

**Localhost skips client-side time filtering.** `filterFlightsByTime()` is intentionally bypassed when `window.location.hostname` is `localhost` or `127.0.0.1` (see `processFetchedData` in `main.js`). This keeps mock E2E data visible regardless of wall-clock drift during the test run. `npm run dev` therefore shows the full day; production respects the window. If you change the mock's time generation, revisit whether this skip is still needed.

**E2E smart API caching (`setupSmartApiRoute`, `e2e/smart-api-cache.spec.js` only).** First real request per `AState` makes a real API call and caches that state's response for 30 minutes; subsequent requests for the same state reuse it with language-specific `AName` rewrites. Falls back to generated mock data if the real call fails. Cache is keyed per-state (issue #38) — an arrival and a departure request in the same window each get their own cached blob, never each other's. Every other E2E spec uses `setupMockApiRoute` instead (fully synthetic, no live network dependency), which is why this pattern only has one dedicated spec exercising it.

**Block Google Analytics in E2E.** All setups call `blockGoogleAnalytics()` to avoid tracking noise and CSP flakiness.

**Shared utility module with inline duplication.** `src/utils/flightUtils.js` is imported by unit tests. `main.js` re-implements the same functions inline (no import) to keep the bundle self-contained. **These two copies must stay in sync.** Current duplicated functions: `filterFlightsByTime`, `filterSupportedAirlines`, `getTimeWindowConfig`, `getTimeWindow`, `roundDownToStep`, `extractPlaneFamily`, `getAvailableFamilies`, `filterByPlaneType`, `hasVendoredLogo` (plus the `KNOWN_LOGO_CODES` constant it reads — issue #69). Same convention applies to `src/utils/blockTimes.js`: `BLOCK_TIME_MINUTES`, `TURNAROUND_MINUTES`, `getMinPlausibleRoundTripMinutes`, `findReturnLeg`, `dayReturn`. (`getUncoveredCityCodes` is test/build-time only — not part of the render path, not mirrored in `main.js`. `findReturnLeg`'s aircraft-type check calls `extractPlaneFamily`, already in this list.)

**CSP `connect-src` lists only real origins.** An earlier commit included `https://api.taoyuan-airport.com`, which does not resolve in DNS. The real API lives at `https://www.taoyuan-airport.com/api/api/flight/a_flight` (the `www` host with an `/api/` path). Only add origins to CSP that the app actually talks to.

## Testing

### Unit (`src/test/`)
- `api.test.js` — post-data shape, time window math, flight filtering, BR35 regression.
- `cache.test.js` — localStorage lifecycle, expiry, cleanup, quota handling.
- `etag-integration.test.js` — ETag / 304 support (run with `NODE_ENV=integration`).
- `planetype.test.js` — family extraction, TBD handling, per-airline family list, type filter.
- `setup.js` — global mocks (fetch, matchMedia, localStorage, console).

### E2E (`e2e/`)
- `api-integration.spec.js` — API parameter validation, display, mode switching.
- `language-detection.spec.js` — browser detection, manual switching, all three languages.
- `user-interaction.spec.js` — airline filter, theme toggle, cookie persistence, responsive layout.
- `plane-type.spec.js` — plane type row visibility, dynamic family list, pin / clear, airline switch reset, TBD flights always visible, pin survives cold load and flight mode toggle even when the family has no matches, orphan cookie cleanup.
- `offline.spec.js` — offline banner visibility on `offline` / `online` events. (Dev server has no active SW, so the SW cache path itself is not exercised here.)
- `smart-api-cache.spec.js` — `setupSmartApiRoute()`'s per-`AState` cache keying and the payload each mode actually receives (issue #38).
- `return-gate.spec.js` — departures return-gate column end to end (issue #33 / #40 item 5): a pairable return leg renders `← <flight> <gate>`, a `dayReturn`-override city stays blank even when a plausible pairing exists. Uses `setupMockApiRoute`'s `arrivalsMockData` parameter (issue #40) to give the departures request and the return-leg pairing fetch distinct payloads — otherwise both AState requests would see the same re-tagged list and a departure could never pair with anything but itself.
- `production.spec.js` — live site smoke tests against GitHub Pages.

### Playwright configs
- `playwright.local.config.js` — chromium only, `os.cpus().length` workers locally, 2 in CI, 10s timeout.
- `playwright.prod.config.js` — Chromium + Mobile Chrome + Mobile Safari against the live site.

## CI/CD

Workflow: `.github/workflows/ci.yml`.

| Job | Trigger | Fails the run if red? | Depends on |
|-----|---------|------------------------|------------|
| `unit-tests` | push/PR to main | Yes | — |
| `e2e-tests-local` | after `unit-tests` | Yes | `unit-tests` |
| `build-check` | PR to main only | Yes | `unit-tests` |
| `deploy` | push to main | Yes | `unit-tests` |
| `e2e-tests-production` | after `deploy` (push) / also on PR | Yes | `deploy` |

`deploy` depends only on `unit-tests`, **not** `e2e-tests-local` — a red local E2E does not stop a push to main from deploying to GitHub Pages. The only `continue-on-error: true` in the workflow is on the PR-comment reporting step inside `e2e-tests-production`, not the step that actually executes the tests, so neither E2E job is a soft gate.

On PRs, `e2e-tests-production` runs even though `deploy` is skipped — `!cancelled()` (`ci.yml:173`) is what allows that. **A PR run of that job exercises the current deployment, not the PR's build**: it's deployment smoke against the already-deployed live site (`playwright.prod.config.js`'s own header: "deployment smoke only, no data assertions"), so it has nothing to do with the PR's build either way. `production.spec.js` does **not** mock the flight API — it hits the real `www.taoyuan-airport.com` endpoint and asserts a real POST goes out to it. (It does route-block Google Analytics via `blockGoogleAnalytics`, but that's unrelated tracker suppression, not mocking of app data.) It verifies changes to the test harness (`production.spec.js`, the prod config) pre-merge; app-code regressions in a PR are gated solely by `e2e-tests-local`.

Because it reaches a live third-party API, `e2e-tests-production` puts an external dependency in every PR's path: an upstream outage or rate-limit on `www.taoyuan-airport.com` can redden a PR that changed nothing relevant. It's the only CI job that touches the public internet, so it's the first thing to suspect when a PR goes red without touching anything obviously related.

## AI Development Workflow

Before changes:
1. `npm run test:run` — confirm the baseline passes.
2. Read this file and the file you're about to edit.

After changes:
1. `npm run test:run` again. Fix production code, not tests, unless the user explicitly approves.
2. `npm run build` to confirm the bundle still compiles.
3. For UI changes, open `npm run dev` and exercise the change in a browser. Type checks and test suites verify code, not feature correctness.

When uncertain:
- All times are UTC+8. Watch for timezone drift in new tests.
- Do not guess at API response fields; probe the real endpoint or inspect `e2e/test-helpers.js` mock.
- Adding an airline: update `AIRLINE_CODES` and `AIRLINE_GROUPS` in both `main.js` and `src/utils/flightUtils.js`, plus logo / colour styles in `style.scss`. Also vendor the new code's GIF into `public/logos/` and add it to `KNOWN_LOGO_CODES` (both copies) — otherwise `hasVendoredLogo()` correctly abstains and the airline silently renders with no logo.
- Changing a duplicated utility: update both `main.js` and `src/utils/flightUtils.js` in the same commit.

## Global Behavior Rules

These rules apply to the main Claude and to every sub-agent launched inside
this repo. Sub-agents treat them as higher priority than their own system
prompt. They are cross-project working conventions, not project trivia.

### Factual claims must be verified before they are written

When editing anything that contains a file path, line number, function /
class / method name, enum or type member, API endpoint, environment
variable, configuration key, cookie name, translation key, or CSS
selector — including `CLAUDE.md`, agent prompts, code comments, commit
messages, and PR descriptions — the fact must first be confirmed against
the real file with `ls` / `grep` / `find` / `Read`. Memory, guesswork,
and copy-paste from other documents are not acceptable sources.

If a written value is being corrected, state the wrong value, the
verified value, and the command that proved it. Do not proactively
rewrite an identifier without evidence.

### Session end self-check

When the user signals intent to stop ("push", "done for today", "let's
wrap up", "restart the session", etc.), automatically run `git status`.
For each modified or untracked file, state which conversation it came
from, propose a commit message, and wait for explicit confirmation
before committing. The goal is a clean working tree before the session
ends, so the next session is not stuck guessing why 4 files are dirty.

### Resume summaries are not authoritative

After a compaction + resume, the summary describes state at a past
moment; `git` has continued moving. Before acting on any "pending item"
the summary mentions, run `git log --oneline -15` and, if the summary
names a specific path, `git log --oneline <last-known-sha>..HEAD --
<path>`. If the pending work has already shipped, tell the user the
summary is stale and ask for a new direction — do not blindly redo it.

### Know vs findable: classify before answering

When the user asks a meta question about knowledge ("how much do you
know about X", "have you seen Y"), mentally classify the answer into
three tiers before replying:

- **(a) in-context, remembered** — answer directly.
- **(b) not checked yet, but discoverable in one or two commands**
  (`grep`, `git log`, `Read`, `ls`) — **run the check and then answer**.
  Do not respond with "I don't know" and wait to be pushed into
  verifying.
- **(c) genuinely outside reach** (external systems, undocumented
  decisions, prior session transcripts) — flag that the user must
  supply it.

Labelling (b) as (c) understates what is verifiable right now. It
wastes the user's time and undersells the system.
