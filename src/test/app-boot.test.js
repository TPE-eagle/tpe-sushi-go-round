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

import { describe, it, expect, vi, beforeAll } from 'vitest'

// Never-resolving fetch: initApp() → detectLanguage() → fetchData() must not
// blow up on an undefined response, and the test must not hit the network.
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

describe('main.js app boot (smoke)', () => {
    let button

    beforeAll(async () => {
        document.body.innerHTML = '<div id="app"></div>'
        await import('../../main.js')
        button = document.getElementById('time-window-toggle')
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

    it('renders the time-window caption', () => {
        const caption = document.getElementById('apiParams')
        expect(caption).not.toBeNull()
        expect(caption.innerText).toMatch(/Range: \d{2}:\d{2} - \d{2}:\d{2}/)
    })
})
