import { describe, it, expect } from 'vitest'
import { hasVendoredLogo, KNOWN_LOGO_CODES } from '../utils/flightUtils.js'

// issue #69: logos are vendored locally for the 5 codes an airline group
// can surface (BR, B7, CI, AE, JX). An ACode outside that set has no local
// file — hasVendoredLogo() must say so rather than the caller building a
// src that 404s.
describe('hasVendoredLogo', () => {
    it('is true for every known code, including subsidiaries', () => {
        expect(KNOWN_LOGO_CODES).toEqual(['BR', 'B7', 'CI', 'AE', 'JX']);
        KNOWN_LOGO_CODES.forEach(code => {
            expect(hasVendoredLogo(code)).toBe(true);
        });
    });

    it('is false for an ACode outside the vendored set', () => {
        expect(hasVendoredLogo('ZZ')).toBe(false);
        expect(hasVendoredLogo('')).toBe(false);
        expect(hasVendoredLogo(undefined)).toBe(false);
    });
});
