import './style.scss'

// Constants
const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight';
const AIRLINE_CODES = ['BR', 'CI', 'JX'];
const AIRLINE_GROUPS = {
    'BR': ['BR', 'B7'],
    'CI': ['CI', 'AE'],
    'JX': ['JX']
};
const DEFAULT_LANGUAGE = 'zh';
const COOKIE_NAME = 'ACode';
const PLANE_TYPE_COOKIE_NAME = 'PlaneType';
const REFRESH_DELAY = 1500;
const THEME_COOKIE_NAME = 'theme';
const LIGHT_THEME_COLOR = '#ffffff';
const DARK_THEME_COLOR = '#212529';

// Font URL
const FONT_BASE_URL = "https://fonts.googleapis.com/css2?family=Noto+Sans";
const FONT_WEIGHTS = ":wght@100..900&display=swap";
const FONT_FAMILIES = {
    default: "",
    zh: "+TC",
    jp: "+JP"
};

// Map the internal language key to a standards-compliant BCP 47 tag (used on
// <html lang>) and an Open Graph locale. `jp` is our internal shorthand; the
// correct IETF / OG code is `ja` / `ja_JP`.
const HTML_LANG_TAG = {
    zh: 'zh-Hant',
    en: 'en',
    jp: 'ja'
};
const OG_LOCALE = {
    zh: 'zh_TW',
    en: 'en_US',
    jp: 'ja_JP'
};

// Global variables
let flightData = [];
let currentFilteredFlights = [];
let currentLanguage = DEFAULT_LANGUAGE;
let currentACode = null;
let currentPlaneType = null;
let initialPinsRestored = false; // Guards the one-shot cookie restore in processFetchedData
let currentTheme = 'light'; // Default to light mode
let currentFlightMode = 'A'; // 'A' for Arrival, 'D' for Departure

// Issue #33 — same-day return-leg pairing (Departures mode only).
// null = not fetched yet for the current fetchData() cycle (5th column
// renders blank while pending); array (possibly empty) = fetch resolved.
let returnLegArrivals = null;
// Incremented on every fetchData() call; the async return-leg fetch only
// applies its result if its captured token still matches, so a slow
// AState=A fetch can't clobber the UI after the user has moved on (mode
// toggle, language change, another refresh).
let returnLegFetchToken = 0;
// Set to the token value once the PRIMARY (departures/arrivals) fetch has
// rendered at least once for that token. Guards fetchReturnLegArrivals()'s
// applyResult() from calling renderFilteredView() while flightData still
// holds the previous mode's records — without this, a return-leg fetch that
// resolves before the primary fetch (same fetchData() cycle) would render
// the new mode's headers/columns against stale flightData.
let mainDataReadyForToken = -1;

// Translations
const translations = {
    "zh": {
        "arrivalTitle": "台北迴轉壽司🍣",
        "departureTitle": "台北出發便🛫🌏",
        "description": "用手機快速幫你查桃園機場行李轉盤，讓咱們空勤組員快速下班！",
        "departureDescription": "出發不迷路，用手機快速掌握桃園機場出發航班！🛫",
        "noFlights": "沒有找到符合條件的航班。",
        "allFlights": "全部航班",
        "allFlightsShort": "ALL",
        "loading": "資料載入中...🧳",
        "refreshing": "🔄 正在重新整理...",
        "releaseToRefresh": "放開以重新整理",
        "error": "查詢失敗，請稍後再試。",
        "flightsInWindow": "時段內 {aname} 共 {n} 班",
        "currentFilter": "目前過濾條件：機型 {type}",
        "noMatch": "此條件下無符合航班",
        "clearAircraftType": "清除機型",
        "airlineNoFlights": "時段內 {acode} 無航班",
        "offlineBanner": "目前離線，顯示 {min} 分鐘前的快取資料",
        "offlineFresh": "目前離線",
        "offlineNoCache": "目前離線，且無可用快取。請連上網路後重試。",
        "tableHeaders": {
            "FlightNumber": "航班編號",
            "FlightNumberShort": "航班",
            "Departure": "出發地",
            "DepartureShort": "出發地",
            "Destination": "目的地",
            "DestinationShort": "目的地",
            "Terminal": "航廈",
            "TerminalShort": "航廈",
            "Gate": "登機門",
            "Carousel": "行李轉盤",
            "CarouselShort": "轉盤",
            "ReturnGate": "回程登機門",
            "ReturnGateShort": "回程門"
        }
    },
    "en": {
        "arrivalTitle": "台北回転寿司🍣",
        "departureTitle": "台北出発便🛫🌏",
        "description": "Airport screens too small? Don't sweat it – just use your phone to find your bags like a boss. 😎",
        "departureDescription": "Depart smart from Taipei – all flight info at your fingertips! 🛫",
        "noFlights": "No matching flights found.",
        "allFlights": "All Flights",
        "allFlightsShort": "ALL",
        "loading": "Data loading...🧳",
        "refreshing": "🔄 Refreshing...",
        "releaseToRefresh": "Release to refresh",
        "error": "Query failed, please try again later.",
        "flightsInWindow": "{n} {aname} flight(s) in this time window",
        "currentFilter": "Current filter: Aircraft type {type}",
        "noMatch": "No flights match this filter",
        "clearAircraftType": "Clear aircraft type",
        "airlineNoFlights": "No {acode} flights in this time window",
        "offlineBanner": "Offline — showing data from {min} min ago",
        "offlineFresh": "Offline",
        "offlineNoCache": "Offline with no cached data. Please reconnect and retry.",
        "tableHeaders": {
            "FlightNumber": "Flight Number",
            "FlightNumberShort": "Flt. No",
            "Departure": "Departure",
            "DepartureShort": "Dep.",
            "Destination": "Destination",
            "DestinationShort": "Dest.",
            "Terminal": "Terminal",
            "TerminalShort": "Term.",
            "Gate": "Gate",
            "Carousel": "Carousel",
            "CarouselShort": "Carousel",
            "ReturnGate": "Return Gate",
            "ReturnGateShort": "Return"
        }
    },
    "jp": {
        "arrivalTitle": "台北回転寿司🍣",
        "departureTitle": "台北出発便🛫🌏",
        "description": "携帯電話で桃園空港の荷物回転台をすばやく確認し、空勤組員を早く解放します！",
        "departureDescription": "台北発便をすばやくチェック！🛫 携帯ですぐ確認！",
        "noFlights": "一致するフライトが見つかりません。",
        "allFlights": "全フライト",
        "allFlightsShort": "ALL",
        "loading": "データを読み込み中...🧳",
        "refreshing": "🔄 再読み込み中...",
        "releaseToRefresh": "離して更新",
        "error": "クエリに失敗しました。後でもう一度やり直してください。",
        "flightsInWindow": "この時間帯の{aname}便は {n} 便",
        "currentFilter": "現在のフィルター：機種 {type}",
        "noMatch": "該当する便はありません",
        "clearAircraftType": "機種をクリア",
        "airlineNoFlights": "この時間帯に {acode} 便はありません",
        "offlineBanner": "オフライン中 — {min} 分前のキャッシュを表示",
        "offlineFresh": "オフライン中",
        "offlineNoCache": "オフラインで、利用可能なキャッシュもありません。再接続してお試しください。",
        "tableHeaders": {
            "FlightNumber": "フライト番号",
            "FlightNumberShort": "番号",
            "Departure": "出発地",
            "DepartureShort": "出発地",
            "Destination": "目的地",
            "DestinationShort": "目的地",
            "Terminal": "ターミナル",
            "TerminalShort": "ターミナル",
            "Gate": "ゲート",
            "Carousel": "荷物回転台",
            "CarouselShort": "回転台",
            "ReturnGate": "帰り便ゲート",
            "ReturnGateShort": "帰り"
        }
    }
};

function renderApp() {
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = `
        <div id="refresh-icon"></div>
        <div id="offline-banner" class="offline-banner" hidden></div>
        <div class="container position-relative">
            <div class="theme-buttons-container">
                <div id="theme-toggle" role="button" class="theme-toggle-btn" aria-label="Toggle theme" tabindex="0">🌙</div>
                <div id="flight-mode-toggle" role="button" class="flight-toggle-btn" aria-label="Toggle flight mode" tabindex="0">🛬</div>
            </div>
            <h1 id="title" class="text-center text-uppercase fw-bold my-4"></h1>
            <div id="airlineButtons" class="d-flex justify-content-center mb-2"></div>
            <div id="planeTypeButtons" class="d-flex justify-content-center flex-wrap mb-2"></div>
            <div id="flightButtons" class="d-flex justify-content-center flex-wrap"></div>
            <div id="output" class="container"></div>
            <div id="footer">
                <div class="lang-links d-flex justify-content-center mb-1">
                    <a href="#" data-lang="zh">🇹🇼 繁體中文</a> 
                    <span class="divider">|</span>
                    <a href="#" data-lang="en">🇬🇧 English</a> 
                    <span class="divider">|</span>
                    <a href="#" data-lang="jp">🇯🇵 にほんご</a>
                </div>
                <div class="footer-container">
                    <div class="footer-meta">
                        Data source: <a class="footer-link" href="https://www.taoyuan-airport.com/flight_arrival">Taoyuan International Airport</a>
                    </div>
                    <div id="apiParams" class="footer-meta"></div>
                    <div class="footer-meta">
                        Made by <span class="footer-brand">EVA</span> Pilot with <span class="footer-heart">❤️</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function updateElement(id, content) {
    const element = document.getElementById(id);
    if (element) element.innerText = content;
}

function updateMetaTag(selector, content) {
    const tag = document.querySelector(selector);
    if (tag) tag.setAttribute('content', content);
}

function updateLanguageText() {
    const titleKey = currentFlightMode === 'A' ? 'arrivalTitle' : 'departureTitle';
    const descriptionKey = currentFlightMode === 'A' ? "description" : "departureDescription";

    updateElement("refresh-icon", translations[currentLanguage]["refreshing"]);
    updateElement("title", translations[currentLanguage][titleKey]);

    const title = translations[currentLanguage][titleKey];
    const description = translations[currentLanguage][descriptionKey];

    document.title = title;
    updateMetaTag('meta[name="description"]', description);
    updateMetaTag('meta[property="og:title"]', title);
    updateMetaTag('meta[property="og:description"]', description);
    updateMetaTag('meta[property="og:locale"]', OG_LOCALE[currentLanguage] || OG_LOCALE.en);
    updateMetaTag('meta[name="twitter:title"]', title);
    updateMetaTag('meta[name="twitter:description"]', description);
    document.documentElement.lang = HTML_LANG_TAG[currentLanguage] || HTML_LANG_TAG.en;
}

function resetAnimation(element) {
    element.style.animation = 'none';
    element.offsetHeight; // force reflow
    element.style.animation = 'dropShadowAnimation 2s ease-out forwards';
}

function detectLanguage() {
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang.startsWith("zh")) {
        currentLanguage = 'zh';
    } else if (browserLang.startsWith("ja")) {
        currentLanguage = 'jp';
    } else {
        currentLanguage = 'en';
    }
    changeLanguageFont();
    updateLanguageText();
    fetchData();
    updateApiParams();
    updateLanguageLinks();
}

function changeLanguageFont() {
    const body = document.body;
    const fontFamily = FONT_FAMILIES[currentLanguage] || FONT_FAMILIES.default;
    const fontLink = `${FONT_BASE_URL}${fontFamily}${FONT_WEIGHTS}`;
    
    body.classList.remove('noto-sans', 'noto-sans-tc', 'noto-sans-jp');
    body.classList.add(`noto-sans${fontFamily.toLowerCase()}`);
    
    // Remove existing font link if it exists
    const existingLink = document.getElementById('dynamic-font');
    if (existingLink) {
        existingLink.remove();
    }

    // Create and append new link element with performance optimizations
    const linkElement = document.createElement('link');
    linkElement.id = 'dynamic-font';
    linkElement.rel = 'stylesheet';
    linkElement.href = fontLink;
    linkElement.media = 'print';
    linkElement.onload = function() { this.media = 'all'; };
    linkElement.fetchPriority = 'low';
    document.head.appendChild(linkElement);
}

function updateLanguageLinks() {
    // Add 'active' class to current language link
    document.querySelectorAll('.lang-links a').forEach(link => {
        if (link.getAttribute('data-lang') === currentLanguage) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

function changeLanguage(lang) {
    currentLanguage = lang;
    changeLanguageFont();
    updateLanguageText();
    fetchData();
    updateApiParams();
    document.getElementById("flightButtons").innerHTML = "";
    document.getElementById('planeTypeButtons').innerHTML = "";
    updateLanguageLinks();
}

function getUTC8Date() {
    const nowUTC = new Date();
    const utc8Time = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000);
    return utc8Time.toISOString().split('T')[0].replace(/-/g, '/');
}

/**
 * Formats a JavaScript Date object to a UTC+8 "HH:mm" string.
 * This helper function is used by updateApiParams to display time in UTC+8 for D-mode.
 * @param {Date} dateObj - The Date object to format.
 * @returns {string} Time in "HH:mm" format (UTC+8).
 */
function formatToUTC8_HHMM(dateObj) {
    // Create a new Date object whose UTC time is 8 hours ahead of the input dateObj's UTC time.
    // Then extract UTC hours/minutes from it, which corresponds to UTC+8's HH:MM for the original moment.
    const utc8EquivalentDate = new Date(dateObj.getTime() + (8 * 60 * 60 * 1000));
    const hours = utc8EquivalentDate.getUTCHours().toString().padStart(2, '0');
    const minutes = utc8EquivalentDate.getUTCMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

// Centralized business rule for time window config
function getTimeWindowConfig(mode) {
    if (mode === 'A') { // Arrival: User's original requirement
        return {
            roundingStepMinutes: 10,      // Round to nearest 10 minutes
            offsetFromRoundedMinutes: -40,  // Window starts 40 minutes BEFORE rounded time
            durationMinutes: 120            // Window is 120 minutes long
        };
    } else { // Departure (D): Matches current behavior post-revert
        return {
            roundingStepMinutes: 10,      // Round to nearest 10 minutes
            offsetFromRoundedMinutes: 0,    // Window starts AT the rounded time
            durationMinutes: 120            // Window is 120 minutes long
        };
    }
}

// Helper: Round down date to the nearest step (minutes)
function roundDownToStep(date, stepMinutes) {
    const rounded = new Date(date.getTime());
    const minutes = rounded.getMinutes();
    const roundedMinutes = Math.floor(minutes / stepMinutes) * stepMinutes;
    rounded.setMinutes(roundedMinutes, 0, 0);
    return rounded;
}

// Generic time window calculator
function getTimeWindow(config, initialNow = new Date()) { // initialNow is local by default
    const roundedLocalNow = roundDownToStep(initialNow, config.roundingStepMinutes); // Rounding local time
    
    const windowStart = new Date(roundedLocalNow.getTime() + (config.offsetFromRoundedMinutes * 60 * 1000)); // windowStart is local
    const windowEnd = new Date(windowStart.getTime() + (config.durationMinutes * 60 * 1000)); // windowEnd is local
    windowEnd.setSeconds(59, 999); // Make the window inclusive of the last minute
    return { windowStart, windowEnd };
}

function updateApiParams() {
    const dateStr = getUTC8Date(); // Date in YYYY/MM/DD (UTC+8)
    const config = getTimeWindowConfig(currentFlightMode);
    const { windowStart, windowEnd } = getTimeWindow(config);
    const startTimeStr = formatToUTC8_HHMM(windowStart);
    const endTimeStr = formatToUTC8_HHMM(windowEnd);

    const apiParamsText = `Date: ${dateStr}, Range: ${startTimeStr} - ${endTimeStr} (UTC+8)`;
    const apiParamsElement = document.getElementById("apiParams");
    if (apiParamsElement) {
        apiParamsElement.innerText = apiParamsText;
    }
}



function fetchData() {
    document.getElementById('airlineButtons').innerHTML = '';
    document.getElementById('planeTypeButtons').innerHTML = '';
    document.getElementById("flightButtons").innerHTML = '';
    document.getElementById("output").innerHTML = `
        <div class="blinking-text text-center">
            ${translations[currentLanguage]["loading"]}
        </div>
    `;

    // Issue #33 — kick off the return-leg arrivals fetch in parallel,
    // non-blocking. The departures table renders immediately with the 5th
    // column blank; fetchReturnLegArrivals() back-fills it when it resolves.
    // The token guards against a slow fetch applying stale results after the
    // user has toggled mode, changed language, or refreshed again.
    returnLegFetchToken += 1;
    const requestToken = returnLegFetchToken;
    returnLegArrivals = null;
    if (currentFlightMode === 'D') {
        fetchReturnLegArrivals(requestToken);
    }

    const postData = {
        "ODate": getUTC8Date(),
        "OTimeOpen": null,
        "OTimeClose": null,
        "BNO": null,
        "AState": currentFlightMode,
        "language": currentLanguage === "zh" ? "ch" : currentLanguage,
        "keyword": ""
    };

    // Keep OTimeOpen and OTimeClose as null to fetch all flights for the day
    // Client-side filtering will be applied later in filterFlightsByTime()
    // postData.OTimeOpen = null; (already set above)
    // postData.OTimeClose = null; (already set above)

    // Update UI display for the current time window (for display purposes only)
    const config = getTimeWindowConfig(currentFlightMode);
    const { windowStart, windowEnd } = getTimeWindow(config); 
    const dateStr = getUTC8Date(); 
    const startTimeStr = formatToUTC8_HHMM(windowStart);
    const endTimeStr = formatToUTC8_HHMM(windowEnd);
    const apiParamsText = `Date: ${dateStr}, Range: ${startTimeStr} - ${endTimeStr} (UTC+8)`;
    const apiParamsElement = document.getElementById("apiParams");
    if (apiParamsElement) {
        apiParamsElement.innerText = apiParamsText;
    }

    // localStorage is retained solely as an offline fallback. When online we
    // always hit the API so that gate / carousel changes surface immediately.
    const cacheKey = `flight_data_${JSON.stringify(postData)}`;
    const isTestEnvironment = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isTestEnvironment && !isOnline()) {
        const cachedData = getCachedFlightData(cacheKey);
        if (cachedData) {
            processFetchedData(cachedData.data);
            mainDataReadyForToken = requestToken;
            updateOfflineBanner(cachedData.timestamp);
            return;
        }
        // No cache and offline: fall through; the fetch will fail and the
        // offline-no-cache message will render.
    }

    const acceptLanguageHeader = currentLanguage === 'zh'
        ? 'zh-TW,zh;q=0.9'
        : currentLanguage === 'jp'
            ? 'ja-JP,ja;q=0.9'
            : 'en-US,en;q=0.9';
    fetch(API_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": acceptLanguageHeader,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(postData),
    })
    .then(response => response.json())
    .then(data => {
        // Store for offline fallback only; never served while online.
        if (!isTestEnvironment) {
            setCachedFlightData(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
        }

        hideOfflineBanner();
        processFetchedData(data);
        mainDataReadyForToken = requestToken;
    })
    .catch(error => {
        // Offline without any cached data -> dedicated message.
        // Online but the request failed -> generic error. We intentionally do
        // NOT fall back to stale cache here: a working network connection with
        // a failed API call should not silently serve yesterday's carousels.
        if (!isOnline()) {
            document.getElementById("output").innerHTML =
                `<div class="empty-state text-center">${translations[currentLanguage]["offlineNoCache"]}</div>`;
            updateOfflineBanner(null);
        } else {
            document.getElementById("output").innerHTML =
                `<div class="empty-state text-center">${translations[currentLanguage]["error"]}</div>`;
        }
    });
}

// Issue #33 — full-day AState=A fetch used only to feed the departures
// return-leg-gate column. Deliberately silent on failure (no loading/error
// UI of its own): the 5th column simply stays blank, same as "no confident
// match". Reuses the same cache/offline policy as fetchData(); the cache key
// is naturally distinct from the departures entry because AState is part of
// the cached postData.
function fetchReturnLegArrivals(token) {
    const postData = {
        "ODate": getUTC8Date(),
        "OTimeOpen": null,
        "OTimeClose": null,
        "BNO": null,
        "AState": "A",
        "language": currentLanguage === "zh" ? "ch" : currentLanguage,
        "keyword": ""
    };

    const applyResult = (data) => {
        if (token !== returnLegFetchToken) return; // superseded — drop silently
        const allGroupCodes = Object.values(AIRLINE_GROUPS).flat();
        returnLegArrivals = data.filter(flight =>
            allGroupCodes.includes(flight.ACode) &&
            (!flight.Memo.toLowerCase().includes("取消") && !flight.Memo.toLowerCase().includes("cancelled"))
        );
        // Only re-render here if the primary fetch for this same token has
        // already rendered — otherwise flightData still holds the previous
        // mode's records and a render now would paint the new mode's
        // headers/columns against stale data. If the primary fetch hasn't
        // rendered yet, its own processFetchedData() -> renderFilteredView()
        // will pick up the now-populated returnLegArrivals when it runs.
        if (currentFlightMode === 'D' && mainDataReadyForToken === token) {
            renderFilteredView();
        }
    };

    const cacheKey = `flight_data_${JSON.stringify(postData)}`;
    const isTestEnvironment = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isTestEnvironment && !isOnline()) {
        const cachedData = getCachedFlightData(cacheKey);
        if (cachedData) applyResult(cachedData.data);
        return;
    }

    const acceptLanguageHeader = currentLanguage === 'zh'
        ? 'zh-TW,zh;q=0.9'
        : currentLanguage === 'jp'
            ? 'ja-JP,ja;q=0.9'
            : 'en-US,en;q=0.9';
    fetch(API_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": acceptLanguageHeader,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(postData),
    })
    .then(response => response.json())
    .then(data => {
        if (!isTestEnvironment) {
            setCachedFlightData(cacheKey, { data: data, timestamp: Date.now() });
        }
        applyResult(data);
    })
    .catch(() => {
        // Silent — the column just stays blank, same as "no confident match".
    });
}

function isOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

// Show or refresh the offline banner. Pass the cache timestamp so the user
// sees how stale the data is; pass null when no cache is available.
function updateOfflineBanner(cacheTimestamp) {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    if (isOnline()) {
        banner.hidden = true;
        banner.innerText = '';
        return;
    }
    const t = translations[currentLanguage];
    let msg;
    if (cacheTimestamp == null) {
        msg = t['offlineFresh'];
    } else {
        const ageMin = Math.max(0, Math.round((Date.now() - cacheTimestamp) / 60000));
        msg = ageMin === 0
            ? t['offlineFresh']
            : t['offlineBanner'].replace('{min}', ageMin);
    }
    banner.innerText = msg;
    banner.hidden = false;
}

function hideOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    banner.hidden = true;
    banner.innerText = '';
}

function processFetchedData(data) {
    data.sort((a, b) => {
        if (a.ACode < b.ACode) return -1;
        if (a.ACode > b.ACode) return 1;
        const flightNumberA = parseInt(a.FlightNo.match(/\d+/), 10);
        const flightNumberB = parseInt(b.FlightNo.match(/\d+/), 10);
        return flightNumberA - flightNumberB;
    });

    const allGroupCodes = Object.values(AIRLINE_GROUPS).flat();
    flightData = data.filter(flight =>
        allGroupCodes.includes(flight.ACode) &&
        (!flight.Memo.toLowerCase().includes("取消") && !flight.Memo.toLowerCase().includes("cancelled"))
    );

    // Skip time filtering in test environment for reliable E2E tests
    if (!(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        flightData = filterFlightsByTime(flightData);
    }
    generateAirlineLinks(flightData);

    // Restore pins from cookies once per page load. In-session refetches
    // (flight mode toggle, language switch, pull-to-refresh) preserve the
    // in-memory state. The pin also survives across sessions even if the
    // pinned family happens not to be flying right now: the empty-state
    // block renders with a "clear aircraft type" button and
    // generatePlaneTypeLinks always keeps the pinned family's button
    // visible, so the user can see and clear it deliberately.
    if (!initialPinsRestored) {
        currentACode = checkCookie(COOKIE_NAME) ? getCookie(COOKIE_NAME) : null;
        currentPlaneType = checkCookie(PLANE_TYPE_COOKIE_NAME) ? getCookie(PLANE_TYPE_COOKIE_NAME) : null;

        // Plane type only makes sense under an airline pin; clear the orphan.
        if (currentACode === null && currentPlaneType !== null) {
            currentPlaneType = null;
            deleteCookie(PLANE_TYPE_COOKIE_NAME);
        }

        initialPinsRestored = true;
    }

    renderFilteredView();

    const outputTable = document.querySelector('#output table');
    if (outputTable) {
        outputTable.classList.add('table-pop-up');
        setTimeout(() => {
            outputTable.classList.remove('table-pop-up');
        }, 500);
    }
}

function getCachedFlightData(key) {
    try {
        const cached = localStorage.getItem(key);
        return cached ? JSON.parse(cached) : null;
    } catch (error) {
        return null;
    }
}

function setCachedFlightData(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        // Clean up old cache entries (keep only last 5)
        cleanupOldCache();
    } catch (error) {
        // Handle storage quota exceeded
        cleanupOldCache();
        try {
            localStorage.setItem(key, JSON.stringify(data));
        } catch (retryError) {
            // If still fails, clear all flight cache
            clearFlightCache();
        }
    }
}

function cleanupOldCache() {
    try {
        const flightCacheKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('flight_data_')) {
                const cached = JSON.parse(localStorage.getItem(key));
                flightCacheKeys.push({ key, timestamp: cached.timestamp });
            }
        }
        
        // Sort by timestamp and remove oldest entries if more than 5
        flightCacheKeys.sort((a, b) => b.timestamp - a.timestamp);
        if (flightCacheKeys.length > 5) {
            for (let i = 5; i < flightCacheKeys.length; i++) {
                localStorage.removeItem(flightCacheKeys[i].key);
            }
        }
    } catch (error) {
        // If cleanup fails, clear all flight cache
        clearFlightCache();
    }
}

function clearFlightCache() {
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('flight_data_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        // Last resort: clear all localStorage
        localStorage.clear();
    }
}

function generateAirlineLinks(flights) {
    const airlines = {};
    flights.forEach(flight => {
        if (!airlines[flight.ACode]) {
            airlines[flight.ACode] = `${flight.AName} (${flight.ACode})`;
        }
    });

    const isMobile = isSmallScreen();
    const imageSize = isMobile ? 20 : 28;

    let linksHTML = `
        <a href="#" data-airline="" class="airline-link">
            <span style="font-size:${isMobile ? 16 : 20}px; width:${imageSize}px;">🛬</span>
            <span class="airline-full">${translations[currentLanguage]["allFlights"]}</span>
            <span class="airline-short">${translations[currentLanguage]["allFlightsShort"]}</span>
        </a>`;

    AIRLINE_CODES.forEach(code => {
        if (airlines[code]) {
            const logoUrl = `https://www.taoyuan-airport.com/uploads/airlogo/${code}.gif`;
            linksHTML += `
                <a href="#" data-airline="${code}" class="airline-link">
                    <img alt="${code} Logo" width="${imageSize}" height="${Math.floor(imageSize * 0.71)}" src="${logoUrl}">
                    <span class="airline-full">${airlines[code]}</span>
                    <span class="airline-short">${code}</span>
                </a>`;
        }
    });

    document.getElementById('airlineButtons').innerHTML = linksHTML;
}

function updateAirlineLinks() {
    // Add 'active' class to current airline link
    document.querySelectorAll('.airline-link').forEach(link => {
        const airlineCode = link.getAttribute('data-airline') || '';
        // Make sure the empty string (ALL) matches with null (no selection)
        const codeMatches = (airlineCode === '' && currentACode === null) || (airlineCode === currentACode);
        if (codeMatches) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// Apply a new airline pin. Switching airline always clears the plane type pin
// because families rarely carry over meaningfully (a 777 pilot at BR is not
// automatically a 777 pilot at CI).
function applyAirlineFilter(airlineCode) {
    currentACode = airlineCode;
    currentPlaneType = null;
    deleteCookie(PLANE_TYPE_COOKIE_NAME);

    if (airlineCode !== null) {
        setCookie(COOKIE_NAME, airlineCode);
    } else {
        deleteCookie(COOKIE_NAME);
    }

    renderFilteredView();
}

// Apply a new plane type pin. null clears the pin.
function applyPlaneTypeFilter(planeType) {
    currentPlaneType = planeType;
    if (planeType !== null) {
        setCookie(PLANE_TYPE_COOKIE_NAME, planeType);
    } else {
        deleteCookie(PLANE_TYPE_COOKIE_NAME);
    }
    renderFilteredView();
}

// Compute the filtered flight list from current pins and render the UI.
function renderFilteredView() {
    const airlineFiltered = applyAirlineScope(flightData, currentACode);

    if (currentACode !== null) {
        generatePlaneTypeLinks(airlineFiltered);
    } else {
        document.getElementById('planeTypeButtons').innerHTML = '';
    }

    currentFilteredFlights = filterByPlaneType(airlineFiltered, currentPlaneType);

    updateAirlineLinks();
    updatePlaneTypeLinks();

    if (currentFilteredFlights.length === 0) {
        renderEmptyState(airlineFiltered);
        document.getElementById('flightButtons').innerHTML = '';
    } else {
        if (currentACode !== null) {
            generateFlightNumberButtons(currentFilteredFlights);
        } else {
            document.getElementById('flightButtons').innerHTML = '';
        }
        displayFlights(currentFilteredFlights, currentACode);
    }
}

// Narrow flights to the selected airline group, or all when no pin is set.
function applyAirlineScope(flights, airlineCode) {
    if (airlineCode === null) return flights;
    const groupCodes = AIRLINE_GROUPS[airlineCode] || [airlineCode];
    return flights.filter(flight => groupCodes.includes(flight.ACode));
}

function renderEmptyState(airlineFilteredFlights) {
    const t = translations[currentLanguage];
    const output = document.getElementById('output');

    // No airline pin and zero flights in window.
    if (currentACode === null) {
        output.innerHTML = `<div class="empty-state text-center">${t['noFlights']}</div>`;
        return;
    }

    // Airline pin set but zero flights for that airline in the window.
    if (airlineFilteredFlights.length === 0) {
        const msg = t['airlineNoFlights'].replace('{acode}', currentACode);
        output.innerHTML = `<div class="empty-state text-center">${msg}</div>`;
        return;
    }

    // Airline + plane type pin set, no flights match the combination.
    // Tint the airline name and the pinned family in that airline's brand
    // colour so the two identifying pieces of the filter read as a pair at
    // a glance (e.g., "EVA Air" and "B787" both in EVA sage).
    const aname = airlineFilteredFlights[0].AName || currentACode;
    const tintClass = `airline-tint-${currentACode.toLowerCase()}`;
    const anameHtml = `<span class="${tintClass}">${escapeHtml(aname)}</span>`;
    const typeHtml = `<span class="${tintClass}">${escapeHtml(currentPlaneType || '')}</span>`;

    const line1 = t['flightsInWindow']
        .replace('{aname}', anameHtml)
        .replace('{n}', airlineFilteredFlights.length);
    const line2 = t['currentFilter'].replace('{type}', typeHtml);
    const line3 = t['noMatch'];
    const btn = t['clearAircraftType'];

    output.innerHTML = `
        <div class="empty-state text-center">
            <div class="empty-state-line">${line1}</div>
            <div class="empty-state-line empty-state-filter">${line2}</div>
            <div class="empty-state-line empty-state-reason">${line3}</div>
            <button type="button" class="btn btn-sm btn-outline-secondary clear-aircraft-type mt-2">${btn}</button>
        </div>`;
}

// Minimal HTML escape so API-provided strings can be interpolated into
// templates that already contain markup (the empty-state tint spans).
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[c]);
}

function generatePlaneTypeLinks(flights) {
    const container = document.getElementById('planeTypeButtons');
    const families = getAvailableFamilies(flights);

    // If the user has pinned a family that is not in the current list (e.g.,
    // they pinned B777 in Arrival mode and toggled to Departure, where the
    // current airline has no B777 flights), keep the button visible anyway
    // so they can see and clear their pin.
    if (currentPlaneType && !families.includes(currentPlaneType)) {
        families.push(currentPlaneType);
        families.sort();
    }

    if (families.length === 0) {
        container.innerHTML = '';
        return;
    }

    const airlineClass = currentACode ? currentACode.toLowerCase() : 'secondary';
    const btnClass = `btn-outline-${airlineClass}`;
    const sizeClass = isSmallScreen() ? 'btn-sm' : '';

    const allLabel = translations[currentLanguage]['allFlightsShort'];
    let html = `<a href="#" class="btn ${btnClass} ${sizeClass} btn-no-hover planetype-link m-1" data-planetype="">${allLabel}</a>`;
    for (const family of families) {
        html += `<a href="#" class="btn ${btnClass} ${sizeClass} btn-no-hover planetype-link m-1" data-planetype="${family}">${family}</a>`;
    }

    container.innerHTML = html;
}

function updatePlaneTypeLinks() {
    document.querySelectorAll('.planetype-link').forEach(link => {
        const family = link.getAttribute('data-planetype') || '';
        const matches = (family === '' && currentPlaneType === null) || (family === currentPlaneType);
        if (matches) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// Extract aircraft family (e.g., A321-271N -> A321). Returns null for TBD values.
// Must stay in sync with src/utils/flightUtils.js.
function extractPlaneFamily(planeNo) {
    if (!planeNo) return null;
    const trimmed = String(planeNo).trim();
    if (trimmed === '' || trimmed === '-') return null;
    const match = trimmed.match(/^([AB]\d{3})/);
    return match ? match[1] : null;
}

function getAvailableFamilies(flights) {
    const families = new Set();
    for (const flight of flights) {
        const family = extractPlaneFamily(flight.PlaneNo);
        if (family) families.add(family);
    }
    return Array.from(families).sort();
}

// TBD flights (unknown family) always pass so pilots do not miss their
// assignment before the fleet is confirmed.
function filterByPlaneType(flights, family) {
    if (!family) return flights;
    return flights.filter(flight => {
        const flightFamily = extractPlaneFamily(flight.PlaneNo);
        if (flightFamily === null) return true;
        return flightFamily === family;
    });
}

// Issue #33 — hand-maintained TPE block-time table. Must stay in sync with
// src/utils/blockTimes.js (see CLAUDE.md's "Shared utility module with
// inline duplication" convention — main.js re-implements shared logic
// inline instead of importing, so it stays a self-contained bundle).
//
// block_minutes(city) = great_circle_km(TPE, city) / 800 km/h + 30 min,
// rounded to the nearest 5 minutes. Distances computed from public airport
// coordinates (ourairports.com) on 2026-07-31, covering every city BR / B7 /
// CI / AE / JX served that day. Deliberately rough (one speed for every
// aircraft type, no wind/routing correction) — it only needs to separate
// "physically impossible same-day return" from "plausible round trip".
const BLOCK_TIME_MINUTES = {
    AMS: 740, AOJ: 220, BKK: 215, BNE: 535, CAN: 90, CDG: 765, CEB: 155,
    CGK: 315, CNX: 210, CRK: 115, CTS: 235, CTU: 165, DAD: 155, DFW: 960,
    DPS: 315, FRA: 730, FUK: 130, HAN: 150, HGH: 75, HIJ: 145, HKD: 225,
    HKG: 90, IAD: 980, IAH: 985, ICN: 140, JFK: 970, KIX: 160, KMJ: 125,
    KMQ: 175, KTI: 200, KUL: 275, LAX: 850, LHR: 765, MEL: 585, MFM: 95,
    MNL: 120, MUC: 725, MXP: 750, NGO: 170, NRT: 195, OKA: 80, ONT: 855,
    ORD: 930, PEK: 160, PEN: 265, PHX: 885, PQC: 215, PRG: 705, PUS: 130,
    PVG: 80, SDJ: 205, SEA: 760, SFO: 810, SGN: 195, SIN: 270, SYD: 575,
    SZX: 90, TAK: 150, UKB: 160, VIE: 705, XMN: 55, YVR: 750, YYZ: 935,
};
const TURNAROUND_MINUTES = 40;

function getMinPlausibleRoundTripMinutes(cityCode) {
    const block = BLOCK_TIME_MINUTES[cityCode];
    if (block == null) return null;
    return 2 * block + TURNAROUND_MINUTES;
}

function parseODateTime(record) {
    return new Date(`${record.ODate.replace(/\//g, '-')}T${record.OTime}+08:00`);
}

// Find the same-day return leg for a departure among a full-day arrivals
// list. See src/utils/blockTimes.js for the full rule writeup + rationale
// (multi-candidate tie-break, city gate, etc.) — kept identical here.
function findReturnLeg(departure, arrivals) {
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

/**
 * Filters flights based on a dynamic time window.
 * @param {Array} flights - The array of flight objects to filter.
 * @returns {Array} The filtered array of flight objects.
 */
function filterFlightsByTime(flights) {
    const now = new Date(); // Current local time, will be converted to Taipei time in getTimeWindow
    const config = getTimeWindowConfig(currentFlightMode);
    const { windowStart, windowEnd } = getTimeWindow(config, now);

    return flights.filter(flight => {
        // Parse flight's ODate/OTime and RDate/RTime as UTC+8 Date objects.
        // Maintaining the original parsing style from the user's provided code.
        const ODateTime = new Date(`${flight.ODate.replace(/\//g, '-') }T${flight.OTime}+08:00`);
        const RDateTime = flight.RDate && flight.RTime
            ? new Date(`${flight.RDate.replace(/\//g, '-') }T${flight.RTime}+08:00`)
            : null;

        // Check if either ODateTime or RDateTime falls within the calculated window [windowStart, windowEnd].
        const isODateTimeInRange = ODateTime && ODateTime >= windowStart && ODateTime <= windowEnd;
        const isRDateTimeInRange = RDateTime && RDateTime >= windowStart && RDateTime <= windowEnd;

        return isODateTimeInRange || isRDateTimeInRange;
    });
}

function generateFlightNumberButtons(flights) {
    flights.sort((a, b) => parseInt(a.FlightNo) - parseInt(b.FlightNo));

    const flightButtonContent = flights.map(flight => {
        const btnClass = `btn-outline-${flight.ACode.toLowerCase()}`;
        return `<a href="#" class="btn ${btnClass} ${isSmallScreen() ? 'btn-sm' : ''} btn-no-hover m-1" data-flight="${flight.FlightNo}" data-acode="${flight.ACode}">${flight.FlightNo}</a>`;
    }).join('');

    document.getElementById("flightButtons").innerHTML = flightButtonContent;
}

function filterFlightByNumber(flightNumber, ACode) {
    document.querySelectorAll("#flightButtons a").forEach(button => {
        button.classList.remove('active');
    });

    const activeButton = document.querySelector(`a[data-flight="${flightNumber}"][data-acode="${ACode}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }

    const filteredFlight = currentFilteredFlights.filter(flight => flight.FlightNo === flightNumber);
    displayFlights(filteredFlight, ACode);
}

function isSmallScreen() {
    return window.innerWidth <= 768;
}

// Issue #33 — departures-only 5th column content. Blank when there is no
// confident return-leg match (not yet fetched, long-haul, one-way, or no
// candidate survives the plausibility gate) or when the return leg has no
// gate assigned yet. Gate always wins the visible space (issue #33
// requirement); the flight number is a secondary line on desktop and a
// title tooltip on mobile so it never pushes the table into overflow.
function buildReturnGateCell(departureFlight, isSmall) {
    if (!returnLegArrivals) return '';
    const returnLeg = findReturnLeg(departureFlight, returnLegArrivals);
    if (!returnLeg || !returnLeg.Gate) return '';

    const returnFlightNo = `${returnLeg.ACode}${returnLeg.FlightNo}`.replace(/\s+/g, '');
    if (isSmall) {
        return `<span title="${escapeHtml(returnFlightNo)}">${escapeHtml(returnLeg.Gate)}</span>`;
    }
    return `${escapeHtml(returnLeg.Gate)}<br><span class="return-flight-no">${escapeHtml(returnFlightNo)}</span>`;
}

function displayFlights(flights, ACode) {
    hideRefreshIndicator();
    currentACode = ACode;
    updateAirlineLinks();

    const isSmall = isSmallScreen();
    const headers = translations[currentLanguage]["tableHeaders"];
    const flightNumberHeader = isSmall ? headers["FlightNumberShort"] : headers["FlightNumber"];
    const departureHeader = currentFlightMode === 'A'
    ? (isSmall ? headers["DepartureShort"] : headers["Departure"])
    : (isSmall ? headers["DestinationShort"] : headers["Destination"]);
    const terminalHeader = isSmall ? headers["TerminalShort"] : headers["Terminal"];
    const returnGateHeader = isSmall ? headers["ReturnGateShort"] : headers["ReturnGate"];

    let tableContent = `
    <table class="table table-sm table-striped table-borderless">
        <thead class="${ACode ? `table-${ACode.toLowerCase()}` : (currentTheme === 'dark' ? 'table-secondary' : 'table-dark')}">
            <tr>
                <th>${flightNumberHeader}</th>
                <th ${isSmall ? 'class="text-center"' : ''}>${departureHeader}</th>
                <th class="text-center">${terminalHeader}</th>
                <th class="text-center">${headers["Gate"]}</th>
                ${currentFlightMode === 'A' ? `<th class="text-center">${headers["Carousel"]}</th>` : ''}
                ${currentFlightMode === 'D' ? `<th class="text-center">${returnGateHeader}</th>` : ''}
            </tr>
        </thead>
        <tbody>`;

    flights.forEach(flight => {
        const cityDisplay = isSmall ? flight.CityCode : (currentLanguage === 'zh' ? flight.CityName : flight.CityEname);
        const terminalDisplay = flight.BNO ? `T${flight.BNO}` : '';
        const logoUrl = `https://www.taoyuan-airport.com/uploads/airlogo/${flight.ACode}.gif`;
        const displayFlightNo = `${flight.ACode}${flight.FlightNo}`.replace(/\s+/g, '');

        tableContent += `
            <tr>
                <td><img alt="" width="28" height="20" src="${logoUrl}">${displayFlightNo}</td>
                <td ${isSmall ? 'class="text-center"' : ''}>${cityDisplay}</td>
                <td class="text-center">${terminalDisplay}</td>
                <td class="text-center">${flight.Gate}</td>
                ${currentFlightMode === 'A' ? `<td class="text-center">${flight.StopCode}</td>` : ''}
                ${currentFlightMode === 'D' ? `<td class="text-center">${buildReturnGateCell(flight, isSmall)}</td>` : ''}
            </tr>`;
    });

    tableContent += `</tbody></table>`;

    document.getElementById("output").innerHTML = flights.length === 0
        ? `<div class="text-center">${translations[currentLanguage]["noFlights"]}</div>`
        : tableContent;
}

function setCookie(name, value, days = 400) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = `${name}=${value};${expires};path=/`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(";").shift();
}

function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

function checkCookie(name) {
    return !!getCookie(name);
}

function renewPins() {
    [COOKIE_NAME, PLANE_TYPE_COOKIE_NAME, THEME_COOKIE_NAME].forEach(name => {
        const value = getCookie(name);
        if (value !== undefined) setCookie(name, value);
    });
}

function setupEventListeners() {
    window.addEventListener('resize', () => {
        if (currentFilteredFlights.length > 0 && currentACode) {
            displayFlights(currentFilteredFlights, currentACode);
        }
    });

    window.addEventListener('orientationchange', () => {
        if (currentFilteredFlights.length > 0 && currentACode) {
            displayFlights(currentFilteredFlights, currentACode);
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Debounce reload to avoid excessive refreshes
            clearTimeout(window.reloadTimeout);
            window.reloadTimeout = setTimeout(() => {
                window.location.reload();
            }, 1000);
        }
    });

    // Listen for keyboard events to allow keyboard users to toggle theme with Enter or Space
    document.addEventListener('keydown', (event) => {
        const themeToggle = document.activeElement;
        if (themeToggle && themeToggle.id === 'theme-toggle' && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            toggleTheme();
        }
    });

    document.addEventListener('click', (event) => {
        const langLink = event.target.closest('[data-lang]');
        if (langLink) {
            event.preventDefault();
            const lang = langLink.getAttribute('data-lang');
            changeLanguage(lang);
        }

        const airlineLink = event.target.closest('a[data-airline]');
        if (airlineLink) {
            event.preventDefault();
            const airline = airlineLink.getAttribute('data-airline') || null;
            applyAirlineFilter(airline);
        }

        const planeTypeLink = event.target.closest('a[data-planetype]');
        if (planeTypeLink) {
            event.preventDefault();
            const family = planeTypeLink.getAttribute('data-planetype') || null;
            applyPlaneTypeFilter(family);
        }

        const clearAircraftBtn = event.target.closest('.clear-aircraft-type');
        if (clearAircraftBtn) {
            event.preventDefault();
            applyPlaneTypeFilter(null);
        }

        const flightLink = event.target.closest('a[data-flight]');
        if (flightLink) {
            event.preventDefault();
            const flightNumber = flightLink.getAttribute('data-flight');
            const ACode = flightLink.getAttribute('data-acode');
            filterFlightByNumber(flightNumber, ACode);
        }

        const themeToggle = event.target.closest('#theme-toggle');
        if (themeToggle) {
            event.preventDefault();
            toggleTheme();
        }
    });

    // Pull-to-refresh: the pill tracks the finger as the user pulls down.
    // Three visual states, driven by class + inline transform/opacity:
    //   - pulling (below threshold): fades in + slides down with the pull
    //   - .armed (at or past threshold): solid brand-coloured pill, "release to refresh"
    //   - .refreshing: locked in place while fetchData runs, subtle pulse
    let startY = 0;
    let isPulling = false;
    const refreshThreshold = 200;
    const refreshIcon = document.getElementById('refresh-icon');

    document.addEventListener('touchstart', (event) => {
        if (window.scrollY === 0) {
            startY = event.touches[0].clientY;
            isPulling = true;
        }
    });

    document.addEventListener('touchmove', (event) => {
        if (!isPulling) return;
        const currentY = event.touches[0].clientY;
        const distance = currentY - startY;

        if (distance <= 0) {
            hideRefreshIndicator();
            return;
        }

        const progress = Math.min(distance / refreshThreshold, 1);
        const offset = Math.min(distance * 0.4, 40);
        refreshIcon.style.opacity = String(progress);
        refreshIcon.style.transform = `translate(-50%, ${offset}px)`;

        if (distance >= refreshThreshold) {
            if (!refreshIcon.classList.contains('armed')) {
                refreshIcon.classList.add('armed');
                refreshIcon.innerText = translations[currentLanguage]['releaseToRefresh'];
            }
        } else if (refreshIcon.classList.contains('armed')) {
            refreshIcon.classList.remove('armed');
            refreshIcon.innerText = '🔄';
        } else if (!refreshIcon.innerText) {
            refreshIcon.innerText = '🔄';
        }
    });

    document.addEventListener('touchend', () => {
        if (isPulling && refreshIcon.classList.contains('armed')) {
            triggerRefresh();
        } else if (isPulling) {
            hideRefreshIndicator();
        }
        isPulling = false;
    });

    document.addEventListener('click', (event) => {
        const flightModeToggle = event.target.closest('#flight-mode-toggle');
        if (flightModeToggle) {
            event.preventDefault();
            toggleFlightMode();
        }
    });

    window.addEventListener('online', () => {
        hideOfflineBanner();
        fetchData();
    });
    window.addEventListener('offline', () => {
        updateOfflineBanner(null);
    });
}

function triggerRefresh() {
    const refreshIcon = document.getElementById('refresh-icon');
    refreshIcon.classList.remove('armed');
    refreshIcon.classList.add('refreshing');
    refreshIcon.style.opacity = '1';
    refreshIcon.style.transform = 'translate(-50%, 12px)';
    refreshIcon.innerText = translations[currentLanguage]['refreshing'];
    fetchData();
    setTimeout(hideRefreshIndicator, REFRESH_DELAY);
}

function hideRefreshIndicator() {
    const el = document.getElementById('refresh-icon');
    if (!el) return;
    el.classList.remove('armed', 'refreshing');
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -100%)';
}

// Initialize the application
// Theme management functions
// Initialize theme
function initTheme() {
    const savedTheme = checkCookie(THEME_COOKIE_NAME) ? getCookie(THEME_COOKIE_NAME) : null;
    if (!savedTheme) {
        const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');
        currentTheme = prefersDarkScheme.matches ? 'dark' : 'light';
    } else {
        currentTheme = savedTheme;
    }
    applyTheme(currentTheme);
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!checkCookie(THEME_COOKIE_NAME)) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

// Apply theme
function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    currentTheme = theme;
    updateThemeToggleButton();
    updateStatusBarTheme();
}

// Update status bar theme
function updateStatusBarTheme() {
    const themeColorMeta = document.getElementById('theme-color-meta');
    const statusBarMeta = document.getElementById('apple-status-bar-style');
    
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', currentTheme === 'light' ? LIGHT_THEME_COLOR : DARK_THEME_COLOR);
    }
    
    if (statusBarMeta) {
        statusBarMeta.setAttribute('content', currentTheme === 'light' ? 'default' : 'black-translucent');
    }
}

// Toggle theme
function toggleTheme() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    setCookie(THEME_COOKIE_NAME, newTheme);
    // Update airline and language links when theme changes
    updateAirlineLinks();
    updateLanguageLinks();
}

function toggleFlightMode() {
    currentFlightMode = currentFlightMode === 'A' ? 'D' : 'A';
    document.getElementById('flight-mode-toggle').innerText = currentFlightMode === 'A' ? '🛬' : '🛫';

    const titleKey = currentFlightMode === 'A' ? 'arrivalTitle' : 'departureTitle';
    updateElement('title', translations[currentLanguage][titleKey]);
    resetAnimation(document.getElementById('title'));

    fetchData();
    updateApiParams();
}

// Update theme toggle button
function updateThemeToggleButton() {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.innerHTML = currentTheme === 'light' ? '🌙' : '☀️';
        themeToggle.setAttribute('aria-label', currentTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
    }
}

function initApp() {
    renewPins();
    if (navigator.storage?.persist) navigator.storage.persist();
    renderApp();
    setupEventListeners();
    detectLanguage();
    initTheme();
    updateLanguageLinks();
    updateAirlineLinks();
}

// Run the app
initApp();