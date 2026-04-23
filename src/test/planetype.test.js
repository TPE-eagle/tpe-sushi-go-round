import { describe, it, expect } from 'vitest'
import {
    extractPlaneFamily,
    getAvailableFamilies,
    filterByPlaneType
} from '../utils/flightUtils.js'

describe('extractPlaneFamily', () => {
    it('extracts family from real BR/CI/JX variants', () => {
        expect(extractPlaneFamily('A321-200')).toBe('A321')
        expect(extractPlaneFamily('A321-271N')).toBe('A321')
        expect(extractPlaneFamily('A321-271')).toBe('A321')
        expect(extractPlaneFamily('A321-252NX')).toBe('A321')
        expect(extractPlaneFamily('A330-300')).toBe('A330')
        expect(extractPlaneFamily('A330-900')).toBe('A330')
        expect(extractPlaneFamily('A350-900')).toBe('A350')
        expect(extractPlaneFamily('A350-1000')).toBe('A350')
        expect(extractPlaneFamily('B777-300')).toBe('B777')
        expect(extractPlaneFamily('B777-300ER')).toBe('B777')
        expect(extractPlaneFamily('B787-9')).toBe('B787')
        expect(extractPlaneFamily('B787-10')).toBe('B787')
        expect(extractPlaneFamily('B737-800')).toBe('B737')
    })

    it('returns null for TBD values', () => {
        expect(extractPlaneFamily('')).toBeNull()
        expect(extractPlaneFamily('-')).toBeNull()
        expect(extractPlaneFamily(null)).toBeNull()
        expect(extractPlaneFamily(undefined)).toBeNull()
        expect(extractPlaneFamily('  ')).toBeNull()
    })

    it('returns null for unparseable strings', () => {
        expect(extractPlaneFamily('CRJ-900')).toBeNull()
        expect(extractPlaneFamily('unknown')).toBeNull()
    })

    it('trims surrounding whitespace', () => {
        expect(extractPlaneFamily(' A330-300 ')).toBe('A330')
    })
})

describe('getAvailableFamilies', () => {
    const flights = [
        { PlaneNo: 'A321-200' },
        { PlaneNo: 'A321-271N' },
        { PlaneNo: 'B777-300ER' },
        { PlaneNo: 'B787-9' },
        { PlaneNo: 'A330-300' },
        { PlaneNo: '-' },
        { PlaneNo: '' }
    ]

    it('returns sorted unique families', () => {
        expect(getAvailableFamilies(flights)).toEqual(['A321', 'A330', 'B777', 'B787'])
    })

    it('ignores TBD entries', () => {
        const tbdOnly = [{ PlaneNo: '-' }, { PlaneNo: '' }, { PlaneNo: null }]
        expect(getAvailableFamilies(tbdOnly)).toEqual([])
    })

    it('handles empty input', () => {
        expect(getAvailableFamilies([])).toEqual([])
    })
})

describe('filterByPlaneType', () => {
    const flights = [
        { FlightNo: '1', PlaneNo: 'A330-300' },
        { FlightNo: '2', PlaneNo: 'A330-900' },
        { FlightNo: '3', PlaneNo: 'B777-300ER' },
        { FlightNo: '4', PlaneNo: '-' },
        { FlightNo: '5', PlaneNo: '' }
    ]

    it('returns all flights when no family is specified', () => {
        expect(filterByPlaneType(flights, null)).toHaveLength(5)
        expect(filterByPlaneType(flights, '')).toHaveLength(5)
    })

    it('returns flights of the matching family plus TBD ones', () => {
        const a330 = filterByPlaneType(flights, 'A330')
        expect(a330.map(f => f.FlightNo)).toEqual(['1', '2', '4', '5'])
    })

    it('keeps TBD flights even when no concrete match exists', () => {
        const a350 = filterByPlaneType(flights, 'A350')
        expect(a350.map(f => f.FlightNo)).toEqual(['4', '5'])
    })

    it('matches across sub-variants within the same family', () => {
        const b777 = filterByPlaneType(flights, 'B777')
        // Includes B777-300ER plus TBD flights.
        expect(b777.map(f => f.FlightNo)).toEqual(['3', '4', '5'])
    })
})
