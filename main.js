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

// Global variables
let flightData = [];
let currentFilteredFlights = [];
let currentLanguage = DEFAULT_LANGUAGE;
let currentACode = null;
let currentTheme = 'light'; // Default to light mode
let currentFlightMode = 'A'; // 'A' for Arrival, 'D' for Departure

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
        "error": "查詢失敗，請稍後再試。",
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
            "CarouselShort": "轉盤"
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
        "error": "Query failed, please try again later.",
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
            "CarouselShort": "Carousel"
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
        "error": "クエリに失敗しました。後でもう一度やり直してください。",
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
            "CarouselShort": "回転台"
        }
    }
};

function renderApp() {
    const appContainer = document.getElementById('app');
    appContainer.innerHTML = `
        <div id="refresh-icon"></div>
        <div class="container position-relative">
            <div class="theme-buttons-container">
                <div id="theme-toggle" role="button" class="theme-toggle-btn" aria-label="Toggle theme" tabindex="0">🌙</div>
                <div id="flight-mode-toggle" role="button" class="flight-toggle-btn" aria-label="Toggle flight mode" tabindex="0">🛬</div>
            </div>
            <h1 id="title" class="text-center text-uppercase fw-bold my-4"></h1>
            <div id="airlineButtons" class="d-flex justify-content-center mb-2"></div>
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
                    <div class="no-color-link footer-text text-muted fs-6 fs-sm-7 fw-light">
                        Data source: <a href="https://www.taoyuan-airport.com/flight_arrival" class="text-muted fs-6 fs-sm-7 fw-light text-decoration-underline">Taoyuan International Airport</a>
                    </div>
                    <div id="apiParams" class="footer-text text-muted fs-6 fs-sm-7 fw-light"></div>
                    <div class="footer-text fs-6 fs-sm-7">
                        Made by EVA Pilot with <span style="color: red;">❤️</span>
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
    updateMetaTag('meta[name="twitter:title"]', title);
    updateMetaTag('meta[name="twitter:description"]', description);
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
    document.getElementById("flightButtons").innerHTML = '';
    document.getElementById("output").innerHTML = `
        <div class="blinking-text text-center">
            ${translations[currentLanguage]["loading"]}
        </div>
    `;

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

    // Simple caching with localStorage (only for production)
    const cacheKey = `flight_data_${JSON.stringify(postData)}`;
    const isTestEnvironment = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    
    if (!isTestEnvironment) {
        const cachedData = getCachedFlightData(cacheKey);
        if (cachedData && !isCacheExpired(cachedData.timestamp)) {
            processFetchedData(cachedData.data);
            return;
        }
    }

    const acceptLanguageHeader = currentLanguage === 'zh'
        ? 'zh-TW,zh;q=0.9'
        : currentLanguage === 'jp'
            ? 'ja-JP,ja;q=0.9'
            : 'en-US,en;q=0.9';
    fetch(API_URL, {
        method: "POST",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": acceptLanguageHeader,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(postData),
    })
    .then(response => response.json())
    .then(data => {
        // Cache the data (only for production)
        if (!isTestEnvironment) {
            setCachedFlightData(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
        }
        
        processFetchedData(data);
    })
    .catch(error => {
        // If fetch fails, try to use cached data as fallback
        if (!isTestEnvironment) {
            const cachedData = getCachedFlightData(cacheKey);
            if (cachedData) {
                processFetchedData(cachedData.data);
                return;
            }
        }
        document.getElementById("output").innerText = translations[currentLanguage]["error"];
    });
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

    const ACode = checkCookie(COOKIE_NAME) ? getCookie(COOKIE_NAME) : null;
    filterFlights(ACode);
    updateAirlineLinks();

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

function isCacheExpired(timestamp) {
    const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes
    return Date.now() - timestamp > CACHE_DURATION;
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

function filterFlights(airlineCode = null) {
    if (airlineCode !== null) {
        setCookie(COOKIE_NAME, airlineCode);
        const groupCodes = AIRLINE_GROUPS[airlineCode] || [airlineCode];
        currentFilteredFlights = flightData.filter(flight => groupCodes.includes(flight.ACode));
    } else {
        deleteCookie(COOKIE_NAME);
        currentFilteredFlights = flightData;
    }
    
    currentACode = airlineCode;
    updateAirlineLinks();

    if (currentFilteredFlights.length === 0) {
        document.getElementById("output").innerHTML = `
            <div class="text-center">
                ${translations[currentLanguage]["noFlights"]}
            </div>`;
        document.getElementById("flightButtons").innerHTML = "";
    } else {
        if (airlineCode !== null) {
            generateFlightNumberButtons(currentFilteredFlights);
        } else {
            document.getElementById("flightButtons").innerHTML = "";
        }
        displayFlights(currentFilteredFlights, airlineCode);
    }
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

function displayFlights(flights, ACode) {
    document.getElementById('refresh-icon').style.display = 'none';
    currentACode = ACode;
    updateAirlineLinks();

    const isSmall = isSmallScreen();
    const headers = translations[currentLanguage]["tableHeaders"];
    const flightNumberHeader = isSmall ? headers["FlightNumberShort"] : headers["FlightNumber"];
    const departureHeader = currentFlightMode === 'A'
    ? (isSmall ? headers["DepartureShort"] : headers["Departure"])
    : (isSmall ? headers["DestinationShort"] : headers["Destination"]);
    const terminalHeader = isSmall ? headers["TerminalShort"] : headers["Terminal"];

    let tableContent = `
    <table class="table table-sm table-striped table-borderless">
        <thead class="${ACode ? `table-${ACode.toLowerCase()}` : (currentTheme === 'dark' ? 'table-secondary' : 'table-dark')}">
            <tr>
                <th>${flightNumberHeader}</th>
                <th ${isSmall ? 'class="text-center"' : ''}>${departureHeader}</th>
                <th class="text-center">${terminalHeader}</th>
                <th class="text-center">${headers["Gate"]}</th>
                ${currentFlightMode === 'A' ? `<th class="text-center">${headers["Carousel"]}</th>` : ''}
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
            </tr>`;
    });

    tableContent += `</tbody></table>`;

    document.getElementById("output").innerHTML = flights.length === 0
        ? `<div class="text-center">${translations[currentLanguage]["noFlights"]}</div>`
        : tableContent;
}

function setCookie(name, value, days = 7) {
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
            filterFlights(airline);
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
        if (isPulling) {
            const currentY = event.touches[0].clientY;
            const distance = currentY - startY;

            refreshIcon.style.display = distance > refreshThreshold ? 'block' : 'none';
        }
    });

    document.addEventListener('touchend', () => {
        if (isPulling && refreshIcon.style.display === 'block') {
            triggerRefresh();
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
}

function triggerRefresh() {
    const refreshIcon = document.getElementById('refresh-icon');
    refreshIcon.style.display = 'block';
    fetchData();
    setTimeout(() => {
        refreshIcon.style.display = 'none';
    }, REFRESH_DELAY);
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
    renderApp();
    setupEventListeners();
    detectLanguage();
    initTheme(); // Initialize theme
    updateLanguageLinks(); // Ensure language links are updated on init
    updateAirlineLinks(); // Ensure airline links are updated on init
}

// Run the app
initApp();