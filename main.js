import './style.scss'

// Constants
const API_URL = 'https://www.taoyuan-airport.com/api/api/flight/a_flight';
const AIRLINE_CODES = ['BR', 'CI', 'JX'];
const DEFAULT_LANGUAGE = 'zh';
const COOKIE_NAME = 'ACode';
const REFRESH_DELAY = 1500;

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

// Translations
const translations = {
    "zh": {
        "title": "台北迴轉壽司🍣",
        "description": "用手機快速幫你查桃園機場行李轉盤，讓咱們空勤組員快速下班！",
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
            "Terminal": "航廈",
            "TerminalShort": "航廈",
            "Gate": "登機門",
            "Carousel": "行李轉盤",
            "CarouselShort": "轉盤"
        }
    },
    "en": {
        "title": "台北回転寿司🍣",
        "description": "Airport screens too small? Don't sweat it – just use your phone to find your bags like a boss. 😎",
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
            "Terminal": "Terminal",
            "TerminalShort": "Term.",
            "Gate": "Gate",
            "Carousel": "Carousel",
            "CarouselShort": "Carousel"
        }
    },
    "jp": {
        "title": "台北回転寿司🍣",
        "description": "携帯電話で桃園空港の荷物回転台をすばやく確認し、空勤組員を早く解放します！",
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
        <div class="container">
            <h1 id="title" class="text-center text-uppercase fw-bold my-4"></h1>
            <div id="airlineButtons" class="d-flex justify-content-center flex-wrap mb-3"></div>
            <div id="flightButtons" class="d-flex justify-content-center flex-wrap"></div>
            <div id="output" class="container"></div>
            <div id="footer">
                <div class="lang-switch no-color-link text-muted d-flex justify-content-center mb-2">
                    <a href="#" data-lang="zh">🇹🇼 繁體中文</a> |
                    <a href="#" data-lang="en">🇬🇧 English</a> |
                    <a href="#" data-lang="jp">🇯🇵 日本語</a>
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
    updateElement("refresh-icon", translations[currentLanguage]["refreshing"]);
    updateElement("title", translations[currentLanguage]["title"]);

    const title = translations[currentLanguage]["title"];
    const description = translations[currentLanguage]["description"];

    updateMetaTag('meta[property="og:title"]', title);
    updateMetaTag('meta[property="og:description"]', description);
    updateMetaTag('meta[name="twitter:title"]', title);
    updateMetaTag('meta[name="twitter:description"]', description);
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

    // Create and append new link element
    const linkElement = document.createElement('link');
    linkElement.id = 'dynamic-font';
    linkElement.rel = 'stylesheet';
    linkElement.href = fontLink;
    document.head.appendChild(linkElement);
}

function changeLanguage(lang) {
    currentLanguage = lang;
    changeLanguageFont();
    updateLanguageText();
    fetchData();
    updateApiParams();
    document.getElementById("flightButtons").innerHTML = "";
}

function getUTC8Date() {
    const nowUTC = new Date();
    const utc8Time = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000);
    return utc8Time.toISOString().split('T')[0].replace(/-/g, '/');
}

function getCurrentTimeRangeInUTC8() {
    const nowUTC = new Date();
    const utc8Time = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000);

    const minutes = utc8Time.getUTCMinutes();
    const hours = utc8Time.getUTCHours();

    const openHours = (minutes >= 0 && minutes <= 59) ? hours - 1 : hours;
    const OTimeOpen = `${openHours.toString().padStart(2, '0')}:00`;
    const OTimeClose = `${hours.toString().padStart(2, '0')}:59`;

    return { start: OTimeOpen, end: OTimeClose };
}

function updateApiParams() {
    const date = getUTC8Date();
    const timeRange = getCurrentTimeRangeInUTC8();
    if (timeRange) {
        const apiParamsText = `Date: ${date}, Range: ${timeRange.start} - ${timeRange.end}`;
        document.getElementById("apiParams").innerText = apiParamsText;
    } else {
        document.getElementById("apiParams").innerText = "No time range available";
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
        "AState": "A",
        "language": currentLanguage === "zh" ? "ch" : currentLanguage,
        "keyword": ""
    };

    fetch(API_URL, {
        method: "POST",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(postData),
    })
    .then(response => response.json())
    .then(data => {
        data.sort((a, b) => {
            if (a.ACode < b.ACode) return -1;
            if (a.ACode > b.ACode) return 1;
            const flightNumberA = parseInt(a.FlightNo.match(/\d+/), 10);
            const flightNumberB = parseInt(b.FlightNo.match(/\d+/), 10);
            return flightNumberA - flightNumberB;
        });

        flightData = data.filter(flight =>
            AIRLINE_CODES.includes(flight.ACode) &&
            (flight.Memo && !flight.Memo.toLowerCase().includes("取消") && !flight.Memo.toLowerCase().includes("cancelled"))
        );

        flightData = filterFlightsByTime(flightData);
        generateAirlineLinks(flightData);
        
        const ACode = checkCookie(COOKIE_NAME) ? getCookie(COOKIE_NAME) : null;
        filterFlights(ACode);

        // Add the table-pop-up class after data is loaded
        const outputTable = document.querySelector('#output table');
        if (outputTable) {
            outputTable.classList.add('table-pop-up');
            // Remove the class after animation completes
            setTimeout(() => {
                outputTable.classList.remove('table-pop-up');
            }, 500); // 500ms matches the animation duration in CSS
        }
    })
    .catch(error => {
        // console.error('Error:', error);
        document.getElementById("output").innerText = translations[currentLanguage]["error"];
    });
}

function generateAirlineLinks(flights) {
    const airlines = {};
    flights.forEach(flight => {
        if (!airlines[flight.ACode]) {
            airlines[flight.ACode] = `${flight.AName} (${flight.ACode})`;
        }
    });

    let linksHTML = `
        <a href="#" data-airline="" class="airline-link">
            <span style="font-size:20px; width:28px;">🛬</span>
            <span class="airline-full">${translations[currentLanguage]["allFlights"]}</span>
            <span class="airline-short">${translations[currentLanguage]["allFlightsShort"]}</span>
        </a>`;

    AIRLINE_CODES.forEach(code => {
        if (airlines[code]) {
            const logoUrl = `https://www.taoyuan-airport.com/uploads/airlogo/${code}.gif`;
            linksHTML += `
                <a href="#" data-airline="${code}" class="airline-link">
                    <img alt="${code} Logo" width="28" height="20" src="${logoUrl}">
                    <span class="airline-full">${airlines[code]}</span>
                    <span class="airline-short">${code}</span>
                </a>`;
        }
    });

    document.getElementById('airlineButtons').innerHTML = linksHTML;
}

function filterFlights(airlineCode = null) {
    if (airlineCode !== null) {
        setCookie(COOKIE_NAME, airlineCode);
        currentFilteredFlights = flightData.filter(flight => flight.ACode === airlineCode);
    } else {
        deleteCookie(COOKIE_NAME);
        currentFilteredFlights = flightData;
    }

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

function filterFlightsByTime(flights) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

    return flights.filter(flight => {
        const ODateTime = new Date(`${flight.ODate.replace(/\//g, '-')}T${flight.OTime}`);
        const RDateTime = flight.RDate && flight.RTime ? new Date(`${flight.RDate.replace(/\//g, '-')}T${flight.RTime}`) : null;

        return (ODateTime >= oneHourAgo && ODateTime <= oneHourLater) ||
            (RDateTime && RDateTime >= oneHourAgo && RDateTime <= oneHourLater);
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

    const isSmall = isSmallScreen();
    const headers = translations[currentLanguage]["tableHeaders"];
    const flightNumberHeader = isSmall ? headers["FlightNumberShort"] : headers["FlightNumber"];
    const departureHeader = isSmall ? headers["DepartureShort"] : headers["Departure"];
    const terminalHeader = isSmall ? headers["TerminalShort"] : headers["Terminal"];
    const carouselHeader = isSmall ? headers["CarouselShort"] : headers["Carousel"];

    const airlineClass = ACode ? `table-${ACode.toLowerCase()}` : 'table-dark';

    let tableContent = `
    <table class="table table-sm table-striped table-borderless">
        <thead class="${airlineClass}">
            <tr>
                <th>${flightNumberHeader}</th>
                <th ${isSmall ? 'class="text-center"' : ''}>${departureHeader}</th>
                <th class="text-center">${terminalHeader}</th>
                <th class="text-center">${headers["Gate"]}</th>
                <th class="text-center">${carouselHeader}</th>
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
                <td class="text-center">${flight.StopCode}</td>
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
            window.location.reload();
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
function initApp() {
    renderApp();
    setupEventListeners();
    detectLanguage();
}

// Run the app
initApp();
