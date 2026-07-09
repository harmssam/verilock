import react from '@vitejs/plugin-react'
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

/**
 * Service B — journey UI as the sole SPA root.
 *
 * Does NOT replace production vite.config.ts (service A).
 *
 * Build:
 *   npm run build:journey --prefix client
 *   → client/dist-journey/index.html  (base: '/')
 *
 * Package into Express-expected client/dist (service B only):
 *   npm run package:service-b --prefix client
 *
 * Dev (optional):
 *   npx vite --config vite.journey.config.ts
 *   → http://localhost:5176/
 */
function renameHtmlToIndex(): Plugin {
  return {
    name: 'journey-html-to-index',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist-journey')
      const from = resolve(outDir, 'journey.html')
      const to = resolve(outDir, 'index.html')
      if (existsSync(from)) {
        if (existsSync(to)) unlinkSync(to)
        renameSync(from, to)
      }
    },
  }
}

export default defineConfig({
  // Root hosting on a dedicated Railway host/service (not /experiment/)
  base: '/',
  plugins: [react(), renameHtmlToIndex()],
  server: {
    port: 5176,
    host: true,
    open: '/',
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  preview: {
    port: 4176,
    host: true,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    outDir: 'dist-journey',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Emits dist-journey/journey.html then renameHtmlToIndex → index.html
        journey: resolve(__dirname, 'journey.html'),
      },
    },
  },
})
