import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Express } from 'express'
import express from 'express'
import { getClientDistDir } from './paths.js'
import { isPdfAnnotationUiEnabled } from './pdfAnnotationConfig.js'

function isKnownAppPath(path: string): boolean {
  if (path === '/' || path === '') return true
  if (/^\/agreements\/?$/.test(path)) return true
  if (/^\/pricing\/?$/.test(path)) return true
  if (/^\/privacy\/?$/.test(path)) return true
  if (/^\/security\/?$/.test(path)) return true
  if (/^\/support\/?$/.test(path)) return true
  // PDF lab (parallel to seal) — kill-switch via PDF_ANNOTATION_UI=false
  if (isPdfAnnotationUiEnabled()) {
    if (/^\/pdf\/?$/.test(path)) return true
    if (/^\/pdf\/lab\/?$/.test(path)) return true
  }
  if (/^\/d\/[^/]+\/?$/.test(path)) return true
  if (/^\/v\/[^/]+\/?$/.test(path)) return true
  return false
}

const SEO_STATIC_FILES = ['sitemap.xml', 'robots.txt'] as const

export function attachClientStatic(app: Express): boolean {
  const distDir = getClientDistDir()
  if (!existsSync(join(distDir, 'index.html'))) {
    console.warn(`Client dist not found at ${distDir} — API-only mode`)
    return false
  }

  // Express route patterns treat a trailing slash as optional — use exact path checks.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next()
      return
    }
    for (const file of SEO_STATIC_FILES) {
      if (req.path === `/${file}/`) {
        res.redirect(301, `/${file}`)
        return
      }
    }
    next()
  })

  app.use(
    express.static(distDir, {
      // Default short; hashed /assets/* get long immutable cache below.
      maxAge: 0,
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.mjs')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        }
        // HTML must revalidate so deploys don't leave tabs on dead chunk hashes.
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache')
          return
        }
        // Vite content-hashed assets (journey-xxx.js, pdf-xxx.js, …)
        if (
          filePath.includes(`${join(distDir, 'assets')}`) ||
          /[\\/]assets[\\/]/.test(filePath)
        ) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
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
    res.setHeader('Cache-Control', 'no-cache')
    if (!isKnownAppPath(req.path) && existsSync(notFoundPage)) {
      res.status(404).sendFile(notFoundPage)
      return
    }
    res.sendFile(join(distDir, 'index.html'))
  })

  console.log(`Serving client from ${distDir}`)
  return true
}