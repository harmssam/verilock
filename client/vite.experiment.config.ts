import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Parallel Vite entry for the interactive workflow experiment.
 * Does not modify the production vite.config.ts.
 *
 * Run from client/:
 *   npx vite --config vite.experiment.config.ts
 *
 * Open: http://localhost:5175/experiment.html
 */
export default defineConfig({
  plugins: [react()],
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
