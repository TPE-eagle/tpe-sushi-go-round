// Flight data processing utilities
// These functions are extracted from main.js for reuse in tests

export const AIRLINE_CODES = ['BR', 'CI', 'JX'];

// Subsidiary airlines grouped under parent companies
// B7 (UNI Air / 立榮航空) → BR (EVA Air / 長榮航空)
// AE (Mandarin Airlines / 華信航空) → CI (China Airlines / 中華航空)
export const AIRLINE_GROUPS = {
    'BR': ['BR', 'B7'],
    'CI': ['CI', 'AE'],
    'JX': ['JX']
};

// Airline codes with a vendored logo file in public/logos/ (issue #69).
// An ACode outside this set (new route, codeshare, API change) has no
// local file, so hasVendoredLogo() returning false renders with no logo
// image rather than a broken <img src>.
export const KNOWN_LOGO_CODES = ['BR', 'B7', 'CI', 'AE', 'JX'];

/**
 * Whether a vendored logo file exists locally for this airline code.
 */
export function hasVendoredLogo(code) {
    return KNOWN_LOGO_CODES.includes(code);
}

/**
 * Get UTC+8 date string in YYYY/MM/DD format
 */
export function getUTC8Date() {
    const nowUTC = new Date();
    const utc8Time = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000);
    return utc8Time.toISOString().split('T')[0].replace(/-/g, '/');
}

/**
 * Format Date object to UTC+8 HH:mm string
 */
export function formatToUTC8_HHMM(dateObj) {
    const utc8EquivalentDate = new Date(dateObj.getTime() + (8 * 60 * 60 * 1000));
    const hours = utc8EquivalentDate.getUTCHours().toString().padStart(2, '0');
    const minutes = utc8EquivalentDate.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

/**
 * Get time window configuration based on flight mode.
 * `forwardHours` (issue #88) is how many hours the window reaches forward
 * from its start; it replaces the old fixed `durationMinutes: 120` as the
 * single source of truth for window length (120 minutes == the historical
 * +2h). Default 2 keeps every existing 1-argument call at the old behavior.
 */
export function getTimeWindowConfig(mode, forwardHours = 2) {
    if (mode === 'A') { // Arrival
        return {
            roundingStepMinutes: 10,
            offsetFromRoundedMinutes: -40,
            forwardHours
        };
    } else { // Departure
        return {
            roundingStepMinutes: 10,
            offsetFromRoundedMinutes: 0,
            forwardHours
        };
    }
}

/**
 * Round down time to specified interval in minutes
 */
export function roundDownToStep(date, stepMinutes) {
    const rounded = new Date(date.getTime());
    const minutes = rounded.getMinutes();
    const roundedMinutes = Math.floor(minutes / stepMinutes) * stepMinutes;
    rounded.setMinutes(roundedMinutes, 0, 0);
    return rounded;
}

/**
 * Last millisecond (23:59:59.999) of the UTC+8 calendar day that `now`
 * falls in, as an absolute instant (issue #88). Taipei is a fixed +8
 * offset with no DST, so Taipei midnight is always UTC 16:00.
 */
export function endOfUTC8Day(now = new Date()) {
    const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return new Date(Date.UTC(
        utc8.getUTCFullYear(), utc8.getUTCMonth(), utc8.getUTCDate(),
        15, 59, 59, 999
    ));
}

/**
 * Calculate time window based on configuration and current time.
 * Issue #88: the forward edge is `forwardHours` past the window start,
 * truncated so the window never reaches past the end of `initialNow`'s own
 * UTC+8 day. The anchor is the day of `now`, not of `windowStart` — the
 * arrivals −40 min backward component legally places windowStart on the
 * previous day around Taipei midnight; truncation only ever bites
 * windowEnd, never windowStart.
 */
export function getTimeWindow(config, initialNow = new Date()) {
    const roundedLocalNow = roundDownToStep(initialNow, config.roundingStepMinutes);
    
    const windowStart = new Date(roundedLocalNow.getTime() + (config.offsetFromRoundedMinutes * 60 * 1000));
    const windowEnd = new Date(windowStart.getTime() + (config.forwardHours * 60 * 60 * 1000));
    windowEnd.setSeconds(59, 999);
    const endOfDay = endOfUTC8Day(initialNow); // Issue #88 — truncate at the end of now's UTC+8 day
    if (windowEnd > endOfDay) windowEnd.setTime(endOfDay.getTime());
    return { windowStart, windowEnd };
}

/**
 * Filter flights by time window
 */
export function filterFlightsByTime(flights, mode = 'A', now = new Date(), forwardHours = 2) {
    const config = getTimeWindowConfig(mode, forwardHours);
    const { windowStart, windowEnd } = getTimeWindow(config, now);

    return flights.filter(flight => {
        const ODateTime = new Date(`${flight.ODate.replace(/\//g, '-')}T${flight.OTime}+08:00`);
        const RDateTime = flight.RDate && flight.RTime
            ? new Date(`${flight.RDate.replace(/\//g, '-')}T${flight.RTime}+08:00`)
            : null;

        const isODateTimeInRange = ODateTime && ODateTime >= windowStart && ODateTime <= windowEnd;
        const isRDateTimeInRange = RDateTime && RDateTime >= windowStart && RDateTime <= windowEnd;

        return isODateTimeInRange || isRDateTimeInRange;
    });
}

/**
 * Filter supported airlines and exclude cancelled flights
 */
export function filterSupportedAirlines(flights) {
    const allCodes = Object.values(AIRLINE_GROUPS).flat();
    return flights.filter(flight =>
        allCodes.includes(flight.ACode) &&
        (!flight.Memo.toLowerCase().includes("取消") && !flight.Memo.toLowerCase().includes("cancelled"))
    );
}

/**
 * Create API request post data
 */
export function createApiPostData(flightMode, language) {
    return {
        "ODate": getUTC8Date(),
        "OTimeOpen": null,  // IMPORTANT: Keep null to fetch full day data
        "OTimeClose": null, // IMPORTANT: Keep null to fetch full day data
        "BNO": null,
        "AState": flightMode,
        "language": language === "zh" ? "ch" : language,
        "keyword": ""
    };
}

/**
 * Extract aircraft family from PlaneNo.
 * Examples: "A321-200" -> "A321", "B777-300ER" -> "B777", "A350-900" -> "A350".
 * Returns null for TBD values ("", "-", null, undefined) or unparseable strings.
 */
export function extractPlaneFamily(planeNo) {
    if (!planeNo) return null;
    const trimmed = String(planeNo).trim();
    if (trimmed === '' || trimmed === '-') return null;
    const match = trimmed.match(/^([AB]\d{3})/);
    return match ? match[1] : null;
}

/**
 * Collect the list of aircraft families present in the given flights,
 * sorted ascending. TBD flights contribute nothing.
 */
export function getAvailableFamilies(flights) {
    const families = new Set();
    for (const flight of flights) {
        const family = extractPlaneFamily(flight.PlaneNo);
        if (family) families.add(family);
    }
    return Array.from(families).sort();
}

/**
 * Filter flights by aircraft family. TBD flights (no resolvable family) always
 * pass so pilots do not miss their assignment before the fleet is confirmed.
 */
export function filterByPlaneType(flights, family) {
    if (!family) return flights;
    return flights.filter(flight => {
        const flightFamily = extractPlaneFamily(flight.PlaneNo);
        if (flightFamily === null) return true;
        return flightFamily === family;
    });
}

// ---------------------------------------------------------------------------
// Issue #130 — quick-dial flight-number search. Mirrored inline in main.js
// (same dual-copy convention as the functions above).

// Normalize user input: NFKC (full-width IME forms), uppercase, then strip
// everything outside A-Z 0-9. "ｂｒ－１７８", "br 178" and "Br178" all become
// "BR178".
export function normalizeFlightQuery(query) {
    return String(query ?? '')
        .normalize('NFKC')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

// Match the full-day search store against a raw query string.
//
// Rules (issue #130):
// - optional airline prefix resolved at GROUP level — "BR" covers B7, "CI"
//   covers AE — so BR681 finds a UNI Air flight (same semantics as the pin);
// - unknown airline prefixes ("UA178") match nothing;
// - digits match by PREFIX with leading zeros stripped; exact matches sort
//   FIRST, so a fully typed flight number always surfaces above vague hits
//   and the caller's display cap can never hide it;
// - rows from another operating day are excluded (full-day pulls may carry
//   them — see returnleg.test.js);
// - cancelled rows are NOT dropped here — the presentation layer flags them.
//
// Returns every match sorted; the caller applies the display cap.
export function matchFlights(flights, query, todayStr) {
    const q = normalizeFlightQuery(query);
    if (!q) return [];
    const allGroupCodes = Object.values(AIRLINE_GROUPS).flat();

    // Split an optional airline prefix from the digits. Check the first two
    // characters against the known codes first so "B7681" resolves to B7 +
    // 681 ("B" alone is not a code).
    let prefix = null;
    let rest = q;
    if (q.length >= 2 && allGroupCodes.includes(q.slice(0, 2))) {
        prefix = q.slice(0, 2);
        rest = q.slice(2);
    } else if (/^[A-Z]/.test(q)) {
        const letters = q.match(/^[A-Z]+/)[0];
        if (letters.length >= 2) return []; // a code we don't cover
        rest = q.slice(1); // single stray letter: ignore it, search the digits
    }
    const queryDigits = rest.replace(/[^0-9]/g, '').replace(/^0+/, '');
    if (!queryDigits && !prefix) return []; // nothing usable to match on
    const scope = prefix ? (Object.values(AIRLINE_GROUPS).find(g => g.includes(prefix)) ?? null) : null;

    const digitsOf = (flight) => {
        const m = String(flight.FlightNo ?? '').match(/\d+/);
        return (m ? m[0] : '').replace(/^0+/, '');
    };

    return flights
        .filter(flight => flight.ODate === todayStr)
        .filter(flight => !scope || scope.includes(flight.ACode))
        .filter(flight => !queryDigits || digitsOf(flight).startsWith(queryDigits))
        .sort((a, b) => {
            const score = (flight) => {
                const full = `${flight.ACode}${flight.FlightNo}`.replace(/\s+/g, '');
                if (full === q) return 0;
                if (queryDigits && digitsOf(flight) === queryDigits) return 1;
                return 2;
            };
            const diff = score(a) - score(b);
            if (diff !== 0) return diff;
            if (a.ACode !== b.ACode) return a.ACode < b.ACode ? -1 : 1;
            return (parseInt(digitsOf(a), 10) || 0) - (parseInt(digitsOf(b), 10) || 0);
        });
}

/**
 * Parse API response and apply all filtering logic
 */
export function parseApiResponse(apiData, flightMode = 'A', currentTime = new Date(), forwardHours = 2) {
    // 1. Sort flights
    const sortedFlights = apiData.sort((a, b) => {
        if (a.ACode < b.ACode) return -1;
        if (a.ACode > b.ACode) return 1;
        const flightNumberA = parseInt(a.FlightNo.match(/\d+/), 10);
        const flightNumberB = parseInt(b.FlightNo.match(/\d+/), 10);
        return flightNumberA - flightNumberB;
    });

    // 2. Filter supported airlines
    const supportedFlights = filterSupportedAirlines(sortedFlights);

    // 3. Filter by time
    const timeFilteredFlights = filterFlightsByTime(supportedFlights, flightMode, currentTime, forwardHours);

    return timeFilteredFlights;
}