import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// PR #171 review (F2): fetchData() wraps the trailing 🧳 of the loading
// string in a .luggage-sway span via .replace('🧳', ...). That silently
// degrades to a no-sway plain string if any locale drops the emoji, so
// this guards the assumption mechanically. main.js exports nothing, so
// the translations literals are checked as source text (same technique
// as src/test/cookie.test.js's issue #102 guard and logo.test.js's
// issue #96 guard).
describe('loading strings end with the 🧳 the sway wrapper assumes (PR #171 F2)', () => {
    const mainSrc = readFileSync('main.js', 'utf8')
    const loadingValues = [...mainSrc.matchAll(/"loading":\s*"([^"]*)"/g)].map(m => m[1])

    it('finds one literal per locale (three today)', () => {
        // If this drops to fewer, a locale lost its loading string entirely;
        // if a new locale is added, the next assertion covers its emoji too.
        expect(loadingValues.length).toBe(3)
    })

    it('every locale ends with 🧳', () => {
        loadingValues.forEach(value => {
            expect(value.endsWith('🧳'), `loading string does not end with 🧳: "${value}"`).toBe(true)
        })
    })
})
