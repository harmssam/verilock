import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Express } from 'express'
import express from 'express'
import { getClientDistDir } from './paths.js'

export function attachClientStatic(app: Express): boolean {
  const distDir = getClientDistDir()
  if (!existsSync(join(distDir, 'index.html'))) {
    console.warn(`Client dist not found at ${distDir} — API-only mode`)
    return false
  }

  app.use(
    express.static(distDir, {
      maxAge: '1h',
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.mjs')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        }
      },
    }),
  )

  // SPA fallback — never serve index.html for missing static assets (avoids MIME errors in module scripts).
  app.get(/^\/(?!api\/).*/, (req, res) => {
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      res.status(404).type('text/plain').send('Not found')
      return
    }
    res.sendFile(join(distDir, 'index.html'))
  })

  console.log(`Serving client from ${distDir}`)
  return true
}