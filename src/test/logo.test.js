import { describe, it, expect } from 'vitest'
import { readdirSync } from 'node:fs'
import { hasVendoredLogo, KNOWN_LOGO_CODES, AIRLINE_GROUPS } from '../utils/flightUtils.js'

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

    // PR #93 review (🟡 recommended): KNOWN_LOGO_CODES is hand-maintained
    // and wasn't tied to what's actually in public/logos/. Two silent drift
    // modes this closes: a file gets added/renamed without updating the
    // list (that airline silently loses its logo), or the list gets edited
    // without the file existing (a 404'd <img> — this PR's original bug,
    // reintroduced by the mechanism meant to prevent it).
    it('matches the files actually present in public/logos/', () => {
        const files = readdirSync('public/logos')
            .filter(f => f.endsWith('.gif'))
            .map(f => f.replace('.gif', ''));
        expect(new Set(files)).toEqual(new Set(KNOWN_LOGO_CODES));
    });

    // The list must also cover every code the ingest filter can actually
    // let through — that's the set filterSupportedAirlines() uses, not the
    // 3-item AIRLINE_CODES filter-button list.
    it('covers every code AIRLINE_GROUPS can surface', () => {
        const allGroupCodes = Object.values(AIRLINE_GROUPS).flat();
        expect(new Set(KNOWN_LOGO_CODES)).toEqual(new Set(allGroupCodes));
    });
});
