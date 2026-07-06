import type { Express, RequestHandler } from 'express'
import helmet from 'helmet'

/**
 * Security headers for JSON API responses only.
 * The SPA is served separately — see spaSecurityHeaders.
 */
const apiSecurityHeaders: RequestHandler = helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: false,
})

/**
 * Minimal headers for the React SPA.
 * Avoid COOP/CORP/strict CSP here — they break Nimiq Hub popup postMessage
 * and redirect login (hub.nimiq.com/request-error).
 */
const spaSecurityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
}

export function applySecurityHeaders(app: Express): void {
  app.use('/api', apiSecurityHeaders)
  app.use(spaSecurityHeaders)
  app.disable('x-powered-by')
}