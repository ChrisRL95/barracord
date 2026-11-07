import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Caminhos relativos também funcionam quando o app é aberto pelo Electron via file://.
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/token': 'http://127.0.0.1:3001',
      '/soundboard': 'http://127.0.0.1:3001',
    },
  },
})
