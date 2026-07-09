import react from '@vitejs/plugin-react'
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'
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
 * Dev:
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

/**
 * client/ also has production index.html + main.tsx. Without this, paths like
 * /pricing and /privacy fall through to the production SPA (old logo tilt).
 * Rewrite document navigations to journey.html; leave modules/assets alone.
 */
function serveJourneyAsRoot(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const raw = req.url ?? '/'
    const pathOnly = raw.split('?')[0] ?? '/'
    const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''

    // Never rewrite Vite internals, source, node_modules, or files with extensions
    if (
      pathOnly.startsWith('/@') ||
      pathOnly.startsWith('/src/') ||
      pathOnly.startsWith('/node_modules/') ||
      pathOnly.startsWith('/assets/') ||
      pathOnly === '/journey.html' ||
      pathOnly === '/favicon.ico' ||
      /\.[a-zA-Z0-9]+$/.test(pathOnly)
    ) {
      next()
      return
    }

    // SPA routes: /, /pricing, /privacy, /d/…, /v/…, etc.
    req.url = `/journey.html${search}`
    next()
  }

  return {
    name: 'serve-journey-as-root',
    configureServer(server) {
      // Run early so HTML requests never hit production index.html
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url ?? '/'
        const pathOnly = raw.split('?')[0] ?? '/'
        const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
        if (
          pathOnly.startsWith('/assets/') ||
          pathOnly === '/favicon.ico' ||
          /\.[a-zA-Z0-9]+$/.test(pathOnly)
        ) {
          next()
          return
        }
        req.url = `/index.html${search}`
        next()
      })
    },
  }
}

export default defineConfig({
  // Root hosting on a dedicated Railway host/service (not /experiment/)
  base: '/',
  plugins: [react(), renameHtmlToIndex(), serveJourneyAsRoot()],
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
