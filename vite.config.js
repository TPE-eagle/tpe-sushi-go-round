import { resolve } from 'path'
import { defineConfig } from 'vite'

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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    exclude: ['e2e/**/*', 'node_modules/**/*'],
  },
})