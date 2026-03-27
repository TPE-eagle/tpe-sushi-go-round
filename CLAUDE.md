# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**TPE Sushi Go Round** is a mobile-first web app for Taoyuan International Airport flight information. Designed for flight crew members to quickly check baggage carousel and departure gate info.

**Live Site:** https://tpe-eagle.github.io/tpe-sushi-go-round/

**Tech Stack:**
- **Frontend:** Vanilla JavaScript + Bootstrap 5 + Vite (ES module)
- **Styling:** SCSS/Sass
- **Testing:** Vitest (unit) + Playwright (E2E)
- **CI/CD:** GitHub Actions → GitHub Pages

## Essential Development Commands

### Setup
```bash
npm install
npx playwright install  # For E2E tests
```

### Development
```bash
npm run dev       # Start Vite dev server (port 8080)
npm run build     # Production build → dist/
npm run preview   # Preview production build
```

### Testing
```bash
npm run test              # Unit tests (Vitest, watch mode)
npm run test:run          # Unit tests (single run)
npm run test:e2e:local    # Local E2E tests (max parallelism)
npm run test:e2e:prod     # Production E2E tests (includes live site validation)
```

## Architecture Overview

### Core Features
- Arrival/departure flights for three airlines: BR (EVA Air), CI (China Airlines), JX (Starlux)
- Dynamic time window filtering: 2-hour window based on current time
- Multi-language: Traditional Chinese / English / Japanese
- Light/Dark theme with cookie persistence
- Responsive mobile-first design

### Key Files
- `main.js` — Application logic (data fetching, filtering, display, i18n)
- `style.scss` — All styling
- `index.html` — Single-page entry point
- `src/utils/flightUtils.js` — Shared utility functions (used by both app and tests)
- `e2e/test-helpers.js` — E2E test utilities (smart API caching, GA blocking, mocks)

### Data Flow
1. `fetchData()` — POST to Taoyuan Airport API, fetches full day of flights
2. `filterFlightsByTime()` — Client-side time window filtering
3. Filter by airline (BR/CI/JX), exclude cancelled flights
4. `displayFlights()` — Render results to DOM

### API Integration
- **Endpoint:** `https://www.taoyuan-airport.com/api/api/flight/a_flight`
- **Critical:** Always send `OTimeOpen: null, OTimeClose: null` in API requests — fetch full day data, filter client-side

### Time Window Logic
- Arrival mode (A): Start 40 min before current time, 120 min duration
- Departure mode (D): Start at current time, 120 min duration
- Rounding: 10-minute intervals
- Filter matches if **either** scheduled time (ODateTime) **or** actual time (RDateTime) is within range

## Key Design Decisions

**Never set time range in API requests.** The API must receive `OTimeOpen: null, OTimeClose: null` to return all flights. Client-side `filterFlightsByTime()` handles the filtering. This was the fix for a critical bug where flights with actual times within range but scheduled times outside range were not displaying (BR35 incident).

**E2E smart API caching.** First test makes a real API call and caches the response for 30 minutes. Subsequent tests reuse cached data. Falls back to mock data if real API fails. This prevents excessive load on the airport API.

**Block Google Analytics in tests.** All E2E test setup calls `blockGoogleAnalytics()` to prevent test traffic from polluting analytics data.

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
- Do not guess at API response format. Check the test fixtures or make a real request.
- All times are UTC+8 (Taipei time) — pay attention to timezone in tests.
- Adding new airlines requires updating `AIRLINE_CODES` and CSS styles.
