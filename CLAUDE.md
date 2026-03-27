# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**TPE Sushi Go Round** is a mobile-first web app for Taoyuan International Airport flight information. Designed for flight crew members to quickly check baggage carousel and departure gate info.

**Live Site:** https://tpe-eagle.github.io/tpe-sushi-go-round/

**Tech Stack:**
- **Frontend:** Vanilla JavaScript (ES module) + Bootstrap 5 + Vite 6
- **Styling:** SCSS/Sass with Bootstrap CSS variables
- **Testing:** Vitest (unit) + Playwright (E2E)
- **CI/CD:** GitHub Actions → GitHub Pages (Node 18)

## Essential Development Commands

### Setup
```bash
npm install
npx playwright install --with-deps  # For E2E tests
```

### Development
```bash
npm run dev       # Vite dev server (port 8080)
npm run build     # Production build → dist/
npm run preview   # Preview production build
```

### Testing
```bash
npm run test:run          # Unit tests (single run)
npm run test              # Unit tests (watch mode)
npm run test:e2e:local    # Local E2E (max parallelism, chromium only)
npm run test:e2e:prod     # Production E2E (live site, multi-browser)
```

## Architecture Overview

### Key Files
| File | Purpose |
|------|---------|
| `main.js` | Application logic: data fetching, filtering, display, i18n, theme, events |
| `style.scss` | All styling with CSS variables, responsive breakpoints, animations |
| `index.html` | SPA entry point with meta tags, CSP, preloads, deferred GTM |
| `src/utils/flightUtils.js` | Shared utility functions (used by both app and tests) |
| `e2e/test-helpers.js` | E2E utilities: smart API caching, GA blocking, mock data |

### Data Flow
1. `fetchData()` — POST to Taoyuan Airport API, fetches **full day** of flights
2. Sort by airline code → flight number (numeric ascending)
3. `filterSupportedAirlines()` — Keep only BR/CI/JX, exclude cancelled flights
4. `filterFlightsByTime()` — Client-side time window filtering
5. `generateAirlineLinks()` → `displayFlights()` — Render to DOM

### Global State
```javascript
let flightData = [];              // All filtered flights for current mode
let currentFilteredFlights = [];  // User-filtered subset (by airline/flight number)
let currentLanguage = 'zh';       // 'zh' | 'en' | 'jp'
let currentACode = null;          // Selected airline filter (null = all)
let currentTheme = 'light';       // 'light' | 'dark'
let currentFlightMode = 'A';     // 'A' (Arrival) | 'D' (Departure)
```

### API Integration
- **Endpoint:** `https://www.taoyuan-airport.com/api/api/flight/a_flight` (POST)
- **Critical:** Always send `OTimeOpen: null, OTimeClose: null` — fetch full day data, filter client-side
- **Language mapping:** `zh` → `ch` for API `language` field; `en` and `jp` sent as-is
- **Accept-Language header:** `zh-TW`, `ja-JP`, or `en-US` based on `currentLanguage`
- **Client caching:** localStorage with 2-minute expiry, max 5 entries, disabled on localhost

### Time Window Logic
- **Arrival (A):** Round current time down to 10-min interval, offset -40 min, 120 min duration
- **Departure (D):** Round current time down to 10-min interval, offset 0 min, 120 min duration
- Flight included if **either** scheduled time (ODateTime) **or** actual time (RDateTime) is within range
- All times are UTC+8 (Taipei time)

### Cookie Persistence
- `ACode` — Selected airline filter (7-day expiry)
- `theme` — Light/dark preference (7-day expiry); falls back to system `prefers-color-scheme`
- Language is **not** persisted — detected from `navigator.language` on each load

### Responsive Design
- **Breakpoint:** 768px (`isSmallScreen()`)
- Mobile: abbreviated table headers, city codes instead of names, smaller airline logos
- Desktop: full headers, city names, standard logos
- Events: `resize` and `orientationchange` trigger re-render

### i18n System
- Three languages: `zh` (Traditional Chinese), `en` (English), `jp` (Japanese)
- Dynamic Google Font loading: Noto Sans TC / default / JP
- Translations object covers: titles, descriptions, error messages, table headers
- Meta tags (OG, Twitter) updated on language switch

## Key Design Decisions

**Never set time range in API requests.** The API must receive `OTimeOpen: null, OTimeClose: null`. Client-side `filterFlightsByTime()` handles filtering. This was the fix for BR35 bug: scheduled time 05:05 outside window, actual time 05:39 inside window — with server-side filtering, flight was missing.

**E2E smart API caching.** First E2E test makes a real API call and caches the response for 30 minutes. Subsequent tests reuse cached data with language transformations. Falls back to mock data if real API fails. Prevents excessive load on the airport API.

**Block Google Analytics in E2E tests.** All E2E test setup calls `blockGoogleAnalytics()` to block requests to googletagmanager.com, google-analytics.com, etc.

**Shared utility module.** `src/utils/flightUtils.js` exports the core logic functions (`filterFlightsByTime`, `filterSupportedAirlines`, `createApiPostData`, `parseApiResponse`, etc.) so unit tests exercise the same code paths as the app.

## CI/CD Pipeline

**Workflow:** `.github/workflows/ci.yml`

| Job | Trigger | Description |
|-----|---------|-------------|
| `unit-tests` | push/PR to main | Run `npm run test:run` |
| `e2e-tests-local` | after unit-tests | Playwright + Tailscale VPN (exit nodes: msi/tsa/mini) |
| `deploy` | push to main | `npm run build` → GitHub Pages |
| `e2e-tests-production` | after deploy | Test live site with real/cached API data |

- E2E tests require **Tailscale VPN** with Taiwan exit node for API access
- E2E jobs are `continue-on-error: true` (non-blocking)
- Secrets: `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`

## Testing Architecture

### Unit Tests (`src/test/`)
- `api.test.js` — API post data creation, time window calculation, flight filtering, BR35 regression
- `cache.test.js` — localStorage caching lifecycle, expiry, cleanup, quota exceeded handling
- `etag-integration.test.js` — ETag/304 support (integration tests, run with `NODE_ENV=integration`)
- `setup.js` — Global mocks for fetch, matchMedia, localStorage, console

### E2E Tests (`e2e/`)
- `api-integration.spec.js` — API parameter validation, flight data display, mode switching
- `language-detection.spec.js` — Browser language detection, manual switching, all 3 languages
- `user-interaction.spec.js` — Airline filtering, theme toggle, cookie persistence, responsive layout
- `production.spec.js` — Live site validation with smart API caching

### Playwright Configs
- **Local** (`playwright.local.config.js`): Chromium only, `os.cpus().length` workers, 10s timeout
- **CI**: 2 workers, headless
- **Production** (`playwright.prod.config.js`): Chromium + Mobile Chrome + Mobile Safari, tests live site

## AI Development Workflow

### Before making any change
1. Run unit tests and confirm they pass:
   ```bash
   npm run test:run
   ```
2. Read this file to understand the area being changed.

### After making changes
1. Run unit tests again and confirm all pass.
2. If any test fails, fix the production code first. Do not modify tests without user approval.
3. Run `npm run build` to verify the build succeeds.

### When uncertain
- Do not guess at API response format — check test fixtures or make a real request.
- All times are UTC+8 (Taipei time) — watch for timezone issues in tests.
- Adding new airlines requires updating `AIRLINE_CODES` in both `main.js` and `src/utils/flightUtils.js`, plus CSS styles.
- The `filterFlightsByTime()` in `main.js` and `flightUtils.js` must stay in sync.
