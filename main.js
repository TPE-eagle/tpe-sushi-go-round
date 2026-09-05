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
// Vendored locally (issue #69) — the table renders a logo for every code an
// airline group can contain, not just the 3 filter buttons, so this must
// list all 5. A code outside this set (unknown route, codeshare, API change)
// has no local file, so hasVendoredLogo() returning false renders with no
// logo image rather than a broken <img src>.
const KNOWN_LOGO_CODES = ['BR', 'B7', 'CI', 'AE', 'JX'];
function hasVendoredLogo(code) {
    return KNOWN_LOGO_CODES.includes(code);
}
const LOGO_BASE_URL = `${import.meta.env.BASE_URL}logos/`;
const DEFAULT_LANGUAGE = 'zh';
const COOKIE_NAME = 'ACode';
const PLANE_TYPE_COOKIE_NAME = 'PlaneType';
const REFRESH_DELAY = 1500;
const THEME_COOKIE_NAME = 'theme';
// Issue #130 follow-up — the window selection is cookie-persisted (owner
// decision 2026-09-05, superseding #88's in-memory-only D3) so it survives
// the visibilitychange auto-reload, like every other setting.
const FORWARD_HOURS_COOKIE_NAME = 'ForwardHours';
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
// Issue #88 — the selectable board window: how many hours past `now` the
// board reaches. Cycled +2 → +4 → +6 → +8 → +2 by the window selector
// button. In-memory only, deliberately NOT persisted (D3: reload resets to
// +2; no fifth cookie — cookie policy is issue #70's). Preserved across
// mode/language switches and pull-to-refresh, like the plane type pin's
// in-session behaviour.
let currentForwardHours = 2;
// Issue #88 — airline-supported, pre-time-filter copy of the last fetched
// day payload. filterFlightsByTime() narrows `flightData` to the window at
// fetch time; cycling the window re-runs that pure filter on this copy
// instead of issuing a new fetch (zero-new-fetch invariant).
let allSupportedFlights = [];
// Issue #88 — cycle order of the window selector button.
const FORWARD_HOURS_OPTIONS = [2, 4, 6, 8];

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
// Issue #39 — mirrors returnLegFetchToken above, but guards fetchData()'s
// own primary fetch instead of the return-leg pairing fetch. Bumped at the
// top of every fetchData() call; a resolve whose captured token no longer
// matches is a superseded response from before a mode/language toggle or
// another refresh, and must not clobber flightData with the previous
// cycle's records. A separate counter rather than reusing requestToken:
// requestToken already has a job (fetchReturnLegArrivals()'s render gate),
// so giving the primary fetch its own counter keeps this guard cleanly
// separable if a future change wants to cancel only the pairing fetch
// without invalidating the primary fetch.
let mainFetchToken = 0;

// Issue #130 — quick-dial flight-number search. fullDayByState keeps BOTH
// directions' full-day, group-filtered records (cancelled rows RETAINED —
// searching a cancelled flight must answer "cancelled", never "no such
// flight"), so search ignores the 2-hour display window and the current
// mode. null = that direction's store hasn't been fetched yet. The current
// mode's slot is assigned inside processFetchedData; the arrivals slot is
// also fed by fetchReturnLegArrivals() in departures mode; the departures
// slot gets a mirror lazy fetch (fetchSearchDepartures) while in arrivals
// mode with search open.
let fullDayByState = { A: null, D: null };
let searchOpen = false;
// Guards the lazy reverse-direction (AState=D) fetch that feeds the search
// store while in arrivals mode — same supersession pattern as returnLegFetchToken.
let searchDepFetchToken = 0;
// Set when the lazy departures fetch fails (offline with no cache, or the
// request errored) so the status line says "unavailable" instead of an
// endless "loading". Reset on the next fetch attempt.
let searchDepUnavailable = false;
// sessionStorage key for { open, q } — survives the visibilitychange reload;
// per-tab and session-scoped, deliberately NOT a cookie (issue #130 D3).
const SEARCH_SESSION_KEY = 'tpe_flight_search';
// Per-direction display cap: a one-digit query could otherwise put hundreds
// of rows in the board slot. Exact matches sort first, so a fully typed
// flight number is never hidden by the cap.
const SEARCH_RESULT_CAP = 20;

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
        "timeWindowTooltip": "顯示接下來 {h} 小時內的航班",
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
        "search": {
            "open": "搜尋航班",
            "close": "關閉搜尋",
            "label": "搜尋航班",
            "clear": "清除",
            "placeholder": "輸入班號數字，例如 178",
            "countOne": "找到 {n} 班",
            "countBoth": "到達 {a} 班、出發 {d} 班",
            "noMatch": "今天（{date}）沒有 {query} 這班。只查得到當天航班。",
            "pinHint": "已釘選 {aname}，{query} 不在其中",
            "showAllAirlines": "顯示全部航空公司",
            "departuresPending": "出發資料載入中…",
            "departuresUnavailable": "出發資料暫時無法取得",
            "cancelled": "已取消",
            "gateTba": "未定",
            "headingArrivals": "到達",
            "headingDepartures": "出發"
        },
        "drawer": {
            "aboutDrawerTitle": "關於",
            "closeLabel": "關閉",
            "whatItDoes": {
                "heading": "這是什麼",
                "body": [
                    "長榮、華航、星宇（含立榮、華信）組員的桃園機場航班看板。出發看登機門，到達看行李轉盤。",
                    "裝到主畫面就能當 App 用，不用上 App Store。"
                ]
            },
            "opensOnArrival": {
                "heading": "打開就是到達",
                "body": [
                    "預設是到達（行李轉盤）。飛回來都累了，打開直接看就好。",
                    "要看出發，按右上角 🛫。去程還有精神，多按一下沒差。",
                    "只有這一個設定是故意不記的。"
                ]
            },
            "whichFlights": {
                "heading": "顯示哪些班機",
                "body": [
                    "預設顯示前後約兩小時：出發往後兩小時，到達從 40 分鐘前算起。要看得更遠，上面的 +2h 鈕可切 +4／+6／+8 小時。",
                    "確切的日期和時段寫在表格下面那行。",
                    "每次載入都重抓資料。出境過了移民官，再開一次看登機門有沒有換。",
                    "按 🔍 輸入班號數字，可查當天任何一班，不受時段限制。"
                ]
            },
            "install": {
                "heading": "裝成 App",
                "iosSteps": "iPhone／iPad（Safari）：分享 → 加入主畫面 → 新增",
                "iosFallback": "找不到「分享」，點網址列旁的 ⋯。面板裡沒有「加入主畫面」，滑到底點「編輯動作」打開。",
                "installButtonLabel": "安裝",
                "offlineNote": "裝好後沒網路也能開，會顯示上次的資料和時間。"
            },
            "share": {
                "heading": "分享給同事",
                "body": "按「分享」會跳出手機本身的分享面板。",
                "shareButtonLabel": "分享",
                "copyLinkLabel": "複製連結",
                "copiedConfirmation": "已複製連結"
            },
            "remembers": {
                "heading": "會記住的設定",
                "body": [
                    "航空公司、機型、主題、語言、顯示時間範圍，選過就記住，每次打開重新計時。",
                    "語言沒選過就跟系統走。"
                ]
            },
            "returnGateColumn": {
                "heading": "「回程登機門」那欄",
                "bodyBefore": "同一天飛回桃園那班停的登機門。",
                "bodyAfter": [
                    "符合條件才顯示，空白不代表沒回程。這些情況不顯示：過夜班或長程、回程換機型（就不是同一組人）、班號或時間對不上。",
                    "當日來回是照我訂的規則判斷，各家排班方式不一樣。",
                    "對判斷邏輯有想法，歡迎跟我說。"
                ]
            },
            "feedback": {
                "heading": "哪裡怪怪的",
                "body": [
                    "當面跟我講最快，想留紀錄就開 GitHub issue。",
                    "別貼班表細節或個資，那邊是公開的。"
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
        "timeWindowTooltip": "Show flights for the next {h} hours",
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
        "search": {
            "open": "Search flights",
            "close": "Close search",
            "label": "Search flights",
            "clear": "Clear",
            "placeholder": "Flight number digits, e.g. 178",
            "countOne": "{n} flight(s) found",
            "countBoth": "{a} arrival(s), {d} departure(s)",
            "noMatch": "No {query} today ({date}). Search covers today's flights only.",
            "pinHint": "{aname} is pinned, {query} is another airline",
            "showAllAirlines": "Show all airlines",
            "departuresPending": "Loading departures…",
            "departuresUnavailable": "Departures unavailable right now",
            "cancelled": "Cancelled",
            "gateTba": "TBA",
            "headingArrivals": "Arrivals",
            "headingDepartures": "Departures"
        },
        "drawer": {
            "aboutDrawerTitle": "About",
            "closeLabel": "Close",
            "whatItDoes": {
                "heading": "What this is",
                "body": [
                    "A Taoyuan Airport flight board for EVA Air, China Airlines and STARLUX crew, UNI Air and Mandarin included. Departures show your gate, arrivals your carousel.",
                    "Add it to your home screen and it behaves like an app. No App Store involved."
                ]
            },
            "opensOnArrival": {
                "heading": "Opens on arrivals",
                "body": [
                    "Arrivals, with your carousel, is what comes up first. You're tired coming home, so it's just there.",
                    "For departures, tap 🛫 top right. You're fresh on the way out, one more tap won't hurt.",
                    "The one setting it never remembers, on purpose."
                ]
            },
            "whichFlights": {
                "heading": "Which flights show up",
                "body": [
                    "By default, about two hours around now: departures two hours ahead, arrivals from 40 minutes ago. The +2h button above extends it to +4/+6/+8 hours.",
                    "The exact date and range are in the line under the table.",
                    "Every load fetches fresh data. Once you're through immigration outbound, open it again and re-check your gate.",
                    "Tap 🔍 and type a flight number's digits to look up any flight today, outside the selected window."
                ]
            },
            "install": {
                "heading": "Install it",
                "iosSteps": "iPhone / iPad (Safari): Share → Add to Home Screen → Add",
                "iosFallback": "No Share button? Tap ⋯ next to the address bar. No \"Add to Home Screen\" in the sheet? Scroll to the bottom and turn it on under Edit Actions.",
                "installButtonLabel": "Install",
                "offlineNote": "Once installed it opens offline, showing the last data it fetched and when."
            },
            "share": {
                "heading": "Share it with colleagues",
                "body": "Tap Share to open your phone's share sheet.",
                "shareButtonLabel": "Share",
                "copyLinkLabel": "Copy link",
                "copiedConfirmation": "Link copied"
            },
            "remembers": {
                "heading": "What it remembers",
                "body": [
                    "Airline, aircraft type, theme, language and the display window. Set once, kept, and the clock restarts each time you open it.",
                    "Language follows your system setting until you pick one."
                ]
            },
            "returnGateColumn": {
                "heading": "The Return Gate column",
                "bodyBefore": "The arrival gate of the same-day return leg, back at Taoyuan.",
                "bodyAfter": [
                    "It only shows when the rules match, so blank doesn't mean no return. It's left out for night stops and long haul, when the return is a different aircraft type (so not the same crew), or when flight numbers or timings don't line up.",
                    "Same-day returns are worked out by rules I wrote, and each airline schedules differently.",
                    "If you think the logic should work differently, tell me."
                ]
            },
            "feedback": {
                "heading": "Something looks off?",
                "body": [
                    "Quickest is to tell me in person. Open a GitHub issue if you want it on record.",
                    "Don't post roster details or personal information there. It's public."
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
        "timeWindowTooltip": "今後 {h} 時間以内の便を表示",
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
        "search": {
            "open": "フライト検索",
            "close": "検索を閉じる",
            "label": "フライト検索",
            "clear": "クリア",
            "placeholder": "便名の数字を入力（例：178）",
            "countOne": "{n} 便見つかりました",
            "countBoth": "到着 {a} 便・出発 {d} 便",
            "noMatch": "{query} は本日（{date}）の便にありません。検索できるのは当日の便だけです。",
            "pinHint": "{aname} を固定中。{query} は別の航空会社です",
            "showAllAirlines": "全航空会社を表示",
            "departuresPending": "出発便を読み込み中…",
            "departuresUnavailable": "出発便のデータを取得できません",
            "cancelled": "欠航",
            "gateTba": "未定",
            "headingArrivals": "到着",
            "headingDepartures": "出発"
        },
        "drawer": {
            "aboutDrawerTitle": "このアプリについて",
            "closeLabel": "閉じる",
            "whatItDoes": {
                "heading": "何をするアプリか",
                "body": [
                    "エバー航空・チャイナエアライン・スターラックス（ユニー航空・マンダリン航空を含む）の乗務員向け、桃園空港のフライトボードです。出発はゲート、到着は荷物回転台が出ます。",
                    "ホーム画面に追加すればアプリとして使えます。App Store は不要です。"
                ]
            },
            "opensOnArrival": {
                "heading": "開くとまず到着",
                "body": [
                    "最初に出るのは到着（荷物回転台）です。帰りは疲れているので、開いてすぐ見えるようにしました。",
                    "出発は右上の 🛫 をタップ。行きはまだ元気なので、一回多く押すくらいは大丈夫です。",
                    "これだけは、あえて覚えないようにしています。"
                ]
            },
            "whichFlights": {
                "heading": "表示される便",
                "body": [
                    "初期設定では今を中心に約2時間。出発は2時間先まで、到着は40分前からです。上の +2h ボタンで +4/+6/+8 時間に切り替えられます。",
                    "表の下に実際の日付と時間帯が出ます。",
                    "開くたびにデータを取り直します。出発時は出国審査を抜けたら、もう一度開いてゲートを確認してください。",
                    "🔍 をタップして便名の数字を入力すると、時間帯に関係なく当日のどの便でも調べられます。"
                ]
            },
            "install": {
                "heading": "インストール",
                "iosSteps": "iPhone / iPad（Safari）：共有 → ホーム画面に追加 → 追加",
                "iosFallback": "「共有」が見当たらなければ、アドレスバー横の ⋯ をタップ。シートに「ホーム画面に追加」がなければ、一番下の「アクションを編集」でオンにしてください。",
                "installButtonLabel": "インストール",
                "offlineNote": "インストール後はオフラインでも開けます。最後に取得したデータと、その時刻を表示します。"
            },
            "share": {
                "heading": "同僚に教える",
                "body": "「共有」をタップすると、スマホの共有シートが開きます。",
                "shareButtonLabel": "共有",
                "copyLinkLabel": "リンクをコピー",
                "copiedConfirmation": "リンクをコピーしました"
            },
            "remembers": {
                "heading": "覚えている設定",
                "body": [
                    "航空会社・機種・テーマ・言語・表示時間幅は一度選べばそのまま。期限は開くたびにリセットされます。",
                    "言語は選ぶまでシステム設定に従います。"
                ]
            },
            "returnGateColumn": {
                "heading": "「復路ゲート」の列",
                "bodyBefore": "同じ日に桃園へ戻る復路便の到着ゲートです。",
                "bodyAfter": [
                    "条件が合うときだけ出ます。空欄でも復路がないとは限りません。ステイや長距離線、復路の機種が違う（＝同じ乗務員ではない）、便名や時刻が合わない場合は表示しません。",
                    "日帰りかどうかは私が決めたルールで判定しています。スケジュールの組み方は会社ごとに違います。",
                    "判定の仕方に意見があれば教えてください。"
                ]
            },
            "feedback": {
                "heading": "おかしいと思ったら",
                "body": [
                    "直接言ってもらうのが一番早いです。記録に残したければ GitHub の issue をどうぞ。",
                    "公開の場なので、乗務スケジュールの詳細や個人情報は書かないでください。"
                ]
            },
            "disclaimer": "※ この日本語は AI 翻訳です。作者は日本語が読めないので、おかしな表現があるかもしれません。変だと思ったら英語版を見てください。申し訳ありません。"
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
                <div id="flight-mode-toggle" role="button" class="flight-toggle-btn" aria-label="Toggle flight mode" tabindex="0">🛬</div>
                <div id="search-toggle" role="button" class="flight-toggle-btn" aria-label="Search flights" tabindex="0">
                    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="2"></circle>
                        <line x1="12.8" y1="12.8" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
                    </svg>
                </div>
                <div id="about-drawer-toggle" role="button" class="flight-toggle-btn" aria-label="About" data-bs-toggle="offcanvas" data-bs-target="#about-drawer" aria-controls="about-drawer" tabindex="0">
                    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                        <rect x="3" y="4" width="14" height="2" rx="1" fill="currentColor"></rect>
                        <rect x="3" y="9" width="14" height="2" rx="1" fill="currentColor"></rect>
                        <rect x="3" y="14" width="14" height="2" rx="1" fill="currentColor"></rect>
                    </svg>
                </div>
            </div>
            <h1 id="title" class="text-center text-uppercase fw-bold my-4"></h1>
            <div id="search-bar" class="search-bar" hidden>
                <form id="search-form" role="search" class="search-form">
                    <label for="search-input" class="visually-hidden search-label"></label>
                    <input id="search-input" type="search" class="search-input" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" autocapitalize="characters" placeholder="">
                    <button type="button" id="search-clear" class="search-clear" aria-label="" hidden>✕</button>
                </form>
                <p id="search-status" class="search-status" role="status" hidden></p>
            </div>
            <div id="airlineButtons" class="d-flex justify-content-center mb-2"></div>
            <div id="planeTypeButtons" class="d-flex justify-content-center flex-wrap mb-2"></div>
            <div id="flightButtons" class="d-flex justify-content-center flex-wrap"></div>
            <div id="search-results" class="flight-board search-results" hidden></div>
            <div id="output" class="container flight-board"></div>
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
                <!-- Issue #88/#130 — the window selector and theme toggle live
                     in the drawer (the app's settings surface); handlers are
                     delegated on document, so the element's position is free. -->
                <div class="drawer-header-actions">
                    <button type="button" id="time-window-toggle" class="flight-toggle-btn window-toggle-btn" aria-label="">+2h</button>
                    <div id="theme-toggle" role="button" class="theme-toggle-btn" aria-label="Toggle theme" tabindex="0">🌙</div>
                    <button type="button" id="about-drawer-close" class="drawer-close-btn" data-bs-dismiss="offcanvas" aria-label="Close">✕</button>
                </div>
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
    updateSearchText();

    document.title = title;
    updateMetaTag('meta[name="description"]', description);
    updateMetaTag('meta[property="og:title"]', title);
    updateMetaTag('meta[property="og:description"]', description);
    updateMetaTag('meta[property="og:locale"]', OG_LOCALE[currentLanguage] || OG_LOCALE.en);
    updateMetaTag('meta[name="twitter:title"]', title);
    updateMetaTag('meta[name="twitter:description"]', description);
    document.documentElement.lang = HTML_LANG_TAG[currentLanguage] || HTML_LANG_TAG.en;
    updateTimeWindowButton(); // Issue #88 — re-translate the selector's aria-label/title
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
    // An unrecognised cookie value (corrupted, or a future sibling app on the
    // same Pages host writing a generic `lang` cookie) must not brick the
    // page — fall through to auto-detection instead of trusting it verbatim.
    const cookieLang = checkCookie(LANGUAGE_COOKIE_NAME) ? getCookie(LANGUAGE_COOKIE_NAME) : null;
    if (cookieLang && Object.prototype.hasOwnProperty.call(translations, cookieLang)) {
        currentLanguage = cookieLang;
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
//
// Issue #62: the example must render through the same header-variant and
// return-gate-cell logic as the real board (`displayFlights` /
// `buildReturnGateCell`), not a hand-copied long-form markup — otherwise the
// two drift apart the moment the real board's responsive behaviour changes.
// At ≤768px it also drops to a 3-column fragment (flight number, gate,
// return gate — the pair the section is explaining, plus enough context to
// read as one board row) instead of trying to cram 5 columns into a mobile
// drawer and relying on horizontal scroll.
function buildDrawerExampleTable(lang) {
    const headers = translations[lang]["tableHeaders"];
    const isSmall = isSmallScreen();
    const flightNumberHeader = isSmall ? headers["FlightNumberShort"] : headers["FlightNumber"];
    const returnGateHeader = isSmall ? headers["ReturnGateShort"] : headers["ReturnGate"];
    const returnGateCell = formatReturnGateCell('BR177', 'C7', isSmall);

    if (isSmall) {
        return `
            <table class="table table-sm table-striped table-borderless drawer-example-table">
                <thead class="table-br">
                    <tr>
                        <th>${flightNumberHeader}</th>
                        <th class="text-center">${headers["Gate"]}</th>
                        <th class="text-center">${returnGateHeader}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>BR178</td>
                        <td class="text-center">C5</td>
                        <td class="text-center">${returnGateCell}</td>
                    </tr>
                </tbody>
            </table>`;
    }

    return `
        <table class="table table-sm table-striped table-borderless drawer-example-table">
            <thead class="table-br">
                <tr>
                    <th>${flightNumberHeader}</th>
                    <th class="text-center">${headers["Destination"]}</th>
                    <th class="text-center">${headers["Terminal"]}</th>
                    <th class="text-center">${headers["Gate"]}</th>
                    <th class="text-center">${returnGateHeader}</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>BR178</td>
                    <td class="text-center">KIX</td>
                    <td class="text-center">T2</td>
                    <td class="text-center">C5</td>
                    <td class="text-center">${returnGateCell}</td>
                </tr>
            </tbody>
        </table>`;
}

// Builds the full offcanvas body for the given language. Called by
// renderDrawerBody() (drawer opening, or a language change while it's
// already open) — content is destroyed and rebuilt each time, same as the
// rest of the app's i18n approach.
function buildDrawerContent(lang) {
    const d = translations[lang]["drawer"];
    const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const canCopy = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);
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
                <button type="button" id="drawer-install-btn" class="btn btn-sm btn-secondary">${d.install.installButtonLabel}</button>
            </div>
            <p class="drawer-section-body">${d.install.offlineNote}</p>
        </section>`;

    html += `
        <section class="drawer-section">
            <h6 class="drawer-section-title">${d.share.heading}</h6>
            <p class="drawer-section-body">${d.share.body}</p>
            <div class="drawer-share-row">
                ${(canShare || canCopy) ? `<button type="button" id="drawer-share-btn" class="btn btn-sm btn-secondary">${shareButtonLabel}</button>` : ''}
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

    // The body itself (including the example <table>) is only (re)rendered
    // while the drawer is open — see the show.bs.offcanvas listener in
    // setupEventListeners(). Rendering it unconditionally on every page
    // load / language change put a second, always-in-DOM <table> on the
    // page, which broke every existing e2e test doing a bare
    // page.locator('table') for the flight list.
    const drawerEl = document.getElementById('about-drawer');
    if (drawerEl && drawerEl.classList.contains('show')) {
        renderDrawerBody();
    }
}

function renderDrawerBody() {
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

// Centralized business rule for time window config.
// Issue #88: `forwardHours` replaces the old fixed `durationMinutes: 120`
// as the single source of truth for the window's forward reach (120
// minutes == the historical +2h). Mirrors src/utils/flightUtils.js — keep
// the two copies in sync.
function getTimeWindowConfig(mode, forwardHours = 2) {
    if (mode === 'A') { // Arrival: User's original requirement
        return {
            roundingStepMinutes: 10,      // Round to nearest 10 minutes
            offsetFromRoundedMinutes: -40,  // Window starts 40 minutes BEFORE rounded time (backward edge never scales)
            forwardHours                    // Window reaches `forwardHours` past its start (forward edge only)
        };
    } else { // Departure (D): Matches current behavior post-revert
        return {
            roundingStepMinutes: 10,      // Round to nearest 10 minutes
            offsetFromRoundedMinutes: 0,    // Window starts AT the rounded time
            forwardHours
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

// Issue #88 — last millisecond (23:59:59.999) of the UTC+8 calendar day
// `now` falls in, as an absolute instant. Taipei is a fixed +8 offset with
// no DST, so Taipei midnight is always UTC 16:00.
// Mirrors src/utils/flightUtils.js — keep the two copies in sync.
function endOfUTC8Day(now = new Date()) {
    const utc8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return new Date(Date.UTC(
        utc8.getUTCFullYear(), utc8.getUTCMonth(), utc8.getUTCDate(),
        15, 59, 59, 999
    ));
}

// Generic time window calculator.
// Issue #88: the forward edge is `forwardHours` past the window start,
// truncated so the window never reaches past the end of `initialNow`'s own
// UTC+8 day. The anchor is the day of `now`, not of `windowStart`: the
// arrivals −40 min backward component legally places windowStart on the
// previous day around Taipei midnight — truncation only ever bites
// windowEnd, never windowStart. Mirrors src/utils/flightUtils.js.
function getTimeWindow(config, initialNow = new Date()) { // initialNow is local by default
    const roundedLocalNow = roundDownToStep(initialNow, config.roundingStepMinutes); // Rounding local time
    
    const windowStart = new Date(roundedLocalNow.getTime() + (config.offsetFromRoundedMinutes * 60 * 1000)); // windowStart is local
    const windowEnd = new Date(windowStart.getTime() + (config.forwardHours * 60 * 60 * 1000)); // windowEnd is local
    windowEnd.setSeconds(59, 999); // Make the window inclusive of the last minute
    const endOfDay = endOfUTC8Day(initialNow); // Issue #88 — truncate at the end of now's UTC+8 day
    if (windowEnd > endOfDay) windowEnd.setTime(endOfDay.getTime());
    return { windowStart, windowEnd };
}

function updateApiParams() {
    const dateStr = getUTC8Date(); // Date in YYYY/MM/DD (UTC+8)
    const config = getTimeWindowConfig(currentFlightMode, currentForwardHours);
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
    // Issue #39 — bumped in the same block as returnLegFetchToken (not
    // further down, next to the fetch it guards) so the two counters can't
    // desynchronize: fetchReturnLegArrivals()'s render gate only holds if a
    // superseded primary fetch always implies a superseded pairing fetch,
    // and any future early return slipped between the two bumps would
    // silently break that invariant while leaving the guard looking intact.
    mainFetchToken += 1;
    // Issue #130 review F2 — invalidate any in-flight lazy departures store
    // fetch (mirror of the bumps above): a lazy fetch issued in arrivals mode
    // must not land after a newer fetchData() cycle and overwrite
    // fullDayByState.D with stale/wrong-language rows.
    searchDepFetchToken += 1;
    const mainRequestToken = mainFetchToken;
    // #40 item 2: mainDataReadyForToken was only ever assigned forward
    // (never reset), so a value left over from a previous token could
    // spuriously equal a later token and let a still-pending primary
    // fetch's render-gate check pass early. Resetting to -1 for every new
    // token means the render-gate at fetchReturnLegArrivals() can only
    // pass once THIS token's own primary fetch has actually resolved.
    mainDataReadyForToken = -1;
    if (currentFlightMode === 'D') {
        fetchReturnLegArrivals(requestToken);
    } else if (searchOpen) {
        // Issue #130 — arrivals mode keeps the departures search store fresh
        // while the takeover is active (mirror of the pairing fetch above).
        fetchSearchDepartures();
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
    const config = getTimeWindowConfig(currentFlightMode, currentForwardHours);
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
        // Store for offline fallback only; never served while online. Kept
        // unconditional (issue #39): a superseded response is still valid
        // data for the offline cache, even though it must not render below.
        if (!isTestEnvironment) {
            setCachedFlightData(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
        }

        // Issue #39 — a newer fetchData() call has started since this fetch
        // was issued (mode/language toggle, another refresh); rendering it
        // now would clobber flightData with the previous cycle's records.
        if (mainRequestToken !== mainFetchToken) return;

        hideOfflineBanner();
        processFetchedData(data);
        mainDataReadyForToken = requestToken;
    })
    .catch(error => {
        // Issue #39 — same staleness guard as the success path: nobody is
        // waiting on a superseded request, so it should not surface an
        // error (or clear a banner) for one.
        if (mainRequestToken !== mainFetchToken) return;

        // Offline without any cached data -> dedicated message.
        // Online but the request failed -> generic error. We intentionally do
        // NOT fall back to stale cache here: a working network connection with
        // a failed API call should not silently serve yesterday's carousels.
        if (!isOnline()) {
            document.getElementById("output").innerHTML =
                `<div class="empty-state text-center">${translations[currentLanguage]["offlineNoCache"]}</div>`;
            updateOfflineBanner(null);
            // Issue #130 review F1: the search takeover hides #output, so the
            // error must surface on the status line too — stale-looking rows
            // with no indication are exactly what this branch exists to prevent.
            if (searchOpen) setStatusLine(translations[currentLanguage]["offlineNoCache"]);
        } else {
            document.getElementById("output").innerHTML =
                `<div class="empty-state text-center">${translations[currentLanguage]["error"]}</div>`;
            if (searchOpen) setStatusLine(translations[currentLanguage]["error"]);
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
        // Issue #130 — feed the search store's arrivals slot with the
        // pre-cancelled-drop list (search must see cancelled flights).
        fullDayByState.A = data.filter(flight => allGroupCodes.includes(flight.ACode));
        returnLegArrivals = data.filter(flight =>
            allGroupCodes.includes(flight.ACode) && !isCancelledFlight(flight)
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
        if (searchOpen) renderSearchResults();
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

// Issue #130 — mirror of fetchReturnLegArrivals(): while the app is in
// arrivals mode with search open, fetch the full-day departures store so a
// departure flight number is searchable without leaving arrivals. Own token
// (searchDepFetchToken); deliberately silent on failure — the status line
// switches to "departures unavailable" instead of an endless "loading".
function fetchSearchDepartures() {
    const token = ++searchDepFetchToken;
    searchDepUnavailable = false;
    const postData = {
        "ODate": getUTC8Date(),
        "OTimeOpen": null,
        "OTimeClose": null,
        "BNO": null,
        "AState": "D",
        "language": currentLanguage === "zh" ? "ch" : currentLanguage,
        "keyword": ""
    };

    const applyResult = (data) => {
        if (token !== searchDepFetchToken) return; // superseded — drop silently
        const allGroupCodes = Object.values(AIRLINE_GROUPS).flat();
        fullDayByState.D = data.filter(flight => allGroupCodes.includes(flight.ACode));
        searchDepUnavailable = false;
        renderSearchResults();
    };

    const cacheKey = `flight_data_${JSON.stringify(postData)}`;
    const isTestEnvironment = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

    if (!isTestEnvironment && !isOnline()) {
        const cachedData = getCachedFlightData(cacheKey);
        if (cachedData) {
            applyResult(cachedData.data);
        } else {
            searchDepUnavailable = true;
            renderSearchResults();
        }
        return;
    }

    fetch(API_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": currentLanguage === 'zh' ? 'zh-TW,zh;q=0.9'
                : currentLanguage === 'jp' ? 'ja-JP,ja;q=0.9'
                : 'en-US,en;q=0.9',
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
        if (token !== searchDepFetchToken) return;
        searchDepUnavailable = true;
        renderSearchResults();
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

// Issue #88 — shared test-hostname guard: time filtering is skipped on
// localhost/127.0.0.1 so e2e mock data renders deterministically. The
// window-cycle button honours the same guard (clickable in dev: board
// untouched, caption follows the selection).
function isTestHostname() {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

// Null-safe cancelled check shared by the board filter, the pairing fetch
// and the search presentation (issue #130: Memo can be null in the wild —
// the old inline Memo.toLowerCase() would throw on it).
function isCancelledFlight(flight) {
    const memo = String(flight?.Memo ?? '').toLowerCase();
    return memo.includes('取消') || memo.includes('cancelled');
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
    const groupFiltered = data.filter(flight => allGroupCodes.includes(flight.ACode));

    // Issue #130 — the search store for the current direction: the same
    // records as the board but WITHOUT the cancelled drop and WITHOUT the
    // time window. Assigned here — not in the fetch callback — so the
    // staleness guard, the offline cache path and the localhost skip all
    // stay correct by construction.
    fullDayByState[currentFlightMode] = groupFiltered;

    flightData = groupFiltered.filter(flight => !isCancelledFlight(flight));

    // Issue #88 — keep the pre-time-filter copy for window re-filtering:
    // cycling the selector re-runs the pure filter on this array instead of
    // fetching again.
    allSupportedFlights = flightData;

    // Skip time filtering in test environment for reliable E2E tests
    if (!isTestHostname()) {
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
            const logoImg = hasVendoredLogo(code)
                ? `<img alt="${code} Logo" width="${imageSize}" height="${Math.floor(imageSize * 0.71)}" src="${LOGO_BASE_URL}${code}.gif">`
                : '';
            linksHTML += `
                <a href="#" data-airline="${code}" class="airline-link">
                    ${logoImg}
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

    // Issue #130 — single refresh hook for the search takeover: every board
    // write path (refresh, language, mode toggle, pin taps, the pairing
    // back-fill) funnels through here, so the results stay in lockstep with
    // the data without each writer needing to know search exists.
    if (searchOpen) renderSearchResults();
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
    const config = getTimeWindowConfig(currentFlightMode, currentForwardHours); // Issue #88 — reads the selector global
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

// Issue #88 — the window selector button: shows the current forward reach
// and cycles +2 → +4 → +6 → +8 → +2 on click. Pure client-side: re-filters
// the already-fetched full-day payload (allSupportedFlights), never issues
// a new fetch. On the test hostname the board skips time filtering, so only
// the caption follows the selection.
function cycleTimeWindow() {
    const idx = FORWARD_HOURS_OPTIONS.indexOf(currentForwardHours);
    currentForwardHours = FORWARD_HOURS_OPTIONS[(idx + 1) % FORWARD_HOURS_OPTIONS.length];
    // Issue #130 follow-up — cookie-persisted (owner decision), 400-day
    // sliding like every other setting; survives the visibilitychange reload.
    setCookie(FORWARD_HOURS_COOKIE_NAME, String(currentForwardHours), 400);

    updateTimeWindowButton();

    if (!isTestHostname()) {
        flightData = filterFlightsByTime(allSupportedFlights);
        // Review F1 (PR #131): the airline row is built from the
        // time-filtered list at fetch time, so it must be rebuilt for the new
        // window too — otherwise an airline that only appears in the wider
        // window has table rows but no pin button. Listeners are delegated,
        // so rebuilding is safe (same pattern as every fetch);
        // renderFilteredView()'s updateAirlineLinks() re-applies active state.
        generateAirlineLinks(flightData);
    }
    updateApiParams();
    renderFilteredView();
}

function updateTimeWindowButton() {
    const btn = document.getElementById('time-window-toggle');
    if (!btn) return;
    btn.textContent = `+${currentForwardHours}h`; // Language-neutral value; copy below is translated
    // Non-default window gets the cluster's active fill — the button's own
    // text IS the state, the fill makes "not +2h" visible at a glance.
    btn.classList.toggle('active', currentForwardHours !== FORWARD_HOURS_OPTIONS[0]);
    const label = translations[currentLanguage]['timeWindowTooltip'].replace('{h}', currentForwardHours);
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
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

// ---------------------------------------------------------------------------
// Issue #130 — quick-dial flight-number search (board takeover)
// ---------------------------------------------------------------------------

// The matching helpers live in src/utils/flightUtils.js (mirrored here per
// the dual-copy rule): normalizeFlightQuery + matchFlights.
// Owner decision (issue #130): digits-only quick dial. NFKC folds full-width
// IME forms, then everything that is not a digit is stripped — letters are
// ignored entirely ("BR178" searches "178"), the airline pin does the
// carrier scoping.
function normalizeFlightQuery(query) {
    return String(query ?? '')
        .normalize('NFKC')
        .replace(/[^0-9]/g, '');
}

function matchFlights(flights, query, todayStr) {
    const q = normalizeFlightQuery(query);
    if (!q) return [];
    const queryDigits = q.replace(/^0+/, '');
    if (!queryDigits) return []; // all zeros — nothing usable

    const digitsOf = (flight) => {
        const m = String(flight.FlightNo ?? '').match(/\d+/);
        return (m ? m[0] : '').replace(/^0+/, '');
    };

    return flights
        .filter(flight => flight.ODate === todayStr)
        .filter(flight => digitsOf(flight).startsWith(queryDigits))
        .sort((a, b) => {
            // Exact hits (the whole flight number equals the query) float
            // above mere prefix matches.
            const score = (flight) => (digitsOf(flight) === queryDigits ? 0 : 1);
            const diff = score(a) - score(b);
            if (diff !== 0) return diff;
            if (a.ACode !== b.ACode) return a.ACode < b.ACode ? -1 : 1;
            return (parseInt(digitsOf(a), 10) || 0) - (parseInt(digitsOf(b), 10) || 0);
        });
}

// D-A: the airline pin scopes the search — normalized to the GROUP level
// (BR covers B7, CI covers AE) because displayFlights overwrites currentACode
// with a tapped flight's own code (e.g. 'B7') and the pin must not silently
// narrow to a member code. Returns the member list or null for no pin.
function searchScopeGroup() {
    if (currentACode === null) return null;
    for (const members of Object.values(AIRLINE_GROUPS)) {
        if (members.includes(currentACode)) return members;
    }
    return null;
}

function toggleSearch() {
    if (searchOpen) closeSearch();
    else openSearch();
}

function openSearch() {
    searchOpen = true;
    document.getElementById('search-bar').hidden = false;
    document.getElementById('search-toggle').classList.add('active');
    updateSearchText();
    // Feed the departures store when searching from arrivals — one extra
    // request per refresh while search is open, the cost the owner accepted.
    if (currentFlightMode === 'A' && !fullDayByState.D && !searchDepUnavailable) {
        fetchSearchDepartures();
    }
    renderSearchResults();
    // Synchronous focus inside the click handler so iOS opens the keyboard.
    document.getElementById('search-input').focus();
    setSearchSession();
}

function closeSearch() {
    searchOpen = false;
    document.getElementById('search-bar').hidden = true;
    document.getElementById('search-toggle').classList.remove('active');
    document.getElementById('search-input').value = '';
    // Unhide the board — deliberately NO renderFilteredView() here: during a
    // mode-toggle fetch flight, flightData still holds the old mode's rows
    // and a re-render would pair them with the new mode's headers. The board
    // is already whatever it should be, loading text included.
    ['output', 'planeTypeButtons', 'flightButtons'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = false;
    });
    const results = document.getElementById('search-results');
    results.hidden = true;
    results.innerHTML = '';
    const status = document.getElementById('search-status');
    status.hidden = true;
    status.textContent = '';
    setSearchSession();
}

function onSearchInput() {
    const input = document.getElementById('search-input');
    document.getElementById('search-clear').hidden = input.value === '';
    setSearchSession();
    renderSearchResults();
}

function setSearchSession() {
    try {
        if (!searchOpen) {
            sessionStorage.removeItem(SEARCH_SESSION_KEY);
        } else {
            sessionStorage.setItem(SEARCH_SESSION_KEY, JSON.stringify({
                open: true,
                q: document.getElementById('search-input').value,
            }));
        }
    } catch { /* sessionStorage unavailable (privacy mode) — search still works */ }
}

// Restores { open, q } after the visibilitychange reload. Called between
// setupEventListeners() and detectLanguage(): the DOM exists, the mode is
// still A, and the open flag is set BEFORE fetchData decides whether to
// start the departures store fetch. Deliberately does NOT render results —
// the stores are empty until the fetch lands, and renderFilteredView's hook
// paints them then. No race.
function restoreSearchSession() {
    let saved = null;
    try {
        saved = JSON.parse(sessionStorage.getItem(SEARCH_SESSION_KEY) ?? 'null');
    } catch {
        return;
    }
    if (!saved?.open) return;
    searchOpen = true;
    document.getElementById('search-bar').hidden = false;
    document.getElementById('search-toggle').classList.add('active');
    const input = document.getElementById('search-input');
    input.value = String(saved.q ?? '');
    document.getElementById('search-clear').hidden = input.value === '';
}

// Localized placeholder / labels — language changes refetch and re-render
// the results, but the static bar attributes need their own update.
function updateSearchText() {
    const t = translations[currentLanguage].search;
    const label = document.querySelector('#search-bar .search-label');
    if (label) label.textContent = t.label;
    const input = document.getElementById('search-input');
    if (input) input.placeholder = t.placeholder;
    const toggle = document.getElementById('search-toggle');
    if (toggle) toggle.setAttribute('aria-label', t.open);
    const clear = document.getElementById('search-clear');
    if (clear) clear.setAttribute('aria-label', t.clear);
}

function setStatusLine(text) {
    const status = document.getElementById('search-status');
    if (!status) return;
    status.textContent = text;
    status.hidden = text === '';
}

// Board takeover: results render into #search-results while the query is
// non-empty; the board element and the two filter rows are hidden but keep
// receiving their normal writes from all seven existing writers. Closing
// search just unhides them — no re-render (see closeSearch).
function renderSearchResults() {
    const container = document.getElementById('search-results');
    if (!container || !searchOpen) return;

    const query = document.getElementById('search-input').value;
    const normalized = normalizeFlightQuery(query);
    const takeover = normalized.length > 0;

    // Owner feedback: the plane-type and flight-number rows collapse whenever
    // search is open — quick dial replaces them (query not even needed), and
    // they come back on close. The board hides only while a query is active.
    // (The window selector lives in the drawer now — search ignores it.)
    document.getElementById('flightButtons').hidden = true;
    document.getElementById('planeTypeButtons').hidden = true;
    document.getElementById('output').hidden = takeover;

    if (!takeover) {
        container.hidden = true;
        container.innerHTML = '';
        setStatusLine('');
        return;
    }

    const t = translations[currentLanguage];
    const today = getUTC8Date();
    const arrivals = fullDayByState.A ?? [];
    const departures = fullDayByState.D ?? [];
    const store = [...arrivals, ...departures];

    const scopeGroup = searchScopeGroup();
    const scopedStore = scopeGroup ? store.filter(f => scopeGroup.includes(f.ACode)) : store;
    const matches = matchFlights(scopedStore, query, today);
    const arrMatches = matches.filter(f => f.AState === 'A');
    const depMatches = matches.filter(f => f.AState === 'D');
    const capArr = arrMatches.slice(0, SEARCH_RESULT_CAP);
    const capDep = depMatches.slice(0, SEARCH_RESULT_CAP);

    const isSmall = isSmallScreen();
    let html = '';
    if (capArr.length) html += buildSearchTable(capArr, 'A', isSmall);
    if (capDep.length) html += buildSearchTable(capDep, 'D', isSmall);

    // Issue #130 review F3 — distinguish "stores not fetched yet" from a
    // successful-but-empty day: length checks would show an eternal loading
    // status for a genuinely empty day.
    const storesPending = fullDayByState.A === null && fullDayByState.D === null;

    // Nothing matched — distinguish "the pin is hiding it" from "genuinely
    // not flying today" by re-running the match without the pin.
    if (matches.length === 0 && !storesPending) {
        if (scopeGroup) {
            const unscoped = matchFlights(store, query, today);
            if (unscoped.length > 0) {
                const pinnedName = currentACode;
                html += `<div class="search-empty">`
                    + `<div>${escapeHtml(t.search.pinHint.replace('{aname}', pinnedName).replace('{query}', normalized))}</div>`
                    + `<button type="button" id="search-show-all" class="btn btn-sm btn-outline-secondary mt-2">${escapeHtml(t.search.showAllAirlines)}</button>`
                    + `</div>`;
            }
        }
        if (!html) {
            html += `<div class="search-empty">${escapeHtml(t.search.noMatch
                .replace('{query}', normalized)
                .replace('{date}', today))}</div>`;
        }
    }

    container.innerHTML = html;
    container.hidden = html === '';
    const showAll = document.getElementById('search-show-all');
    if (showAll) {
        showAll.addEventListener('click', () => {
            applyAirlineFilter(null);
        });
    }

    // Status line: counts, pending/unavailable notes for the departures store.
    let statusText = '';
    if (storesPending) {
        statusText = t.loading;
    } else if (matches.length > 0) {
        statusText = (arrMatches.length && depMatches.length)
            ? t.search.countBoth.replace('{a}', arrMatches.length).replace('{d}', depMatches.length)
            : t.search.countOne.replace('{n}', matches.length);
    } else if (html.includes('search-empty')) {
        statusText = '';
    }
    if (currentFlightMode === 'A' && !fullDayByState.D) {
        statusText = statusText
            ? `${statusText} · ${searchDepUnavailable ? t.search.departuresUnavailable : t.search.departuresPending}`
            : (searchDepUnavailable ? t.search.departuresUnavailable : t.search.departuresPending);
    }
    setStatusLine(statusText);
}

// One table per direction, mirroring displayFlights' column set exactly so
// the nth-child styling and the crew's muscle memory both carry over:
//   A: flight, origin, terminal, Gate, Carousel
//   D: flight, destination, terminal, Gate, ReturnGate
function buildSearchTable(rows, direction, isSmall) {
    const t = translations[currentLanguage];
    const headers = t.tableHeaders;
    const flightNumberHeader = isSmall ? headers["FlightNumberShort"] : headers["FlightNumber"];
    const cityHeader = direction === 'A'
        ? (isSmall ? headers["DepartureShort"] : headers["Departure"])
        : (isSmall ? headers["DestinationShort"] : headers["Destination"]);
    const terminalHeader = isSmall ? headers["TerminalShort"] : headers["Terminal"];
    const returnGateHeader = isSmall ? headers["ReturnGateShort"] : headers["ReturnGate"];
    const heading = direction === 'A' ? t.search.headingArrivals : t.search.headingDepartures;
    // thead tint follows the pin, same as the board. Allowlist against the
    // supported codes (issue #130 review F4): currentACode is cookie- and
    // API-derived, never interpolate it into markup unvalidated.
    const allGroupCodes = Object.values(AIRLINE_GROUPS).flat();
    const theadClass = currentACode && allGroupCodes.includes(currentACode)
        ? `table-${currentACode.toLowerCase()}`
        : (currentTheme === 'dark' ? 'table-secondary' : 'table-dark');
    // Return-gate pool: the full-day arrivals store minus cancelled rows,
    // NOT returnLegArrivals (which only exists in departures mode).
    const returnPool = (fullDayByState.A ?? []).filter(flight => !isCancelledFlight(flight));

    let table = `
    <table class="table table-sm table-striped table-borderless search-table">
        <caption class="caption-top">${escapeHtml(heading)}</caption>
        <thead class="${theadClass}">
            <tr>
                <th>${flightNumberHeader}</th>
                <th ${isSmall ? 'class="text-center"' : ''}>${cityHeader}</th>
                <th class="text-center">${terminalHeader}</th>
                <th class="text-center">${headers["Gate"]}</th>
                ${direction === 'A' ? `<th class="text-center">${headers["Carousel"]}</th>` : `<th class="text-center">${returnGateHeader}</th>`}
            </tr>
        </thead>
        <tbody>`;

    rows.forEach(flight => {
        const cancelled = isCancelledFlight(flight);
        const cityDisplay = isSmall ? flight.CityCode : (currentLanguage === 'zh' ? flight.CityName : flight.CityEname);
        const terminalDisplay = flight.BNO ? `T${flight.BNO}` : '';
        const displayFlightNo = `${flight.ACode}${flight.FlightNo}`.replace(/\s+/g, '');
        const logoImg = hasVendoredLogo(flight.ACode)
            ? `<img alt="" width="28" height="20" src="${LOGO_BASE_URL}${flight.ACode}.gif">`
            : '';
        const tba = `<span class="gate-tba">${escapeHtml(t.search.gateTba)}</span>`;
        const gateCell = cancelled ? '' : (flight.Gate ? escapeHtml(flight.Gate) : tba);
        const carouselCell = cancelled ? '' : (flight.StopCode ? escapeHtml(flight.StopCode) : tba);
        const returnCell = direction === 'D' && !cancelled
            ? buildReturnGateCellFrom(flight, returnPool, isSmall)
            : '';
        const chip = cancelled ? `<span class="status-chip">${escapeHtml(t.search.cancelled)}</span>` : '';

        table += `
            <tr class="${cancelled ? 'row-cancelled' : ''}">
                <td>${logoImg}${escapeHtml(displayFlightNo)}${chip}</td>
                <td ${isSmall ? 'class="text-center"' : ''}>${escapeHtml(cityDisplay)}</td>
                <td class="text-center">${escapeHtml(terminalDisplay)}</td>
                <td class="text-center">${gateCell}</td>
                ${direction === 'A' ? `<td class="text-center">${carouselCell}</td>` : `<td class="text-center">${returnCell}</td>`}
            </tr>`;
    });

    table += `</tbody></table>`;
    return table;
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
// Shared by the real board (`buildReturnGateCell`, dynamic data) and the
// About drawer's worked example (`buildDrawerExampleTable`, static example
// values) so the two markup shapes can't drift apart — see issue #62.
// Takes raw (unescaped) `returnFlightNo` / `gate` and escapes them itself —
// callers must not pre-escape, or the output double-escapes.
function formatReturnGateCell(returnFlightNo, gate, isSmall) {
    const safeGate = escapeHtml(gate);
    if (isSmall) {
        return `<span class="return-gate-cell">←&nbsp;${safeGate}</span>`;
    }
    const safeFlightNo = escapeHtml(returnFlightNo);
    return `<span class="return-gate-cell">←&nbsp;${safeFlightNo}&nbsp;${safeGate}</span>`;
}

function buildReturnGateCell(departureFlight, isSmall) {
    return buildReturnGateCellFrom(departureFlight, returnLegArrivals, isSmall);
}

// Issue #130 — parameterized variant: the board passes returnLegArrivals;
// the search table passes the full-day arrivals store (cancelled rows
// dropped, matching the pairing fetch's pool) so the column stays live in
// BOTH modes. Blank when no pool has arrived yet.
function buildReturnGateCellFrom(departureFlight, arrivalsPool, isSmall) {
    if (!arrivalsPool) return '';
    if (!dayReturn(departureFlight.ACode, departureFlight.CityCode)) return '';
    const returnLeg = findReturnLeg(departureFlight, arrivalsPool);
    if (!returnLeg || !returnLeg.Gate) return '';

    const returnFlightNo = `${returnLeg.ACode}${returnLeg.FlightNo}`.replace(/\s+/g, '');
    return formatReturnGateCell(returnFlightNo, returnLeg.Gate, isSmall);
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
        const displayFlightNo = `${flight.ACode}${flight.FlightNo}`.replace(/\s+/g, '');
        const logoImg = hasVendoredLogo(flight.ACode)
            ? `<img alt="" width="28" height="20" src="${LOGO_BASE_URL}${flight.ACode}.gif">`
            : '';

        tableContent += `
            <tr>
                <td>${logoImg}${displayFlightNo}</td>
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

// issue #102: encode on write / decode on read, changed together — encoding only the
// write would produce a value that no longer round-trips, and the failure would only
// surface for the first value that actually needs escaping (nobody's written one yet).
// Every value written today (BR / A321 / dark / zh) is encodeURIComponent-identity, so
// existing users' cookies stay byte-identical and keep parsing under the new decode —
// checked, not assumed (see src/test/cookie.test.js). getCookie() also splits on `;` to
// find a value's end, so an unencoded `;`/`,`/`=`/space in a future value would corrupt
// not just that cookie but the parse of whichever cookie follows it in the jar.
function setCookie(name, value, days = 400) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)};${expires};path=/`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length !== 2) return undefined;
    const raw = parts.pop().split(";").shift();
    // gemini-code-assist review on #106: cookies are a boundary this app doesn't fully
    // control (hand-edited via devtools, another script/extension on the same origin, or
    // simply predating this encode/decode pair) — a malformed percent-encoded value would
    // throw a URIError, and getCookie() runs during init (restoring pins on cold load), so
    // an uncaught throw here could break app boot entirely over one bad cookie. Fall back
    // to the raw value rather than crash; a malformed value was never going to match
    // anything meaningful downstream regardless.
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

function deleteCookie(name) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

function checkCookie(name) {
    return !!getCookie(name);
}

// issue #102: the set of persisted cookies used to exist only as this function's own
// forEach argument — a hand-maintained list nothing else read. Declaring it once here
// and having a test (src/test/cookie.test.js) assert every setCookie() call site's
// cookie-name constant is covered by it means a persisted cookie added without also
// registering it for renewal is a failing test, not a silent 400-day-later expiry.
const PERSISTED_COOKIE_NAMES = [COOKIE_NAME, PLANE_TYPE_COOKIE_NAME, THEME_COOKIE_NAME, LANGUAGE_COOKIE_NAME, FORWARD_HOURS_COOKIE_NAME];

function renewPins() {
    PERSISTED_COOKIE_NAMES.forEach(name => {
        const value = getCookie(name);
        if (value !== undefined) setCookie(name, value);
    });
}

// Issue #62 review: the drawer's worked example is built once, at open
// time, from isSmallScreen() — so it goes stale (wrong column count, stale
// header variant) if the viewport crosses the 768px breakpoint while the
// drawer is already open (device rotation, desktop window resize). Guarded
// on the breakpoint actually flipping, not on every resize tick, because
// renderDrawerBody() replaces #about-drawer-body's innerHTML wholesale —
// firing it on every pixel of a resize would wipe live drawer state
// (the "copied" share confirmation, install-button focus) mid-interaction.
let lastIsSmall = isSmallScreen();
function handleViewportChange() {
    const nowSmall = isSmallScreen();
    if (nowSmall === lastIsSmall) return;
    lastIsSmall = nowSmall;
    const drawerEl = document.getElementById('about-drawer');
    if (drawerEl?.classList.contains('show')) renderDrawerBody();
}

function setupEventListeners() {
    // Render the drawer body lazily, right as Bootstrap starts opening it,
    // rather than eagerly on every page load / language change — see the
    // comment on updateDrawerText() for why (a second <table> in the DOM
    // at all times broke unrelated e2e tests).
    document.getElementById('about-drawer')?.addEventListener('show.bs.offcanvas', renderDrawerBody);

    // Issue #88 — time-window selector
    document.getElementById('time-window-toggle')?.addEventListener('click', cycleTimeWindow);

    // Issue #130 — quick-dial search wiring.
    const searchToggle = document.getElementById('search-toggle');
    searchToggle.addEventListener('click', () => toggleSearch());
    searchToggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleSearch();
        }
    });
    document.getElementById('search-input').addEventListener('input', onSearchInput);
    document.getElementById('search-form').addEventListener('submit', (event) => {
        // Enter on a bare form navigates; blur instead — it just dismisses
        // the keyboard, which is all a search "submit" means here.
        event.preventDefault();
        document.getElementById('search-input').blur();
    });
    document.getElementById('search-clear').addEventListener('click', () => {
        const input = document.getElementById('search-input');
        input.value = '';
        onSearchInput();
        input.focus();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && searchOpen) closeSearch();
    });

    window.addEventListener('resize', () => {
        if (currentFilteredFlights.length > 0 && currentACode) {
            displayFlights(currentFilteredFlights, currentACode);
        }
        handleViewportChange();
        // Short/long headers flip with the breakpoint — re-render the tables.
        if (searchOpen) renderSearchResults();
    });

    window.addEventListener('orientationchange', () => {
        if (currentFilteredFlights.length > 0 && currentACode) {
            displayFlights(currentFilteredFlights, currentACode);
        }
        handleViewportChange();
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
        // Issue #130 — a drag inside the search input places the text cursor;
        // it must not arm the pull-to-refresh pill.
        if (event.target.closest('#search-bar')) return;
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
    // Issue #130 — restore { open, q } AFTER the listeners exist and BEFORE
    // detectLanguage() (which triggers the first fetch): state only, no
    // render — renderFilteredView's hook paints the results when the data
    // lands. The visibilitychange reload re-enters through this same path.
    // Issue #130 follow-up — the window selection is cookie-persisted
    // (owner decision, superseding #88's in-memory D3): restore before the
    // first fetch so the boot board and the footer Range line match the
    // cookie. Invalid values fall back to +2.
    const savedHours = parseInt(getCookie(FORWARD_HOURS_COOKIE_NAME) ?? '', 10);
    if (FORWARD_HOURS_OPTIONS.includes(savedHours)) {
        currentForwardHours = savedHours;
    }
    restoreSearchSession();
    detectLanguage();
    initTheme();
    updateLanguageLinks();
    updateAirlineLinks();
}

// Run the app
initApp();