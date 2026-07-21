import react from '@vitejs/plugin-react'
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vite'

/**
 * Production SPA — light shell + journey product flow as the sole root.
 *
 * Build (default):
 *   npm run build --prefix client
 *   → client/dist/index.html
 *
 * Intermediate (Vite outDir, then package.mjs copies → dist):
 *   npm run build:app --prefix client
 *   → client/dist-build/index.html (base: '/')
 *
 * Dev:
 *   npm run dev --prefix client
 *   → http://localhost:5176/
 */
function renameHtmlToIndex(): Plugin {
  return {
    name: 'html-to-index',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist-build')
      const from = resolve(outDir, 'index.html')
      // Single SPA input already emits index.html when input is index.html
      if (!existsSync(from)) {
        const alt = resolve(outDir, 'main.html')
        if (existsSync(alt)) {
          renameSync(alt, from)
        }
      }
      // Clean accidental multi-page leftovers
      for (const name of ['journey.html', 'landing-redesign.html', 'experiment.html']) {
        const p = resolve(outDir, name)
        if (existsSync(p)) unlinkSync(p)
      }
    },
  }
}

/**
 * SPA fallback: document navigations serve index.html.
 * Leave modules, API proxy paths, and assets alone.
 */
function serveSpaAsRoot(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const raw = req.url ?? '/'
    const pathOnly = raw.split('?')[0] ?? '/'
    const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''

    if (
      pathOnly.startsWith('/api') ||
      pathOnly.startsWith('/@') ||
      pathOnly.startsWith('/src/') ||
      pathOnly.startsWith('/node_modules/') ||
      pathOnly.startsWith('/assets/') ||
      pathOnly === '/index.html' ||
      pathOnly === '/favicon.ico' ||
      /\.[a-zA-Z0-9]+$/.test(pathOnly)
    ) {
      next()
      return
    }

    req.url = `/index.html${search}`
    next()
  }

  return {
    name: 'serve-spa-as-root',
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite)
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), renameHtmlToIndex(), serveSpaAsRoot()],
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
    outDir: 'dist-build',
    emptyOutDir: true,
    /*
     * Vite 8 defaults cssMinify to lightningcss, which collapses dual
     * backdrop-filter / -webkit-backdrop-filter to only the -webkit- form.
     * Chromium needs the unprefixed property, so frosted header/path glass
     * works in dev (unminified) and on Safari, but not on production Chrome.
     * esbuild keeps both declarations. Revisit when lightningcss#695 lands.
     */
    cssMinify: 'esbuild',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
})
