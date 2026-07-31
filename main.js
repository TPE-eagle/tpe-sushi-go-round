import './style.scss'
// Standalone component import (no Popper dependency for offcanvas) — its
// side effect wires up `[data-bs-toggle="offcanvas"]` / `[data-bs-dismiss="offcanvas"]`
// click handling on `document` automatically; nothing else in this file
// depends on Bootstrap's JS today.
import 'bootstrap/js/dist/offcanvas'

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
const LANGUAGE_COOKIE_NAME = 'lang';
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

// About drawer — install prompt capture (issue #46). Non-null only between
// a captured `beforeinstallprompt` and either a resolved `.userChoice` or an
// `appinstalled` event; the drawer only ever shows a real Install button
// when this is set, never a button that does nothing on the current device.
let deferredInstallPrompt = null;

// Registered at module scope (not inside setupEventListeners(), which only
// runs after renderApp()) so a `beforeinstallprompt` firing before the app
// has rendered is still captured — updateInstallSection() itself guards
// against the drawer DOM not existing yet.
window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallSection();
});
window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallSection();
});

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
        },
        "drawer": {
            "aboutDrawerTitle": "關於",
            "closeLabel": "關閉",
            "whatItDoes": {
                "heading": "這個 App 可以幫你什麼",
                "body": [
                    "給長榮、華航、星宇（含立榮、華信）組員的桃園機場航班板。出發看登機門，到達看行李轉盤。",
                    "可以裝到手機主畫面當 App 用，不必經過 App Store。"
                ]
            },
            "opensOnArrival": {
                "heading": "打開就是到達",
                "body": [
                    "預設顯示到達（行李轉盤）—— 回來已經很累了，打開就看得到。",
                    "要看出發按右上角 🛫。出發時還有力氣，多按一顆沒關係。",
                    "這是唯一我們刻意不記住的選擇。"
                ]
            },
            "whichFlights": {
                "heading": "你會看到哪些班機",
                "body": [
                    "現在前後大約兩小時：出發往後兩小時，到達從 40 分鐘前算起。",
                    "最下面那行會寫出實際的日期和時間範圍。",
                    "每次載入都重抓最新資料。出發過了移民官，建議再開一次確認登機門。"
                ]
            },
            "install": {
                "heading": "裝成 App",
                "iosSteps": "iPhone／iPad（Safari）：分享 → 加入主畫面 → 新增",
                "iosFallback": "找不到「分享」就先點網址列旁的 ⋯；面板裡沒有「加入主畫面」，滑到底點「編輯動作」打開。",
                "installButtonLabel": "安裝",
                "offlineNote": "裝好之後沒網路也開得起來，會顯示上次的資料和時間。"
            },
            "share": {
                "heading": "分享給同事",
                "body": "按「分享」，會跳出你手機原本的分享面板。",
                "shareButtonLabel": "分享",
                "copyLinkLabel": "複製連結",
                "copiedConfirmation": "已複製連結"
            },
            "remembers": {
                "heading": "它記得你的選擇",
                "body": [
                    "航空公司、機型、主題、語言 —— 選過就記住，每開一次重新計時。",
                    "語言沒選過時跟著系統走。"
                ]
            },
            "returnGateColumn": {
                "heading": "出發板最右邊那一欄",
                "bodyBefore": "同一天回程班機回到桃園的到達登機門。",
                "bodyAfter": [
                    "只在符合條件時顯示，留白不代表沒有回程。以下不顯示：過夜班或長程、回程換機型（就不是同一組人）、班號或時間對不上。",
                    "當日來回是程式依我們設定的規則判斷，各家班型安排不同。",
                    "你對顯示邏輯有想法，非常歡迎告訴我。"
                ]
            },
            "feedback": {
                "heading": "覺得哪裡怪怪的",
                "body": [
                    "看到本人直接跟我說最快，想留紀錄就開 GitHub issue。",
                    "別貼班表細節或個資 —— 那邊是公開的。"
                ]
            }
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
        },
        "drawer": {
            "aboutDrawerTitle": "About",
            "closeLabel": "Close",
            "whatItDoes": {
                "heading": "What this app does for you",
                "body": [
                    "A Taoyuan Airport flight board for crew on EVA Air, China Airlines and STARLUX (including UNI Air and Mandarin). Departures show your gate, arrivals show your carousel.",
                    "You can install it to your home screen and use it like any other app — no App Store needed."
                ]
            },
            "opensOnArrival": {
                "heading": "It opens on arrivals",
                "body": [
                    "Arrivals — your baggage carousel — is what you see first. You're tired coming home; it should just be there.",
                    "For departures, tap 🛫 top right. You've got energy on the way out, one more tap is fine.",
                    "It's the one choice we deliberately don't remember."
                ]
            },
            "whichFlights": {
                "heading": "Which flights you'll see",
                "body": [
                    "Roughly two hours around now: departures two hours ahead, arrivals from 40 minutes ago.",
                    "The line under the table tells you the exact date and range.",
                    "Every load pulls fresh data. Once you're through immigration outbound, open it again and check your gate hasn't moved."
                ]
            },
            "install": {
                "heading": "Install it",
                "iosSteps": "iPhone / iPad (Safari): Share → Add to Home Screen → Add",
                "iosFallback": "Can't find Share? Tap ⋯ next to the address bar. No \"Add to Home Screen\" in the sheet? Scroll to the bottom and tap Edit Actions to switch it on.",
                "installButtonLabel": "Install",
                "offlineNote": "Once installed it opens without a connection, showing the last data it pulled and when."
            },
            "share": {
                "heading": "Share it with your colleagues",
                "body": "Tap Share — your phone's own share sheet opens.",
                "shareButtonLabel": "Share",
                "copyLinkLabel": "Copy link",
                "copiedConfirmation": "Link copied"
            },
            "remembers": {
                "heading": "It remembers what you picked",
                "body": [
                    "Airline, aircraft type, theme, language — picked once, kept, and the clock resets every time you open it.",
                    "Language follows your system until you choose one yourself."
                ]
            },
            "returnGateColumn": {
                "heading": "That last column on the departures board",
                "bodyBefore": "The arrival gate of the return leg, back at Taoyuan the same day.",
                "bodyAfter": [
                    "It only appears when the conditions are met, and blank doesn't mean there's no return. We don't show it when: it's a night stop or long haul, the return is a different aircraft type (so not the same crew), or the flight numbers or timings don't line up.",
                    "Same-day returns are worked out by rules we set, and every airline schedules differently.",
                    "If you've got a better idea about the logic, I'd really like to hear it."
                ]
            },
            "feedback": {
                "heading": "If something looks off",
                "body": [
                    "Easiest is to tell me in person; open a GitHub issue if you'd rather it were written down.",
                    "Please don't post roster details or personal information — that side is public."
                ]
            }
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
            "ReturnGate": "復路ゲート",
            "ReturnGateShort": "復路"
        },
        "drawer": {
            "aboutDrawerTitle": "このアプリについて",
            "closeLabel": "閉じる",
            "whatItDoes": {
                "heading": "このアプリでできること",
                "body": [
                    "エバー航空・チャイナエアライン・スターラックス航空（ユニー航空、マンダリン航空を含む）の乗務員向け、桃園空港のフライトボードです。出発は搭乗ゲート、到着は荷物回転台。",
                    "App Store を通さずに、ホーム画面に追加してアプリのように使えます。"
                ]
            },
            "opensOnArrival": {
                "heading": "開くと到着が出ます",
                "body": [
                    "最初に出るのは到着 ＝ 荷物回転台です。帰りは疲れています。開いてすぐ見えるべきだと思っています。",
                    "出発を見るときは右上の 🛫 を。行きはまだ元気なので、ひとつ多く押しても大丈夫です。",
                    "これだけは、あえて覚えないようにしています。"
                ]
            },
            "whichFlights": {
                "heading": "表示される便",
                "body": [
                    "現在の前後およそ2時間。出発は2時間先まで、到着は40分前から。",
                    "表の下の行に、実際の日付と時間帯が出ます。",
                    "開くたびに最新のデータを取り直します。出発時は出国審査を通ったあと、もう一度開いてゲートの変更をご確認ください。"
                ]
            },
            "install": {
                "heading": "インストール",
                "iosSteps": "iPhone / iPad（Safari）：共有 → ホーム画面に追加 → 追加",
                "iosFallback": "「共有」が見つからないときは、アドレスバー横の ⋯ をタップ。共有シートに「ホーム画面に追加」がないときは、一番下の「アクションを編集」から有効にしてください。",
                "installButtonLabel": "インストール",
                "offlineNote": "インストール後は通信がなくても開けます。最後に取得したデータと、その時刻を表示します。"
            },
            "share": {
                "heading": "同僚に教える",
                "body": "「共有」をタップすると、お使いのスマートフォンの共有画面が開きます。",
                "shareButtonLabel": "共有",
                "copyLinkLabel": "リンクをコピー",
                "copiedConfirmation": "リンクをコピーしました"
            },
            "remembers": {
                "heading": "選んだ設定は覚えています",
                "body": [
                    "航空会社・機材・テーマ・言語 — 一度選べばそのまま。開くたびに期限がリセットされます。",
                    "言語は、ご自身で選ぶまではシステム設定に従います。"
                ]
            },
            "returnGateColumn": {
                "heading": "出発ボードの一番右の列",
                "bodyBefore": "同じ日に桃園へ戻ってくる、帰り便の到着ゲートです。",
                "bodyAfter": [
                    "条件を満たしたときだけ表示されます。空欄は「帰り便がない」という意味ではありません。次の場合は表示しません：ステイや長距離線、帰り便の機材が違う（＝同じ乗務員ではない）、便名や時刻が合わない。",
                    "日帰りかどうかは私たちが決めた規則で判定しています。航空会社ごとにスケジュールの組み方は異なります。",
                    "表示の考え方について何かお気づきの点があれば、ぜひ教えてください。"
                ]
            },
            "feedback": {
                "heading": "おかしいと思ったら",
                "body": [
                    "本人に直接言っていただくのが一番早いです。記録に残したい場合は GitHub の issue をどうぞ。",
                    "乗務スケジュールの詳細や個人情報は書かないでください。公開されている場所です。"
                ]
            },
            "disclaimer": "※ この日本語は AI による自動翻訳です。作者は日本語が読めないため、不自然な表現が残っているかもしれません。おかしいと感じた箇所は英語版をご参照いただけますと幸いです。ご不便をおかけして、大変申し訳ございません。"
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
                <div id="about-drawer-toggle" role="button" class="flight-toggle-btn" aria-label="About" data-bs-toggle="offcanvas" data-bs-target="#about-drawer" aria-controls="about-drawer" tabindex="0">☰</div>
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
        <div class="offcanvas offcanvas-end" tabindex="-1" id="about-drawer" aria-labelledby="about-drawer-title">
            <div class="offcanvas-header">
                <h5 class="offcanvas-title" id="about-drawer-title"></h5>
                <button type="button" id="about-drawer-close" class="drawer-close-btn" data-bs-dismiss="offcanvas" aria-label="Close">✕</button>
            </div>
            <div class="offcanvas-body" id="about-drawer-body"></div>
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
    // An explicit prior choice always wins; auto-detection only applies when
    // no cookie is present (never persisted, so a phone/system-language
    // change is picked up again the next time the cookie is absent/cleared).
    if (checkCookie(LANGUAGE_COOKIE_NAME)) {
        currentLanguage = getCookie(LANGUAGE_COOKIE_NAME);
    } else {
        const browserLang = navigator.language || navigator.userLanguage;
        if (browserLang.startsWith("zh")) {
            currentLanguage = 'zh';
        } else if (browserLang.startsWith("ja")) {
            currentLanguage = 'jp';
        } else {
            currentLanguage = 'en';
        }
    }
    changeLanguageFont();
    updateLanguageText();
    fetchData();
    updateApiParams();
    updateLanguageLinks();
    updateDrawerText();
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
    // Only an explicit tap persists the choice — never the auto-detected
    // value, otherwise whatever navigator.language resolved to on the first
    // ever visit would be frozen forever (see detectLanguage()).
    setCookie(LANGUAGE_COOKIE_NAME, lang);
    changeLanguageFont();
    updateLanguageText();
    fetchData();
    updateApiParams();
    document.getElementById("flightButtons").innerHTML = "";
    document.getElementById('planeTypeButtons').innerHTML = "";
    updateLanguageLinks();
    updateDrawerText();
}

// ---------------------------------------------------------------------------
// About drawer (issue #46)
// ---------------------------------------------------------------------------

// Wraps each paragraph in the current language's <p>, so a multi-line copy
// block from `translations` renders as real paragraphs rather than raw \n.
function drawerParagraphs(lines) {
    return lines.map(line => `<p class="drawer-section-body">${line}</p>`).join('');
}

// Issue #33's return-gate column, reproduced as a real table row (not plain
// text) so the drawer's worked example is visually identical to the live
// feature. Values are the flight the issue itself specifies and are
// language-independent (flight/gate codes), only the headers are localized.
function buildDrawerExampleTable(lang) {
    const headers = translations[lang]["tableHeaders"];
    return `
        <table class="table table-sm table-striped table-borderless drawer-example-table">
            <thead class="table-br">
                <tr>
                    <th>${headers["FlightNumber"]}</th>
                    <th class="text-center">${headers["Destination"]}</th>
                    <th class="text-center">${headers["Terminal"]}</th>
                    <th class="text-center">${headers["Gate"]}</th>
                    <th class="text-center">${headers["ReturnGate"]}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><img alt="" width="28" height="20" src="https://www.taoyuan-airport.com/uploads/airlogo/BR.gif">BR178</td>
                    <td class="text-center">KIX</td>
                    <td class="text-center">T2</td>
                    <td class="text-center">C5</td>
                    <td class="text-center"><span class="return-gate-cell">←&nbsp;BR177&nbsp;C7</span></td>
                </tr>
            </tbody>
        </table>`;
}

// Builds the full offcanvas body for the given language. Re-run on every
// language change (drawer content is destroyed and rebuilt, same as the
// rest of the app's i18n approach) — updateInstallSection() must be called
// again afterwards since it targets elements this just recreated.
function buildDrawerContent(lang) {
    const d = translations[lang]["drawer"];
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const shareButtonLabel = canShare ? d.share.shareButtonLabel : d.share.copyLinkLabel;

    let html = '';

    html += `<section class="drawer-section"><h6 class="drawer-section-title">${d.whatItDoes.heading}</h6>${drawerParagraphs(d.whatItDoes.body)}</section>`;
    html += `<section class="drawer-section"><h6 class="drawer-section-title">${d.opensOnArrival.heading}</h6>${drawerParagraphs(d.opensOnArrival.body)}</section>`;
    html += `<section class="drawer-section"><h6 class="drawer-section-title">${d.whichFlights.heading}</h6>${drawerParagraphs(d.whichFlights.body)}</section>`;

    html += `
        <section class="drawer-section" id="drawer-install-section">
            <h6 class="drawer-section-title">${d.install.heading}</h6>
            <div id="drawer-install-ios">
                <p class="drawer-section-body">${d.install.iosSteps}</p>
                <p class="drawer-section-body drawer-fallback-note">${d.install.iosFallback}</p>
            </div>
            <div id="drawer-install-button-wrap">
                <button type="button" id="drawer-install-btn" class="btn btn-sm btn-outline-secondary">${d.install.installButtonLabel}</button>
            </div>
            <p class="drawer-section-body">${d.install.offlineNote}</p>
        </section>`;

    html += `
        <section class="drawer-section">
            <h6 class="drawer-section-title">${d.share.heading}</h6>
            <p class="drawer-section-body">${d.share.body}</p>
            <div class="drawer-share-row">
                <button type="button" id="drawer-share-btn" class="btn btn-sm btn-outline-secondary">${shareButtonLabel}</button>
                <span id="drawer-share-confirmation" class="drawer-inline-confirmation" hidden>${d.share.copiedConfirmation}</span>
            </div>
        </section>`;

    html += `<section class="drawer-section"><h6 class="drawer-section-title">${d.remembers.heading}</h6>${drawerParagraphs(d.remembers.body)}</section>`;

    html += `
        <section class="drawer-section">
            <h6 class="drawer-section-title">${d.returnGateColumn.heading}</h6>
            <p class="drawer-section-body">${d.returnGateColumn.bodyBefore}</p>
            ${buildDrawerExampleTable(lang)}
            ${drawerParagraphs(d.returnGateColumn.bodyAfter)}
        </section>`;

    html += `<section class="drawer-section"><h6 class="drawer-section-title">${d.feedback.heading}</h6>${drawerParagraphs(d.feedback.body)}</section>`;

    if (d.disclaimer) {
        html += `<p class="drawer-disclaimer">${d.disclaimer}</p>`;
    }

    return html;
}

// display-mode: standalone covers Android/desktop PWA installs;
// navigator.standalone is the legacy iOS Safari signal (never gets a
// display-mode media match). Checking both is what lets the install section
// hide itself once the app is already installed, on every platform that can
// install it.
function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Three states, checked in order: already installed (hide the section
// entirely) > beforeinstallprompt captured (show the real Install button,
// hide the iOS text) > neither (assume iOS Safari or a browser that will
// never fire the event; show the text steps, no button). Re-run after every
// drawer rebuild (language change) and every install-state transition
// (prompt captured, prompt resolved, appinstalled).
function updateInstallSection() {
    const section = document.getElementById('drawer-install-section');
    if (!section) return;

    if (isStandalone()) {
        section.hidden = true;
        return;
    }
    section.hidden = false;

    const iosBlock = document.getElementById('drawer-install-ios');
    const buttonWrap = document.getElementById('drawer-install-button-wrap');
    const showButton = Boolean(deferredInstallPrompt);
    if (iosBlock) iosBlock.hidden = showButton;
    if (buttonWrap) buttonWrap.hidden = !showButton;
}

function handleInstallButtonClick() {
    if (!deferredInstallPrompt) return;
    const promptEvent = deferredInstallPrompt;
    promptEvent.prompt();
    promptEvent.userChoice.finally(() => {
        deferredInstallPrompt = null;
        updateInstallSection();
    });
}

// navigator.share opens the OS share sheet (no per-locale copy to write or
// maintain); where it's unavailable the same button falls back to writing
// the URL to the clipboard and showing an inline confirmation — never
// alert().
function handleShareButtonClick() {
    const shareData = { title: document.title, url: window.location.href };
    if (typeof navigator.share === 'function') {
        // AbortError on user cancellation is expected and silent; the OS
        // share sheet itself already communicated the outcome.
        navigator.share(shareData).catch(() => {});
        return;
    }
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareData.url).then(showShareConfirmation).catch(() => {});
    }
}

function showShareConfirmation() {
    const el = document.getElementById('drawer-share-confirmation');
    if (!el) return;
    el.hidden = false;
    clearTimeout(showShareConfirmation.timer);
    showShareConfirmation.timer = setTimeout(() => {
        el.hidden = true;
    }, 2000);
}

function updateDrawerText() {
    const d = translations[currentLanguage]["drawer"];

    const toggleBtn = document.getElementById('about-drawer-toggle');
    if (toggleBtn) toggleBtn.setAttribute('aria-label', d.aboutDrawerTitle);

    const titleEl = document.getElementById('about-drawer-title');
    if (titleEl) titleEl.innerText = d.aboutDrawerTitle;

    const closeBtn = document.getElementById('about-drawer-close');
    if (closeBtn) closeBtn.setAttribute('aria-label', d.closeLabel);

    const bodyEl = document.getElementById('about-drawer-body');
    if (bodyEl) bodyEl.innerHTML = buildDrawerContent(currentLanguage);

    updateInstallSection();
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
    // column blank (or, if a previous cycle already populated it, the
    // previous value — see #40 item 1 below) until fetchReturnLegArrivals()
    // back-fills it. The token guards against a slow fetch applying stale
    // results after the user has toggled mode, changed language, or
    // refreshed again.
    //
    // #40 item 1: deliberately NOT resetting returnLegArrivals to null here.
    // Every fetchData() call used to blank it unconditionally, which
    // flickered the 5th column empty-then-full on every refresh, language
    // switch, and mode toggle. returnLegFetchToken already guarantees a
    // stale resolve can't apply, so keeping the previous array until the
    // next fetch resolves gives the same staleness guarantee without the
    // flicker — worst case it briefly shows the prior cycle's pairing.
    returnLegFetchToken += 1;
    const requestToken = returnLegFetchToken;
    // #40 item 2: mainDataReadyForToken was only ever assigned forward
    // (never reset), so a value left over from a previous token could
    // spuriously equal a later token and let a still-pending primary
    // fetch's render-gate check pass early. Resetting to -1 for every new
    // token means the render-gate at fetchReturnLegArrivals() can only
    // pass once THIS token's own primary fetch has actually resolved.
    mainDataReadyForToken = -1;
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

    // Item 1 (#40) keeps the previous returnLegArrivals array across a
    // *successful* refresh, so a path where nothing else is coming for this
    // token has to blank it explicitly — otherwise a stale gate outlives the
    // fetch that was meant to replace it. Only acts if this token is still
    // current: if a newer fetchData() call already superseded it, that call
    // owns the cleanup (blanking here would reintroduce item 1's flicker).
    const blankResult = (staleToken) => {
        if (staleToken !== returnLegFetchToken) return;
        returnLegArrivals = null;
        if (currentFlightMode === 'D' && mainDataReadyForToken === staleToken) {
            renderFilteredView();
        }
    };

    const cacheKey = `flight_data_${JSON.stringify(postData)}`;
    const isTestEnvironment = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isTestEnvironment && !isOnline()) {
        const cachedData = getCachedFlightData(cacheKey);
        if (cachedData) {
            applyResult(cachedData.data);
        } else {
            blankResult(token);
        }
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
        // No fresh data is coming for this token — blank rather than leave
        // item 1's previous-cycle array showing indefinitely (see blankResult).
        blankResult(token);
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

// Upper bound on implied ground time (issue #33 amendment) — see
// src/utils/blockTimes.js's MAX_IMPLIED_GROUND_MINUTES for the full
// rationale. The 0.5h band lower bound is not implemented separately;
// TURNAROUND_MINUTES (40min) is already stricter.
const MAX_IMPLIED_GROUND_MINUTES = 4 * 60;

function getMinPlausibleRoundTripMinutes(cityCode) {
    const block = BLOCK_TIME_MINUTES[cityCode];
    if (block == null) return null;
    return 2 * block + TURNAROUND_MINUTES;
}

function parseODateTime(record) {
    return new Date(`${record.ODate.replace(/\//g, '-')}T${record.OTime}+08:00`);
}

// dayReturn(ACode, CityCode) — crew-pattern knowledge, not computable from
// block time. See src/utils/blockTimes.js::dayReturn for the full rationale
// (CTS vs BKK block-time counterexample). Applied at render time, on top of
// findReturnLeg()'s result — kept identical here.
const DAY_RETURN_FALSE_ANY_AIRLINE = new Set(['CTS', 'SIN', 'KUL', 'PEN', 'CGK', 'DPS']);
const DAY_RETURN_FALSE_BY_AIRLINE = {
    BR: new Set(['BKK']), // EVA's BKK is a night stop; CI's and JX's are not.
};

function dayReturn(aCode, cityCode) {
    if (DAY_RETURN_FALSE_ANY_AIRLINE.has(cityCode)) return false;
    if (DAY_RETURN_FALSE_BY_AIRLINE[aCode]?.has(cityCode)) return false;
    return true;
}

// Aircraft type equality is checked at the family level (extractPlaneFamily,
// e.g. A321-271N -> A321), not exact PlaneNo string equality — type ratings
// are family-level, so a -9/-10 or -200/-271N swap on the return leg is
// still the same crew's aircraft (issue #33 amendment). An unresolvable
// family (empty, "-", or no [AB]\d{3} prefix) on either leg is never treated
// as a match — this is deliberately the opposite of filterByPlaneType(),
// which lets unresolvable families pass so a pilot doesn't miss their own
// assignment. Here a wrong gate is worse than a blank cell, so unknown must
// fail. Kept identical to blockTimes.js.

// Find the same-day return leg for a departure among a full-day arrivals
// list. See src/utils/blockTimes.js for the full rule writeup + rationale
// (aircraft-family equality, gap upper bound, multi-candidate tie-break,
// city gate, etc.) — kept identical here. dayReturn() is NOT applied here;
// it's a separate render-time override (see buildReturnGateCell).
function findReturnLeg(departure, arrivals) {
    const dFlightNo = parseInt(departure.FlightNo, 10);
    if (!Number.isFinite(dFlightNo)) return null;

    const dFamily = extractPlaneFamily(departure.PlaneNo);
    if (dFamily === null) return null;

    const block = BLOCK_TIME_MINUTES[departure.CityCode];
    if (block == null) return null;
    // #40 item 3: route the lower bound through getMinPlausibleRoundTripMinutes()
    // instead of re-deriving it inline, so returnleg.test.js's direct test of
    // that helper actually covers the value findReturnLeg() uses.
    const minGapMinutes = getMinPlausibleRoundTripMinutes(departure.CityCode);
    const maxGapMinutes = 2 * block + MAX_IMPLIED_GROUND_MINUTES;

    const dTime = parseODateTime(departure);

    let best = null;
    let bestGap = Infinity;
    for (const arrival of arrivals) {
        if (arrival.ACode !== departure.ACode) continue;
        if (arrival.CityCode !== departure.CityCode) continue;
        if (arrival.ODate !== departure.ODate) continue;
        if (extractPlaneFamily(arrival.PlaneNo) !== dFamily) continue;
        const aFlightNo = parseInt(arrival.FlightNo, 10);
        if (!Number.isFinite(aFlightNo)) continue;
        if (Math.abs(aFlightNo - dFlightNo) !== 1) continue;

        const aTime = parseODateTime(arrival);
        if (!(aTime > dTime)) continue;

        const gapMinutes = (aTime - dTime) / 60000;
        if (gapMinutes < minGapMinutes || gapMinutes > maxGapMinutes) continue;

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
// confident return-leg match (not yet fetched, long-haul, one-way, no
// candidate survives the plausibility gate, or dayReturn() overrides it to
// a known night stop) or when the return leg has no gate assigned yet.
//
// Display design (issue #33 amendment): a direction glyph (← U+2190, never
// ↩ — that one renders as a coloured emoji on several platforms) is always
// present, in every viewport — it must not depend on a hover/title (touch
// devices have no hover) or on comparing against a neighbouring cell (the
// single-flight filtered view has no neighbour). One line only, both
// breakpoints: `← C5` on mobile, `← BR178 C5` above 768px once there's room
// for the flight number to confirm which return. Styling (bold departure
// gate / regular-weight secondary-colour return gate) lives in style.scss.
function buildReturnGateCell(departureFlight, isSmall) {
    if (!returnLegArrivals) return '';
    if (!dayReturn(departureFlight.ACode, departureFlight.CityCode)) return '';
    const returnLeg = findReturnLeg(departureFlight, returnLegArrivals);
    if (!returnLeg || !returnLeg.Gate) return '';

    const returnFlightNo = `${returnLeg.ACode}${returnLeg.FlightNo}`.replace(/\s+/g, '');
    const gate = escapeHtml(returnLeg.Gate);
    if (isSmall) {
        return `<span class="return-gate-cell">←&nbsp;${gate}</span>`;
    }
    return `<span class="return-gate-cell">←&nbsp;${escapeHtml(returnFlightNo)}&nbsp;${gate}</span>`;
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
    [COOKIE_NAME, PLANE_TYPE_COOKIE_NAME, THEME_COOKIE_NAME, LANGUAGE_COOKIE_NAME].forEach(name => {
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

        const installBtn = event.target.closest('#drawer-install-btn');
        if (installBtn) {
            event.preventDefault();
            handleInstallButtonClick();
        }

        const shareBtn = event.target.closest('#drawer-share-btn');
        if (shareBtn) {
            event.preventDefault();
            handleShareButtonClick();
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