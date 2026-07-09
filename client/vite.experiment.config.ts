import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

/**
 * Parallel Vite entry for the interactive workflow experiment.
 * Does not modify the production vite.config.ts.
 *
 * Run from client/:
 *   ./node_modules/.bin/vite --config vite.experiment.config.ts
 *
 * Open: http://localhost:5175/   (redirects to experiment.html)
 *   or: http://localhost:5175/experiment.html
 */
function experimentRootRedirect(): Plugin {
  return {
    name: 'experiment-root-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? ''
        // Bare root → experiment (avoid loading production index.html by accident)
        if (url === '/' || url === '/index.html') {
          res.statusCode = 302
          res.setHeader('Location', '/experiment.html')
          res.end()
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), experimentRootRedirect()],
  server: {
    port: 5175,
    host: true,
    open: '/experiment.html',
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  preview: {
    port: 4175,
    host: true,
    proxy: {
      '/api': 'http://localhost:3002',
    },
  },
  build: {
    outDir: 'dist-experiment',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        experiment: resolve(__dirname, 'experiment.html'),
      },
    },
  },
})
