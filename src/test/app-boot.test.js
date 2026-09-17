// @vitest-environment jsdom
//
// App-boot smoke test (issue #88 follow-up). The unit suites only import the
// pure utils — nothing exercised main.js's module scope, where renderApp()
// builds the whole DOM. A syntax-valid-but-wrong template literal (a stray
// backtick turning into string concatenation) shipped through `vitest` and
// `vite build` green and only exploded in the browser: renderApp() threw a
// ReferenceError at runtime and every e2e test timed out waiting for the
// table. This test imports the real main.js in jsdom with the network
// stubbed, so any module-scope render/init error fails fast here.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// Never-resolving fetch: initApp() → detectLanguage() → fetchData() must not
// blow up on an undefined response, and the test must not hit the network.
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

// Issue #164 — pin the boot clock. The caption is rendered from the real
// wall clock, and whenever the default window crosses UTC+8 midnight its
// end carries an MM/DD date suffix (issue #145). Any CI run in the
// ~22:30–24:00 UTC+8 window then failed the old bare-HH:MM assertion even
// on untouched main. Booting against a fixed late-evening instant makes
// the whole suite deterministic at any real-world time and pins the
// midnight-crossing format contract as a regression guard.
const BOOT_INSTANT = '2026-09-17T23:10:00+08:00' // UTC+8 date: 2026/09/17

describe('main.js app boot (smoke)', () => {
    let button

    beforeAll(async () => {
        vi.useFakeTimers({ now: new Date(BOOT_INSTANT), toFake: ['Date'] })
        document.body.innerHTML = '<div id="app"></div>'
        await import('../../main.js')
        button = document.getElementById('time-window-toggle')
    })

    afterAll(() => {
        vi.useRealTimers()
    })

    it('renders the app shell', () => {
        expect(document.getElementById('app').innerHTML).not.toBe('')
        expect(document.getElementById('airlineButtons')).not.toBeNull()
        expect(document.getElementById('planeTypeButtons')).not.toBeNull()
        expect(document.getElementById('flightButtons')).not.toBeNull()
    })

    it('renders the time-window selector with the default +2h label and a translated accessible name', () => {
        expect(button).not.toBeNull()
        expect(button.textContent).toBe('+2h')
        const label = button.getAttribute('aria-label')
        expect(label).toBeTruthy()
        expect(label).toMatch(/next 2 hours|接下來 2 小時|今後 2 時間/)
        expect(button.getAttribute('title')).toBe(label)
    })

    it('renders the time-window caption (clock pinned to a midnight-crossing window)', () => {
        const caption = document.getElementById('apiParams')
        expect(caption).not.toBeNull()
        // Pinned boot at 23:10 UTC+8 → default window 22:30 - 09/18 00:30:
        // the exact output CI produced when issue #164 was filed (issue #145
        // date-suffixed end). Exact match, not a loose regex, so any future
        // format drift fails loudly here at any wall-clock time.
        expect(caption.innerText).toBe('Date: 2026/09/17, Range: 22:30 - 09/18 00:30 (UTC+8)')
    })
})
