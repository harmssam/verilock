import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Express } from 'express'
import express from 'express'
import { getClientDistDir } from './paths.js'

function isKnownAppPath(path: string): boolean {
  if (path === '/' || path === '') return true
  if (/^\/agreements\/?$/.test(path)) return true
  if (/^\/pricing\/?$/.test(path)) return true
  if (/^\/privacy\/?$/.test(path)) return true
  if (/^\/d\/[^/]+\/?$/.test(path)) return true
  if (/^\/v\/[^/]+\/?$/.test(path)) return true
  return false
}

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

  const notFoundPage = join(distDir, '404.html')

  // SPA fallback — never serve index.html for missing static assets (avoids MIME errors in module scripts).
  app.get(/^\/(?!api\/).*/, (req, res) => {
    if (/\.[a-z0-9]+$/i.test(req.path)) {
      res.status(404).type('text/plain').send('Not found')
      return
    }
    if (!isKnownAppPath(req.path) && existsSync(notFoundPage)) {
      res.status(404).sendFile(notFoundPage)
      return
    }
    res.sendFile(join(distDir, 'index.html'))
  })

  console.log(`Serving client from ${distDir}`)
  return true
}