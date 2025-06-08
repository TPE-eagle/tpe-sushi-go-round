import { describe, it, expect, vi, beforeEach } from 'vitest'
import { 
    createApiPostData, 
    parseApiResponse, 
    filterFlightsByTime,
    getTimeWindow,
    getTimeWindowConfig,
    formatToUTC8_HHMM,
    getUTC8Date
} from '../utils/flightUtils.js'

// Test flight data (based on actual BR35 case)
const mockFlightData = [
    {
        "id": "20250608_A_BR35",
        "BNO": 2,
        "AState": "A",
        "ACode": "BR",
        "AName": "長榮航空",
        "FlightNo": "35",
        "Gate": "C3",
        "ODate": "2025/06/08",
        "OTime": "05:05:00",
        "RDate": "2025/06/08",
        "RTime": "05:39:18",
        "CityCode": "YYZ",
        "CityEname": "Toronto",
        "CityName": "多倫多",
        "Memo": "已到",
        "PlaneNo": "B777-300",
        "StopCityCode": "",
        "StopEname": "",
        "StopCname": "",
        "StopCode": "05",
        "CheckIn": "",
        "CurrentStatus": "抵達機坪",
        "updateDate": "2025-06-07T23:45:06.576Z",
        "sharing": [],
        "flightCode": "BR35",
        "check": false
    },
    {
        "id": "20250608_A_BR88",
        "BNO": 2,
        "AState": "A",
        "ACode": "BR",
        "AName": "長榮航空",
        "FlightNo": "88",
        "Gate": "C7",
        "ODate": "2025/06/08",
        "OTime": "06:55:00",
        "RDate": "2025/06/08",
        "RTime": "06:33:53",
        "CityCode": "CDG",
        "CityEname": "Paris",
        "CityName": "巴黎",
        "Memo": "已到",
        "PlaneNo": "B777-300",
        "StopCityCode": "",
        "StopEname": "",
        "StopCname": "",
        "StopCode": "07",
        "CheckIn": "",
        "CurrentStatus": "抵達機坪",
        "updateDate": "2025-06-07T23:45:06.926Z",
        "sharing": [],
        "flightCode": "BR88",
        "check": false
    },
    {
        "id": "20250608_A_CI786",
        "BNO": 1,
        "AState": "A",
        "ACode": "CI",
        "AName": "中華航空",
        "FlightNo": "786",
        "Gate": "",
        "ODate": "2025/06/08",
        "OTime": "06:45:00",
        "RDate": "2025/06/08",
        "RTime": null,
        "CityCode": "SGN",
        "CityEname": "Ho Chi Minh",
        "CityName": "胡志明市",
        "Memo": "取消",
        "PlaneNo": "-",
        "StopCityCode": "",
        "StopEname": "",
        "StopCname": "",
        "StopCode": "",
        "CheckIn": "",
        "CurrentStatus": "",
        "updateDate": "2025-06-07T23:45:24.246Z",
        "sharing": [],
        "flightCode": "CI786",
        "check": false
    },
    {
        "id": "20250608_A_XX123", // Unsupported airline
        "BNO": 1,
        "AState": "A",
        "ACode": "XX",
        "AName": "測試航空",
        "FlightNo": "123",
        "Gate": "A1",
        "ODate": "2025/06/08",
        "OTime": "06:00:00",
        "RDate": "2025/06/08",
        "RTime": "06:00:00",
        "CityCode": "TEST",
        "CityEname": "Test City",
        "CityName": "測試城市",
        "Memo": "已到",
        "PlaneNo": "B737",
        "StopCityCode": "",
        "StopEname": "",
        "StopCname": "",
        "StopCode": "01",
        "CheckIn": "",
        "CurrentStatus": "抵達機坪",
        "updateDate": "2025-06-07T23:45:06.000Z",
        "sharing": [],
        "flightCode": "XX123",
        "check": false
    }
];

describe('API Post Data Creation', () => {
    it('should create correct API post data structure', () => {
        const postData = createApiPostData('A', 'zh');
        
        expect(postData).toEqual({
            "ODate": expect.stringMatching(/^\d{4}\/\d{2}\/\d{2}$/),
            "OTimeOpen": null,
            "OTimeClose": null,
            "BNO": null,
            "AState": "A",
            "language": "ch",
            "keyword": ""
        });
    });

    it('should handle different languages correctly', () => {
        expect(createApiPostData('A', 'zh').language).toBe('ch');
        expect(createApiPostData('A', 'en').language).toBe('en');
        expect(createApiPostData('A', 'jp').language).toBe('jp');
    });

    it('should handle departure mode', () => {
        const postData = createApiPostData('D', 'en');
        expect(postData.AState).toBe('D');
    });

    it('should always keep time parameters as null', () => {
        const postData = createApiPostData('A', 'zh');
        expect(postData.OTimeOpen).toBeNull();
        expect(postData.OTimeClose).toBeNull();
    });
});

describe('Time Window Logic', () => {
    const fixedTime = new Date('2025-06-08T06:00:00+08:00'); // 6:00 AM UTC+8

    it('should calculate correct time window for arrival mode', () => {
        const config = getTimeWindowConfig('A');
        const { windowStart, windowEnd } = getTimeWindow(config, fixedTime);
        
        // Arrival mode: 6:00 -> round down to 6:00 -> go back 40 minutes = start at 5:20, duration 120 minutes to 7:20
        expect(formatToUTC8_HHMM(windowStart)).toBe('05:20');
        expect(formatToUTC8_HHMM(windowEnd)).toBe('07:20');
    });

    it('should calculate correct time window for departure mode', () => {
        const config = getTimeWindowConfig('D');
        const { windowStart, windowEnd } = getTimeWindow(config, fixedTime);
        
        // Departure mode: 6:00 -> round down to 6:00 -> start from 6:00, duration 120 minutes to 8:00
        expect(formatToUTC8_HHMM(windowStart)).toBe('06:00');
        expect(formatToUTC8_HHMM(windowEnd)).toBe('08:00');
    });

    it('should handle time rounding correctly', () => {
        const testCases = [
            { input: '06:05:30', expected: '05:20' }, // 6:05 -> 6:00 -> 5:20 (arrival)
            { input: '06:15:45', expected: '05:30' }, // 6:15 -> 6:10 -> 5:30 (arrival)
            { input: '06:59:59', expected: '06:10' }, // 6:59 -> 6:50 -> 6:10 (arrival)
        ];

        testCases.forEach(({ input, expected }) => {
            const testTime = new Date(`2025-06-08T${input}+08:00`);
            const config = getTimeWindowConfig('A');
            const { windowStart } = getTimeWindow(config, testTime);
            expect(formatToUTC8_HHMM(windowStart)).toBe(expected);
        });
    });
});

describe('Flight Time Filtering', () => {
    const testTime = new Date('2025-06-08T06:00:00+08:00'); // 6:00 AM, window should be 5:20-7:20

    it('should filter BR35 correctly (actual time in range)', () => {
        const filtered = filterFlightsByTime(mockFlightData, 'A', testTime);
        const br35 = filtered.find(f => f.flightCode === 'BR35');
        
        // BR35: OTime 05:05 (outside range), RTime 05:39 (within range) -> should be displayed
        expect(br35).toBeDefined();
        expect(br35.OTime).toBe('05:05:00');
        expect(br35.RTime).toBe('05:39:18');
    });

    it('should filter BR88 correctly (both times in range)', () => {
        const filtered = filterFlightsByTime(mockFlightData, 'A', testTime);
        const br88 = filtered.find(f => f.flightCode === 'BR88');
        
        // BR88: OTime 06:55 (within range), RTime 06:33 (within range) -> should be displayed
        expect(br88).toBeDefined();
    });

    it('should handle null RTime correctly', () => {
        const testFlight = [{
            ...mockFlightData[0],
            flightCode: 'TEST',
            OTime: '06:00:00',
            RTime: null
        }];
        
        const filtered = filterFlightsByTime(testFlight, 'A', testTime);
        expect(filtered).toHaveLength(1); // Should be displayed because OTime is within range
    });

    it('should exclude flights completely outside range', () => {
        const outsideFlight = [{
            ...mockFlightData[0],
            flightCode: 'OUTSIDE',
            ODate: '2025/06/08',
            OTime: '03:00:00', // Too early
            RDate: '2025/06/08',
            RTime: '03:30:00'  // Also too early
        }];
        
        const filtered = filterFlightsByTime(outsideFlight, 'A', testTime);
        expect(filtered).toHaveLength(0);
    });
});

describe('Full API Response Parsing', () => {
    const testTime = new Date('2025-06-08T06:00:00+08:00');

    it('should apply all filters correctly', () => {
        const parsed = parseApiResponse(mockFlightData, 'A', testTime);
        
        // Should include BR35 and BR88, exclude cancelled CI786 and unsupported XX123
        expect(parsed).toHaveLength(2);
        expect(parsed.find(f => f.flightCode === 'BR35')).toBeDefined();
        expect(parsed.find(f => f.flightCode === 'BR88')).toBeDefined();
        expect(parsed.find(f => f.flightCode === 'CI786')).toBeUndefined(); // Cancelled
        expect(parsed.find(f => f.flightCode === 'XX123')).toBeUndefined(); // Unsupported airline
    });

    it('should maintain correct sorting', () => {
        const parsed = parseApiResponse(mockFlightData, 'A', testTime);
        
        // Should be sorted by airline code and flight number
        expect(parsed[0].ACode).toBe('BR');
        expect(parsed[1].ACode).toBe('BR');
        
        // Within same airline, sort by flight number
        const brFlights = parsed.filter(f => f.ACode === 'BR');
        expect(parseInt(brFlights[0].FlightNo)).toBeLessThan(parseInt(brFlights[1].FlightNo));
    });
});

describe('BR35 Regression Test', () => {
    // Regression test specifically for BR35 display issue
    it('should display BR35 when viewed at 6:00 AM', () => {
        const viewTime = new Date('2025-06-08T06:00:00+08:00');
        const br35Data = [mockFlightData[0]]; // Only BR35
        
        const result = parseApiResponse(br35Data, 'A', viewTime);
        
        expect(result).toHaveLength(1);
        expect(result[0].flightCode).toBe('BR35');
        expect(result[0].OTime).toBe('05:05:00'); // Scheduled time outside range
        expect(result[0].RTime).toBe('05:39:18'); // Actual time within range
    });

    it('should correctly identify why BR35 appears', () => {
        const viewTime = new Date('2025-06-08T06:00:00+08:00');
        const config = getTimeWindowConfig('A');
        const { windowStart, windowEnd } = getTimeWindow(config, viewTime);
        
        // Verify time window
        expect(formatToUTC8_HHMM(windowStart)).toBe('05:20');
        expect(formatToUTC8_HHMM(windowEnd)).toBe('07:20');
        
        // Verify BR35 times
        const br35 = mockFlightData[0];
        const ODateTime = new Date(`${br35.ODate.replace(/\//g, '-')}T${br35.OTime}+08:00`);
        const RDateTime = new Date(`${br35.RDate.replace(/\//g, '-')}T${br35.RTime}+08:00`);
        
        const isODateTimeInRange = ODateTime >= windowStart && ODateTime <= windowEnd;
        const isRDateTimeInRange = RDateTime >= windowStart && RDateTime <= windowEnd;
        
        expect(isODateTimeInRange).toBe(false); // Scheduled time outside range
        expect(isRDateTimeInRange).toBe(true);  // Actual time within range
        expect(isODateTimeInRange || isRDateTimeInRange).toBe(true); // Should be displayed
    });
});