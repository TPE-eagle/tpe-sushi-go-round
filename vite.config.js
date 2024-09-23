import { resolve } from 'path'

export default {
  base: '/tpe-sushi-go-round/',
  root: resolve(__dirname, '.'),
  build: {
    outDir: './dist'
  },
  server: {
    port: 8080
  }
}