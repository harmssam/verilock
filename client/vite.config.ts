import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  preview: {
    port: 4174,
    host: true,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
})