// SWR (stale-while-revalidate) cache policy — issue #141.
//
// Pure decision helpers, mirrored-in-use by main.js: the board paints from
// the localStorage cache first (any connectivity), while an online fetch
// revalidates in the background. Extracted here so the age gate has real
// unit coverage (src/test/swr.test.js) instead of only living inside the
// fetch flow.

// Cache entries older than this are only served offline. The cache key
// embeds ODate, so the window can never leak across the UTC+8 midnight
// rollover (a new day gets a new key and a cold load).
export const SWR_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

// Hard deadline for the airport API POST. Measured TTFB on the live API is
// ~3.4-4.3s with occasional Cloudflare 522s under load; 15s (the same
// budget e2e/production.spec.js grants the real API) aborts the request so
// the cached board and its staleness note take over instead of an endless
// spinner.
export const API_FETCH_TIMEOUT_MS = 15000;

// Decide whether a cached entry may paint the board before the network
// answers. Fresh (within the window) paints on any connection; beyond the
// window it is only served offline — matching the historical offline
// fallback contract, which accepted any age. A forced refresh never paints
// from cache (it exists to bypass it).
export function shouldPaintFromCache(cached, now, online, forceRefresh = false, maxAgeMs = SWR_MAX_AGE_MS) {
    if (!cached || forceRefresh) return false;
    const age = now - cached.timestamp;
    return age <= maxAgeMs || !online;
}

// Whole-minute age for user-facing "N min ago" labels. Never negative:
// clock skew or a future-dated timestamp reads as "just now".
export function cacheAgeMinutes(timestamp, now = Date.now()) {
    return Math.max(0, Math.round((now - timestamp) / 60000));
}
