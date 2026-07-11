import { describe, test, expect, beforeEach, afterEach } from 'vitest'

// Mirror cookie functions from main.js for isolated unit testing.
function setCookie(name, value, days = 400) {
    const d = new Date()
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000)
    document.cookie = `${name}=${value};expires=${d.toUTCString()};path=/`
}

function getCookie(name) {
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) return parts.pop().split(';').shift()
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

        renewPins(['ACode', 'PlaneType', 'theme'])

        const rewritten = writtenCookies.map(s => s.split('=')[0])
        expect(rewritten).toContain('ACode')
        expect(rewritten).toContain('theme')
        expect(rewritten).not.toContain('PlaneType')
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
})
