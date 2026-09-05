import { resolve } from 'path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/tpe-sushi-go-round/',
  root: resolve(__dirname, '.'),
  build: {
    outDir: './dist',
    // Issue #122: Vite 8 minifies CSS with lightningcss by default, and
    // lightningcss collapses an authored backdrop-filter /
    // -webkit-backdrop-filter pair down to the -webkit- form regardless of
    // the CSS target (upstream parcel-bundler/lightningcss#695, fix pending
    // in #1259). Firefox never supported the -webkit- form (MDN BCD lists
    // no prefix entry for Firefox), so every liquid-glass surface
    // (.theme-toggle-btn, .flight-toggle-btn, .offcanvas-backdrop) lost its
    // frost on Firefox in the built stylesheet, even though the unprefixed
    // declaration is right there in style.scss. Raising build.cssTarget does
    // not control this: verified against lightningcss 1.32.0, the pair is
    // collapsed for every targets value including safari18. esbuild's CSS
    // minifier preserves authored prefixed/unprefixed pairs under every
    // target, so pin the CSS minifier to esbuild. The -webkit- lines stay in
    // style.scss for Safari <= 17; the JS minifier (oxc) and build.target
    // are untouched.
    cssMinify: 'esbuild'
  },
  server: {
    port: 8080
  },
  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ['import', 'global-builtin', 'color-functions']
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Inline the SW registration script so it does not render-block the
      // paint (the default 'auto' emits a separate <script src="registerSW.js">
      // which Lighthouse flagged at ~200 ms of blocking time on slow 4G).
      injectRegister: 'inline',
      includeAssets: [
        'favicon.ico',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'apple-touch-icon.png'
      ],
      workbox: {
        // Precache the app shell only. External requests (Taoyuan Airport API,
        // Google Fonts, GTM) fall through to network. POST requests are never
        // cached by Workbox by default, so the airport API is untouched.
        // `gif` covers the vendored airline logos (issue #69) — self-hosting
        // them only fixes the offline case if they're also precached, since
        // an uncached local asset 404s offline the same way a hotlinked one did.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,gif,webmanifest}'],
        navigateFallback: null,
        cleanupOutdatedCaches: true
      },
      manifest: {
        name: '台北回轉壽司🍣',
        short_name: '台北回轉壽司',
        description: 'Taoyuan Airport flight info for crew — find your gate and carousel in seconds.',
        lang: 'zh-Hant',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        id: '/tpe-sushi-go-round/',
        categories: ['travel', 'utilities'],
        icons: [
          { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    exclude: ['e2e/**/*', 'node_modules/**/*'],
  },
})
