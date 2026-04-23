# CLAUDE.md

Guidance for Claude Code when working in this repo.

## Project

Mobile-first web app for Taoyuan International Airport flight info, aimed at pilots and cabin crew on BR / CI / JX (including B7 / AE subsidiaries).

- **Live site:** https://tpe-eagle.github.io/tpe-sushi-go-round/
- **Stack:** Vanilla JS (ES module), Bootstrap 5, Vite 6, SCSS, Vitest, Playwright
- **CI/CD:** GitHub Actions → GitHub Pages (Node 18)

## Essential Commands

```bash
npm install
npx playwright install --with-deps    # once, for E2E

npm run dev                # Vite dev server at http://localhost:8080
npm run build              # Production build → dist/

npm run test:run           # Unit tests (Vitest, single run)
npm run test:e2e:local     # Local E2E (Playwright, chromium, max workers)
npm run test:e2e:prod      # Production E2E against the live site
```

## Key Files

| File | Purpose |
|------|---------|
| `main.js` | Application logic: data fetching, filtering, rendering, i18n, theme, events |
| `style.scss` | All styling (CSS variables, responsive breakpoints, animations) |
| `index.html` | SPA entry point (meta tags, CSP, preloads, deferred GTM) |
| `src/utils/flightUtils.js` | Shared utilities (imported by unit tests; mirrored inline in `main.js`) |
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
```

## API Contract

- Endpoint: `https://www.taoyuan-airport.com/api/api/flight/a_flight` (POST)
- Always send `OTimeOpen: null, OTimeClose: null` — fetch full day, filter client-side.
- `language` field: `ch` for Traditional Chinese (not `zh`); `en` and `jp` as-is.
- `Accept-Language` header: `zh-TW`, `ja-JP`, or `en-US` based on current language.
- Response fields consumed: `ACode`, `AName`, `FlightNo`, `Gate`, `ODate`/`OTime`, `RDate`/`RTime`, `CityCode`, `CityEname`, `CityName`, `Memo`, `PlaneNo`, `StopCode`, `BNO`, `flightCode`.

## Time Window

- **Arrival (A):** round current time down to 10-min interval, offset −40 min, 120-min duration.
- **Departure (D):** round down to 10-min interval, offset 0, 120-min duration.
- A flight is shown when **either** `ODateTime` or `RDateTime` falls in the window.
- All times are UTC+8.

## Plane Type Filter

Pilots pin their airline first, then optionally pin an aircraft family.

- Family granularity: regex `/^([AB]\d{3})/` on `PlaneNo` (e.g., `A321-271N` → `A321`, `B777-300ER` → `B777`). `-`, empty, or unparseable values are TBD.
- **TBD flights always pass the plane type filter** so a pilot does not miss a flight before the fleet is assigned by the airline.
- The plane type row only renders when an airline is pinned. Its buttons are dynamically generated from the families actually present in the current airline's flights (`getAvailableFamilies`).
- Switching airline always clears the plane type pin (families rarely carry meaningful intent across carriers).
- A saved `PlaneType` cookie pointing to a family not present in the current window is silently dropped (`reconcilePlaneTypePin`) on load.

## Cookies

| Name | Scope | Expiry |
|---|---|---|
| `ACode` | Selected airline | 7 days |
| `PlaneType` | Selected aircraft family | 7 days |
| `theme` | `light` / `dark` (falls back to `prefers-color-scheme`) | 7 days |

Language is detected from `navigator.language` on each load; not persisted.

## Responsive

- Breakpoint: 768px (`isSmallScreen()`).
- Mobile: abbreviated table headers, city codes instead of names, smaller airline logos.
- `resize` and `orientationchange` trigger re-render.

## i18n

- Languages: `zh` (Traditional Chinese), `en`, `jp`.
- Dynamic Google Font loading: Noto Sans / Noto Sans TC / Noto Sans JP.
- `translations` object in `main.js` is the single source of truth for UI strings.
- Airline and city names come from the API (localized by the `language` field); do not hardcode.

## Key Design Decisions

**Never set time range in API requests.** Always send `OTimeOpen: null, OTimeClose: null`; rely on client-side `filterFlightsByTime()`. Historical rationale: a flight with scheduled time outside the window but actual time inside was being dropped at the server. Server-side filtering uses one of the two fields, not both.

**Localhost skips client-side time filtering.** `filterFlightsByTime()` is intentionally bypassed when `window.location.hostname` is `localhost` or `127.0.0.1` (see `processFetchedData` in `main.js`). This keeps mock E2E data visible regardless of wall-clock drift during the test run. `npm run dev` therefore shows the full day; production respects the window. If you change the mock's time generation, revisit whether this skip is still needed.

**E2E smart API caching.** First E2E run makes a real API call and caches the response for 30 minutes; subsequent tests reuse it with language-specific `AName` rewrites. Falls back to generated mock data if the real call fails.

**Block Google Analytics in E2E.** All setups call `blockGoogleAnalytics()` to avoid tracking noise and CSP flakiness.

**Shared utility module with inline duplication.** `src/utils/flightUtils.js` is imported by unit tests. `main.js` re-implements the same functions inline (no import) to keep the bundle self-contained. **These two copies must stay in sync.** Current duplicated functions: `filterFlightsByTime`, `filterSupportedAirlines`, `getTimeWindowConfig`, `getTimeWindow`, `roundDownToStep`, `extractPlaneFamily`, `getAvailableFamilies`, `filterByPlaneType`.

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
- `plane-type.spec.js` — plane type row visibility, dynamic family list, pin / clear, airline switch reset, TBD flights always visible, stale cookie reconcile, flight mode toggle preserves pin.
- `production.spec.js` — live site smoke tests against GitHub Pages.

### Playwright configs
- `playwright.local.config.js` — chromium only, `os.cpus().length` workers locally, 2 in CI, 10s timeout.
- `playwright.prod.config.js` — Chromium + Mobile Chrome + Mobile Safari against the live site.

## CI/CD

Workflow: `.github/workflows/ci.yml`.

| Job | Trigger | Blocking |
|-----|---------|----------|
| `unit-tests` | push/PR to main | Yes |
| `e2e-tests-local` | after unit-tests | No (`continue-on-error`) |
| `deploy` | push to main | Yes |
| `e2e-tests-production` | after deploy | No (`continue-on-error`) |

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
- Adding an airline: update `AIRLINE_CODES` and `AIRLINE_GROUPS` in both `main.js` and `src/utils/flightUtils.js`, plus logo / colour styles in `style.scss`.
- Changing a duplicated utility: update both `main.js` and `src/utils/flightUtils.js` in the same commit.
