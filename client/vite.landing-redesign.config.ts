import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'
import { defineConfig } from 'vite'

/**
 * Parallel landing redesign preview — does not replace production Journey.
 *
 *   npm run dev:landing-redesign --prefix client
 *   → http://localhost:5178/
 *
 * Original journey files and vite.journey.config.ts are never used by this build.
 */
function serveLandingRedesignAsRoot(): Plugin {
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
      pathOnly === '/landing-redesign.html' ||
      pathOnly === '/favicon.ico' ||
      /\.[a-zA-Z0-9]+$/.test(pathOnly)
    ) {
      next()
      return
    }

    req.url = `/landing-redesign.html${search}`
    next()
  }

  return {
    name: 'serve-landing-redesign-as-root',
    configureServer(server) {
      server.middlewares.use(rewrite)
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), serveLandingRedesignAsRoot()],
  server: {
    port: 5178,
    host: true,
    open: '/',
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  preview: {
    port: 4178,
    host: true,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    outDir: 'dist-landing-redesign',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landingRedesign: resolve(__dirname, 'landing-redesign.html'),
      },
    },
  },
})
