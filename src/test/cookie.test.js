import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// Mirror cookie functions from main.js for isolated unit testing.
function setCookie(name, value, days = 400) {
    const d = new Date()
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000)
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/`
}

function getCookie(name) {
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift())
}

function renewPins(names) {
    names.forEach(name => {
        const value = getCookie(name)
        if (value !== undefined) setCookie(name, value)
    })
}

describe('Cookie sliding renew', () => {
    let writtenCookies
    let proto

    beforeEach(() => {
        writtenCookies = []
        proto = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
        Object.defineProperty(document, 'cookie', {
            configurable: true,
            get() { return proto.get.call(this) },
            set(str) {
                writtenCookies.push(str)
                proto.set.call(this, str)
            },
        })
    })

    afterEach(() => {
        // Clear all cookies in jsdom's store
        document.cookie.split(';').forEach(c => {
            const name = c.split('=')[0].trim()
            if (name) proto.set.call(document, `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`)
        })
        delete document.cookie
    })

    test('setCookie default expiry is ≥ 400 days from now', () => {
        setCookie('ACode', 'BR')
        expect(writtenCookies).toHaveLength(1)
        const match = writtenCookies[0].match(/expires=([^;]+)/i)
        expect(match).toBeTruthy()
        const expires = new Date(match[1])
        const min = new Date(Date.now() + 399 * 24 * 60 * 60 * 1000)
        expect(expires >= min).toBe(true)
    })

    test('renewPins re-writes present cookies, skips absent ones', () => {
        proto.set.call(document, 'ACode=BR;path=/')
        proto.set.call(document, 'theme=dark;path=/')
        writtenCookies = []

        renewPins(['ACode', 'PlaneType', 'theme', 'lang'])

        const rewritten = writtenCookies.map(s => s.split('=')[0])
        expect(rewritten).toContain('ACode')
        expect(rewritten).toContain('theme')
        expect(rewritten).not.toContain('PlaneType')
        expect(rewritten).not.toContain('lang')
    })

    test('renewPins renews an explicitly-set language cookie', () => {
        proto.set.call(document, 'lang=en;path=/')
        writtenCookies = []

        renewPins(['ACode', 'PlaneType', 'theme', 'lang'])

        const rewritten = writtenCookies.map(s => s.split('=')[0])
        expect(rewritten).toEqual(['lang'])
    })

    test('renewPins refreshes Expires to ≥ 399 days out', () => {
        proto.set.call(document, 'ACode=CI;path=/')
        writtenCookies = []

        renewPins(['ACode'])

        const write = writtenCookies.find(s => s.startsWith('ACode='))
        expect(write).toBeDefined()
        const match = write.match(/expires=([^;]+)/i)
        expect(match).toBeTruthy()
        const expires = new Date(match[1])
        const min = new Date(Date.now() + 399 * 24 * 60 * 60 * 1000)
        expect(expires >= min).toBe(true)
    })

    test('renewPins does nothing when no pins are set', () => {
        writtenCookies = []
        renewPins(['ACode', 'PlaneType', 'theme'])
        expect(writtenCookies).toHaveLength(0)
    })

    // issue #102 "Done when" #2: a value containing a cookie-jar-reserved character
    // survives a setCookie -> getCookie round trip. getCookie() splits on `;` to find a
    // value's end, so an unencoded `;` — or `,`/`=`/space, all of which are meaningful in
    // a raw Set-Cookie string — would corrupt the parse without the encode/decode pair.
    test.each([
        ['a value containing a semicolon', 'A;B'],
        ['a value containing a comma', 'A,B'],
        ['a value containing an equals sign', 'A=B'],
        ['a value containing a space', 'A B'],
    ])('setCookie/getCookie round-trips %s', (_label, value) => {
        setCookie('ACode', value)
        expect(getCookie('ACode')).toBe(value)
    })

    // issue #102 "Done when" #3: the one regression path worth testing explicitly. Every
    // value written by the app today (BR / A321 / dark / zh) is encodeURIComponent-
    // identity, so a cookie jar written by the OLD (unencoded) code must still read back
    // correctly under the NEW decode — checked here, not assumed.
    test('a cookie jar written by the old, unencoded code still reads back identically under the new decode', () => {
        proto.set.call(document, 'ACode=BR;path=/')
        proto.set.call(document, 'PlaneType=A321;path=/')
        proto.set.call(document, 'theme=dark;path=/')
        proto.set.call(document, 'lang=zh;path=/')

        expect(getCookie('ACode')).toBe('BR')
        expect(getCookie('PlaneType')).toBe('A321')
        expect(getCookie('theme')).toBe('dark')
        expect(getCookie('lang')).toBe('zh')
    })
})

// issue #102 "Done when" #1, strongest form: not just that PERSISTED_COOKIE_NAMES exists,
// but that a persisted cookie added without also registering it for renewal is a failing
// test. Parses main.js as text (same technique as src/test/logo.test.js's issue #96
// guard) rather than importing, since main.js exports nothing — these functions are
// intentionally inline, not part of the documented src/utils/ duplication convention.
describe("main.js's PERSISTED_COOKIE_NAMES registry covers every setCookie() call site (issue #102)", () => {
    const mainSrc = readFileSync('main.js', 'utf8')

    test('every setCookie(<COOKIE_NAME_CONST>, ...) call site is covered by the registry', () => {
        const registryMatch = mainSrc.match(/const PERSISTED_COOKIE_NAMES = \[([^\]]*)\];/)
        expect(
            registryMatch,
            "main.js's PERSISTED_COOKIE_NAMES literal wasn't found by this guard's regex — " +
            'it was likely reformatted. Update the regex in src/test/cookie.test.js, don\'t skip this check.'
        ).not.toBeNull()
        const registered = new Set(registryMatch[1].split(',').map(s => s.trim()).filter(Boolean))

        // Every setCookie(<UPPER_SNAKE_CASE_CONST>, ...) call site names the cookie it
        // persists. renewPins()'s own call — setCookie(name, value), a lowercase loop
        // variable, not a specific constant — doesn't match this pattern and is correctly
        // excluded: it's the renewal itself, not a new declaration.
        const callSites = [...mainSrc.matchAll(/\bsetCookie\(([A-Z][A-Z0-9_]*),/g)].map(m => m[1])
        expect(callSites.length).toBeGreaterThan(0) // sanity: the regex itself still matches something
        const missing = callSites.filter(name => !registered.has(name))
        expect(missing).toEqual([])
    })
})
