import { resolve } from 'path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/tpe-sushi-go-round/',
  root: resolve(__dirname, '.'),
  build: {
    outDir: './dist'
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
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
