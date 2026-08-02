import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
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

// issue #96: the three-things-must-agree list for a logo to render has a
// third member — main.js's own inline KNOWN_LOGO_CODES / AIRLINE_GROUPS
// literals (the repo's documented duplication convention; see CLAUDE.md).
// Every test above imports from src/utils/flightUtils.js, so none of them
// can see main.js's copy drift — editing main.js's literals directly still
// leaves every existing test green while shipping the exact 404'd <img>
// hasVendoredLogo() exists to prevent.
describe('main.js inline literal stays in sync with src/utils/flightUtils.js', () => {
    const mainSrc = readFileSync('main.js', 'utf8');

    // A regex that stops matching (reformatted literal: multi-line array,
    // trailing comma, double quotes) must fail loudly as a drift signal,
    // not throw a TypeError on `null[1]` that reads like a broken test.
    function extractLiteral(name, pattern) {
        const match = mainSrc.match(pattern);
        expect(
            match,
            `main.js's inline \`${name}\` literal wasn't found by this guard's regex (${pattern}) — ` +
            `it was likely reformatted. Update the regex in src/test/logo.test.js, don't skip this check.`
        ).not.toBeNull();
        return JSON.parse(match[1].replace(/'/g, '"'));
    }

    it('KNOWN_LOGO_CODES', () => {
        const inline = extractLiteral('KNOWN_LOGO_CODES', /const KNOWN_LOGO_CODES = (\[[^\]]*\]);/);
        expect(new Set(inline)).toEqual(new Set(KNOWN_LOGO_CODES));
    });

    it('AIRLINE_GROUPS', () => {
        const inline = extractLiteral('AIRLINE_GROUPS', /const AIRLINE_GROUPS = (\{[\s\S]*?\});/);
        expect(inline).toEqual(AIRLINE_GROUPS);
    });
});
