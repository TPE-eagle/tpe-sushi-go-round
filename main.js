import './style.css'
import * as bootstrap from 'bootstrap'
// import javascriptLogo from './javascript.svg'
// import viteLogo from '/vite.svg'

let flightData = [];  // 儲存所有撈取的航班資料
let currentFilteredFlights = [];  // 儲存當前過濾的航空公司航班
let currentLanguage = 'zh';  // 預設語言為繁體中文

// 定義翻譯字典
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
        "description": "Airport screens too small? Don’t sweat it – just use your phone to find your bags like a boss. 😎",
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

// 更新頁面上的文字
function updateLanguageText() {
    document.getElementById("refresh-icon").innerText = translations[currentLanguage]["refreshing"];
    document.getElementById("title").innerText = translations[currentLanguage]["title"];

    // 動態更新 Open Graph 和 Twitter Meta 標籤
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    
    const title = translations[currentLanguage]["title"];
    const description = translations[currentLanguage]["description"];

    // 更新 Open Graph 和 Twitter Meta 標籤
    ogTitle.setAttribute('content', title);
    ogDescription.setAttribute('content', description);
    twitterTitle.setAttribute('content', title);
    twitterDescription.setAttribute('content', description);
}

// 自動偵測使用者瀏覽器語言
function detectLanguage() {
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang.startsWith("zh")) {
        currentLanguage = 'zh';  // 設置為中文
    } else if (browserLang.startsWith("ja")) {
        currentLanguage = 'jp';  // 設置為日文
    } else {
        currentLanguage = 'en';  // 設置為英文
    }
    changeLanguageFont();
    updateLanguageText();  // 更新頁面文字和 meta 標籤
    fetchData(); // 根據偵測到的語言重新載入資料
    updateApiParams(); // 更新 API 查詢參數顯示
}

function changeLanguageFont(){
    const body = document.body;
    let fontLink = "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@100..900&display=swap";
    // Remove all noto-sans classes
    body.classList.remove('noto-sans', 'noto-sans-tc', 'noto-sans-jp');
    if (currentLanguage == 'zh') {
        fontLink = "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100..900&display=swap";
        body.classList.add('noto-sans-tc');
    } else if (currentLanguage == 'jp') {
        fontLink = "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap";
        body.classList.add('noto-sans-jp');
    }else{
        body.classList.add('noto-sans');
    }
    document.getElementById('dynamic-font').innerHTML = `@import url('${fontLink}');`; // 切換字形
}

// 切換語言
function changeLanguage(lang) {
    currentLanguage = lang;
    changeLanguageFont();
    updateLanguageText();  // 更新頁面文字和 meta 標籤
    fetchData();  // 重新發送請求
    updateApiParams();  // 更新 API 查詢參數顯示
    document.getElementById("flightButtons").innerHTML = "";  // 清空 flightButtons 區域
}

// Helper: 取得當前的 UTC+8 日期，格式為 "YYYY/MM/DD"
function getUTC8Date() {
    const nowUTC = new Date(new Date().toISOString());
    const utc8Time = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000); // 轉換為 UTC+8
    return utc8Time.toISOString().split('T')[0].replace(/-/g, '/'); // 將日期中的 "-" 替換為 "/"
}

// Helper: 取得當前 UTC+8 的時間範圍
function getCurrentTimeRangeInUTC8() {
    const nowUTC = new Date(new Date().toISOString()); 
    const utc8Time = new Date(nowUTC.getTime() + 8 * 60 * 60 * 1000); 

    const minutes = utc8Time.getUTCMinutes();
    const hours = utc8Time.getUTCHours();

    // OTimeOpen 為當前時間往前 60 分鐘取整數
    const openHours = (minutes >= 0 && minutes <= 59) ? hours - 1 : hours;
    const OTimeOpen = `${openHours.toString().padStart(2, '0')}:00`;

    // OTimeClose 為當前時間往後的整數小時59分
    const OTimeClose = `${hours.toString().padStart(2, '0')}:59`;

    return {
        start: OTimeOpen,
        end: OTimeClose
    };
}


// 更新 API 查詢參數顯示
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
        "ODate": getUTC8Date(), // 只需要當天的日期
        "OTimeOpen": null,
        "OTimeClose": null,
        "BNO": null,
        "AState": "A",
        "language": currentLanguage === "zh" ? "ch" : currentLanguage,
        "keyword": ""
    };

    fetch("https://www.taoyuan-airport.com/api/api/flight/a_flight", {
        body: JSON.stringify(postData),
        cache: "default",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Content-Type": "application/json",
        },
        method: "POST",
        mode: "cors",
        redirect: "follow",
        referrerPolicy: "strict-origin-when-cross-origin"
    })
    .then(response => response.json())
    .then(data => {
        // 先透過航空公司 (ACode) 進行排序，再透過航班號碼 (FlightNo) 進行排序
        data.sort((a, b) => {
            // 先比較 ACode
            if (a.ACode < b.ACode) return -1;
            if (a.ACode > b.ACode) return 1;
            // 如果 ACode 相同，則比較 FlightNo
            const flightNumberA = parseInt(a.FlightNo.match(/\d+/), 10); // 提取航班號中的數字
            const flightNumberB = parseInt(b.FlightNo.match(/\d+/), 10); // 提取航班號中的數字
            return flightNumberA - flightNumberB; // 按數字順序排序
        });


        flightData = data.filter(flight =>
            (flight.ACode === 'BR' || flight.ACode === 'CI' || flight.ACode === 'JX') &&
            (flight.Memo && !flight.Memo.toLowerCase().includes("取消") && !flight.Memo.toLowerCase().includes("cancelled"))
        );

        // 先過濾取消航班，再過濾時間範圍內的航班
        flightData = filterFlightsByTime(flightData);

        generateAirlineLinks(flightData); // 動態生成航空公司按鈕
        let ACode = null;
        if(checkCookie('ACode')) {
            ACode = getCookie('ACode')
        }
        filterFlights(ACode)
        // displayFlights(flightData); // 顯示航班
    })
    .catch(error => {
        console.error('Error:', error);
        document.getElementById("output").innerText = translations[currentLanguage]["error"];
    });
}

function generateAirlineLinks(flights) {
    let airlines = {};

    // 遍歷航班數據，收集航空公司信息
    flights.forEach(flight => {
        if (!airlines[flight.ACode]) {
            airlines[flight.ACode] = flight.AName + ` (${flight.ACode})`;
        }
    });

    let linksHTML = `
                <a href="javascript:void(0);" onclick="filterFlights()" class="airline-link">
                    <span style="font-size:20px; width:28px;">🛬</span>
                    <span class="airline-full">${translations[currentLanguage]["allFlights"]}</span>
                    <span class="airline-short">${translations[currentLanguage]["allFlightsShort"]}</span>
                </a>`;

    // 只處理 BR, CI, JX
    const airlineCodes = ['BR', 'CI', 'JX'];

    // 按順序生成航空公司按鈕，只顯示 BR, CI, JX
    airlineCodes.forEach(code => {
        if (airlines[code]) {
            const logoUrl = `https://www.taoyuan-airport.com/uploads/airlogo/${code}.gif`;
            linksHTML += `
                <a href="javascript:void(0);" onclick="filterFlights('${code}')" class="airline-link">
                    <img alt="${code} Logo" width="28" height="20" src="${logoUrl}">
                    <span class="airline-full">${airlines[code]}</span>
                    <span class="airline-short">${code}</span>
                </a>`;
        }
    });

    document.getElementById('airlineButtons').innerHTML = linksHTML;
}

// 根據 ACode 過濾航班資料並顯示結果到表格，並生成航班號按鈕
function filterFlights(airlineCode=null) {
    if(airlineCode!=null){
        setCookie('ACode', airlineCode);
        currentFilteredFlights = flightData.filter(flight => flight.ACode === airlineCode);
    }else{
        deleteCookie('ACode')
        currentFilteredFlights = flightData;
    }

    if (currentFilteredFlights.length === 0) {
        document.getElementById("output").innerHTML = `
            <div class="text-center">
                ${translations[currentLanguage]["noFlights"]}
            </div>`;
        document.getElementById("flightButtons").innerHTML = ""; // 清空航班號按鈕
    } else {
        if(airlineCode!=null){
            generateFlightNumberButtons(currentFilteredFlights);  // 生成航班號按鈕
        }else{
            document.getElementById("flightButtons").innerHTML = "";  // 清空 flightButtons 區域
        }
        displayFlights(currentFilteredFlights, airlineCode);  // 傳遞 airlineCode 作為 ACode 參數
    }
}

function filterFlightsByTime(flights) {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);  // 過去1小時
    const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000); // 未來1小時

    return flights.filter(flight => {
        const ODateTime = new Date(`${flight.ODate.replace(/\//g, '-')}T${flight.OTime}`);
        const RDateTime = flight.RDate && flight.RTime ? new Date(`${flight.RDate.replace(/\//g, '-')}T${flight.RTime}`) : null;

        // 判断 ODate+OTime 或 RDate+RTime 是否在過去一小時和未來一小時之間
        return (ODateTime >= oneHourAgo && ODateTime <= oneHourLater) ||
            (RDateTime && RDateTime >= oneHourAgo && RDateTime <= oneHourLater);
    });
}

// 根據具體的 FlightNo 生成航班號按鈕
function generateFlightNumberButtons(flights) {
    // 將航班按數字順序排序
    flights.sort((a, b) => parseInt(a.FlightNo) - parseInt(b.FlightNo));

    let flightButtonContent = "";
    flights.forEach(flight => {
        let btnClass = flight.ACode === 'BR' ? 'btn-outline-br' :
                    flight.ACode === 'CI' ? 'btn-outline-ci' :
                    'btn-outline-jx';  // 為 JX 設置按鈕樣式
        flightButtonContent += `<a href="javascript:void(0);" class="btn ${btnClass} ${isSmallScreen()?'btn-sm':''} btn-no-hover m-1" onclick="filterFlightByNumber('${flight.FlightNo}', '${flight.ACode}')">${flight.FlightNo}</a>`;
    });

    document.getElementById("flightButtons").innerHTML = flightButtonContent;
}

// 根據具體的 FlightNo 過濾航班
function filterFlightByNumber(flightNumber, ACode) {
    // 清除所有航班按鈕的 active 狀態
    document.querySelectorAll("#flightButtons a").forEach(button => {
        button.classList.remove('active');
    });

    // 將當前點擊的按鈕設置為 active
    const activeButton = document.querySelector(`a[onclick="filterFlightByNumber('${flightNumber}', '${ACode}')"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }

    // 根據選擇的航班號顯示過濾後的表格
    const filteredFlight = currentFilteredFlights.filter(flight => flight.FlightNo === flightNumber);
    displayFlights(filteredFlight, ACode);
}

// 聲明全局變量，保存當前的 ACode 和當前語言
let currentACode = null;

// 判斷是否為小屏幕
function isSmallScreen() {
    return window.innerWidth <= 768;
}

// 根據屏幕大小更新表頭並顯示表格
function displayFlights(flights, ACode) {
    document.getElementById('refresh-icon').style.display = 'none';
    currentACode = ACode;

    // 判斷當前屏幕大小以決定表頭顯示
    const flightNumberHeader = isSmallScreen()
        ? translations[currentLanguage]["tableHeaders"]["FlightNumberShort"]
        : translations[currentLanguage]["tableHeaders"]["FlightNumber"];

    const departureHeader = isSmallScreen()
        ? translations[currentLanguage]["tableHeaders"]["DepartureShort"]
        : translations[currentLanguage]["tableHeaders"]["Departure"];

    const terminalHeader = isSmallScreen()
        ? translations[currentLanguage]["tableHeaders"]["TerminalShort"]
        : translations[currentLanguage]["tableHeaders"]["Terminal"];

    const carouselHeader = isSmallScreen()
        ? translations[currentLanguage]["tableHeaders"]["CarouselShort"]
        : translations[currentLanguage]["tableHeaders"]["Carousel"];

    let airlineClass = 'table-dark';  // 預設為 table-dark
    if (ACode === 'BR') {
        airlineClass = 'table-br';
    } else if (ACode === 'CI') {
        airlineClass = 'table-ci';
    } else if (ACode === 'JX') {
        airlineClass = 'table-jx';  // 為 JX 設置表格樣式
    }

    let tableContent = `
    <table class="table table-sm table-striped table-borderless">
        <thead class="${airlineClass}">
            <tr>
                <th>${flightNumberHeader}</th>
                <th ${isSmallScreen() ? 'class="text-center"' : ''}>${departureHeader}</th>
                <th class="text-center">${terminalHeader}</th>
                <th class="text-center">${translations[currentLanguage]["tableHeaders"]["Gate"]}</th>
                <th class="text-center">${carouselHeader}</th>
            </tr>
        </thead>
        <tbody>`;

    flights.forEach(flight => {
        const cityDisplay = isSmallScreen() ? flight.CityCode : (currentLanguage === 'zh' ? flight.CityName : flight.CityEname);
        const terminalDisplay = flight.BNO ? `T${flight.BNO}` : '';
        const logoUrl = `https://www.taoyuan-airport.com/uploads/airlogo/${flight.ACode}.gif`;
        const displayFlightNo = `${flight.ACode}${flight.FlightNo}`.replace(/\s+/g, '');

        tableContent += `
            <tr>
                <td><img alt="" width="28" height="20" src="${logoUrl}">${displayFlightNo}</td>
                <td ${isSmallScreen() ? 'class="text-center"' : ''}>${cityDisplay}</td>
                <td class="text-center">${terminalDisplay}</td>
                <td class="text-center">${flight.Gate}</td>
                <td class="text-center">${flight.StopCode}</td>
            </tr>`;
    });

    tableContent += `</tbody></table>`;

    if(flights.length === 0){
        document.getElementById("output").innerHTML = `
            <div class="text-center">
                ${translations[currentLanguage]["noFlights"]}
            </div>`;
    }else{
        document.getElementById("output").innerHTML = tableContent;
    }
}

function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

function getCookie(name) {
    const value = "; " + document.cookie;
    const parts = value.split("; " + name + "=");
    if (parts.length === 2) return parts.pop().split(";").shift();
}

function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

function checkCookie(name) {
    const cookie = getCookie(name);
    return cookie ? true : false;
}

// 監聽窗口大小變化並重新渲染表格
window.addEventListener('resize', function() {
    if (currentFilteredFlights.length > 0 && currentACode) {
        displayFlights(currentFilteredFlights, currentACode); // 使用保存的ACode重新渲染
    }
});

// Safari 支援的 orientationchange 事件
window.addEventListener('orientationchange', function() {
    if (currentFilteredFlights.length > 0 && currentACode) {
        displayFlights(currentFilteredFlights, currentACode); // 使用保存的ACode重新渲染
    }
});

// 頁面加載時自動偵測語言並加載航班資料
window.onload = function() {
    detectLanguage();  // 自動偵測語言並初始化
};

document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
        window.location.reload();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    let startY = 0; // 開始滑動的 Y 座標
    let isPulling = false; // 判斷是否在下拉
    const refreshThreshold = 200; // 下拉多少距離觸發刷新
    const refreshIcon = document.getElementById('refresh-icon');

    // 偵測手指觸碰開始
    document.addEventListener('touchstart', (event) => {
        if (window.scrollY === 0) {
            startY = event.touches[0].clientY;
            isPulling = true;
        }
    });

    // 偵測手指移動
    document.addEventListener('touchmove', (event) => {
        if (isPulling) {
            const currentY = event.touches[0].clientY;
            const distance = currentY - startY;

            if (distance > refreshThreshold) {
                refreshIcon.style.display = 'block'; // 顯示刷新圖示
            } else {
                refreshIcon.style.display = 'none'; // 隱藏圖示
            }
        }
    });

    // 偵測手指離開螢幕
    document.addEventListener('touchend', () => {
        if (isPulling) {
            if (refreshIcon.style.display === 'block') {
                // 觸發刷新邏輯
                triggerRefresh();
            }
            isPulling = false;
        }
    });

    function triggerRefresh() {
        refreshIcon.style.display = 'block';
        fetchData();
        setTimeout(() => {
            // 模擬刷新完成後隱藏圖示
            refreshIcon.style.display = 'none';
        }, 1500); // 模擬延遲 1.5 秒
    }
});
