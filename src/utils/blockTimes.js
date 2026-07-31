// Hand-maintained TPE block-time table (issue #33).
//
// block_minutes(city) = great_circle_km(TPE, city) / 800 km/h + 30 min,
// rounded to the nearest 5 minutes. Distances computed from public airport
// coordinates (ourairports.com) on 2026-07-31, covering every city BR / B7 /
// CI / AE / JX served that day. This is a deliberately rough estimate (one
// speed for every aircraft type, no wind/routing correction) — it only needs
// to be accurate enough to separate "physically impossible same-day return"
// from "plausible round trip", not to predict an actual block time. A pilot
// is welcome to correct any entry; this is a plain data file for that reason.
//
// Used by findReturnLeg() to reject same-day-departure/return pairings that
// share an adjacent flight number by coincidence but can't possibly be the
// same rotation (e.g. a flight to Los Angeles cannot depart TPE and have its
// return already land 5 hours later).
export const BLOCK_TIME_MINUTES = {
    AMS: 740, // Amsterdam Airport Schiphol, ~12.3h block
    AOJ: 220, // Aomori Airport, ~3.7h block
    BKK: 215, // Suvarnabhumi Airport, ~3.6h block
    BNE: 535, // Brisbane International Airport, ~8.9h block
    CAN: 90, // Guangzhou Baiyun International Airport, ~1.5h block
    CDG: 765, // Charles de Gaulle International Airport, ~12.8h block
    CEB: 155, // Mactan Cebu International Airport, ~2.6h block
    CGK: 315, // Soekarno-Hatta International Airport, ~5.2h block
    CNX: 210, // Chiang Mai International Airport, ~3.5h block
    CRK: 115, // Clark International Airport / Clark Air Base, ~1.9h block
    CTS: 235, // New Chitose Airport, ~3.9h block
    CTU: 165, // Chengdu Shuangliu International Airport, ~2.8h block
    DAD: 155, // Da Nang International Airport, ~2.6h block
    DFW: 960, // Dallas Fort Worth International Airport, ~16.0h block
    DPS: 315, // Denpasar I Gusti Ngurah Rai International Airport, ~5.2h block
    FRA: 730, // Frankfurt Main Airport, ~12.2h block
    FUK: 130, // Fukuoka Airport, ~2.2h block
    HAN: 150, // Noi Bai International Airport, ~2.5h block
    HGH: 75, // Hangzhou Xiaoshan International Airport, ~1.2h block
    HIJ: 145, // Hiroshima Airport, ~2.4h block
    HKD: 225, // Hakodate Airport, ~3.8h block
    HKG: 90, // Hong Kong International Airport, ~1.5h block
    IAD: 980, // Washington Dulles International Airport, ~16.3h block
    IAH: 985, // George Bush Intercontinental Airport, ~16.4h block
    ICN: 140, // Incheon International Airport, ~2.3h block
    JFK: 970, // John F. Kennedy International Airport, ~16.2h block
    KIX: 160, // Kansai International Airport, ~2.7h block
    KMJ: 125, // Kumamoto Airport, ~2.1h block
    KMQ: 175, // Komatsu Airport / JASDF Komatsu Air Base, ~2.9h block
    KTI: 200, // Techo International Airport, ~3.3h block
    KUL: 275, // Kuala Lumpur International Airport, ~4.6h block
    LAX: 850, // Los Angeles International Airport, ~14.2h block
    LHR: 765, // London Heathrow Airport, ~12.8h block
    MEL: 585, // Melbourne Airport, ~9.8h block
    MFM: 95, // Macau International Airport, ~1.6h block
    MNL: 120, // Ninoy Aquino International Airport, ~2.0h block
    MUC: 725, // Munich Airport, ~12.1h block
    MXP: 750, // Milan Malpensa International Airport, ~12.5h block
    NGO: 170, // Chubu Centrair International Airport, ~2.8h block
    NRT: 195, // Narita International Airport, ~3.2h block
    OKA: 80, // Naha International Airport, ~1.3h block
    ONT: 855, // Ontario International Airport, ~14.2h block
    ORD: 930, // Chicago O'Hare International Airport, ~15.5h block
    PEK: 160, // Beijing Capital International Airport, ~2.7h block
    PEN: 265, // Penang International Airport, ~4.4h block
    PHX: 885, // Phoenix Sky Harbor International Airport, ~14.8h block
    PQC: 215, // Phu Quoc International Airport, ~3.6h block
    PRG: 705, // Vaclav Havel Airport Prague, ~11.8h block
    PUS: 130, // Gimhae International Airport, ~2.2h block
    PVG: 80, // Shanghai Pudong International Airport, ~1.3h block
    SDJ: 205, // Sendai Airport, ~3.4h block
    SEA: 760, // Seattle-Tacoma International Airport, ~12.7h block
    SFO: 810, // San Francisco International Airport, ~13.5h block
    SGN: 195, // Tan Son Nhat International Airport, ~3.2h block
    SIN: 270, // Singapore Changi Airport, ~4.5h block
    SYD: 575, // Sydney Kingsford Smith International Airport, ~9.6h block
    SZX: 90, // Shenzhen Bao'an International Airport, ~1.5h block
    TAK: 150, // Takamatsu Airport, ~2.5h block
    UKB: 160, // Kobe Airport, ~2.7h block
    VIE: 705, // Vienna International Airport, ~11.8h block
    XMN: 55, // Xiamen Gaoqi International Airport, ~0.9h block
    YVR: 750, // Vancouver International Airport, ~12.5h block
    YYZ: 935, // Toronto Pearson International Airport, ~15.6h block
};

// Minimum ground turnaround before the same airframe could plausibly depart
// again. Flat constant per issue #33 — not varied by aircraft type or route.
export const TURNAROUND_MINUTES = 40;

/**
 * Minimum plausible same-day round-trip time (minutes) for a city, or null
 * when the city isn't in the table (unknown block time -> abstain, don't
 * guess a distance).
 */
export function getMinPlausibleRoundTripMinutes(cityCode) {
    const block = BLOCK_TIME_MINUTES[cityCode];
    if (block == null) return null;
    return 2 * block + TURNAROUND_MINUTES;
}

function parseODateTime(record) {
    return new Date(`${record.ODate.replace(/\//g, '-')}T${record.OTime}+08:00`);
}

/**
 * Find the same-day return leg for a departure, among a full-day list of
 * arrivals (not time-window-filtered — the return leg's gate may already be
 * published well before the display window reaches it).
 *
 * Matching rule (issue #33):
 *   - same ACode
 *   - same CityCode (arrival's origin == departure's destination)
 *   - same ODate as the departure's own record (not "today")
 *   - arrival's scheduled time later than the departure's
 *   - |FlightNo(arrival) - FlightNo(departure)| == 1
 *   - gap >= 2 * blockTime(city) + TURNAROUND_MINUTES (rejects adjacency
 *     coincidences that are not physically plausible as the same rotation)
 *
 * A departure can have more than one flight-number-adjacent candidate on
 * dense same-city routes (both FlightNo-1 and FlightNo+1 exist). Every
 * candidate is gated independently; when more than one passes, the smallest
 * gap wins (closest-in-time is the most realistic minimal turnaround). This
 * function does not enforce global one-to-one exclusivity across different
 * departures — on rare dense routes the same arrival can be the best match
 * for two different departures.
 *
 * Returns the matched arrival record, or null when there is no confident
 * match (long-haul, one-way, unknown city, or nothing survives the gate).
 */
export function findReturnLeg(departure, arrivals) {
    const dFlightNo = parseInt(departure.FlightNo, 10);
    if (!Number.isFinite(dFlightNo)) return null;

    const minGapMinutes = getMinPlausibleRoundTripMinutes(departure.CityCode);
    if (minGapMinutes == null) return null;

    const dTime = parseODateTime(departure);

    let best = null;
    let bestGap = Infinity;
    for (const arrival of arrivals) {
        if (arrival.ACode !== departure.ACode) continue;
        if (arrival.CityCode !== departure.CityCode) continue;
        if (arrival.ODate !== departure.ODate) continue;
        const aFlightNo = parseInt(arrival.FlightNo, 10);
        if (!Number.isFinite(aFlightNo)) continue;
        if (Math.abs(aFlightNo - dFlightNo) !== 1) continue;

        const aTime = parseODateTime(arrival);
        if (!(aTime > dTime)) continue;

        const gapMinutes = (aTime - dTime) / 60000;
        if (gapMinutes < minGapMinutes) continue;

        if (gapMinutes < bestGap) {
            best = arrival;
            bestGap = gapMinutes;
        }
    }
    return best;
}
