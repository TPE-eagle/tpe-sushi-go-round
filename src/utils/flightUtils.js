// Flight data processing utilities
// These functions are extracted from main.js for reuse in tests

export const AIRLINE_CODES = ['BR', 'CI', 'JX'];

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
 * Get time window configuration based on flight mode
 */
export function getTimeWindowConfig(mode) {
    if (mode === 'A') { // Arrival
        return {
            roundingStepMinutes: 10,
            offsetFromRoundedMinutes: -40,
            durationMinutes: 120
        };
    } else { // Departure
        return {
            roundingStepMinutes: 10,
            offsetFromRoundedMinutes: 0,
            durationMinutes: 120
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
 * Calculate time window based on configuration and current time
 */
export function getTimeWindow(config, initialNow = new Date()) {
    const roundedLocalNow = roundDownToStep(initialNow, config.roundingStepMinutes);
    
    const windowStart = new Date(roundedLocalNow.getTime() + (config.offsetFromRoundedMinutes * 60 * 1000));
    const windowEnd = new Date(windowStart.getTime() + (config.durationMinutes * 60 * 1000));
    windowEnd.setSeconds(59, 999);
    return { windowStart, windowEnd };
}

/**
 * Filter flights by time window
 */
export function filterFlightsByTime(flights, mode = 'A', now = new Date()) {
    const config = getTimeWindowConfig(mode);
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
    return flights.filter(flight =>
        AIRLINE_CODES.includes(flight.ACode) &&
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
 * Parse API response and apply all filtering logic
 */
export function parseApiResponse(apiData, flightMode = 'A', currentTime = new Date()) {
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
    const timeFilteredFlights = filterFlightsByTime(supportedFlights, flightMode, currentTime);

    return timeFilteredFlights;
}