import type { Express } from 'express'
import helmet from 'helmet'

/**
 * Security headers.
 * frameguard is off and frame-ancestors is permissive so Nimiq Pay can embed the mini app.
 */
export function applySecurityHeaders(app: Express): void {
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          connectSrc: [
            "'self'",
            'https://rpc.nimiqwatch.com',
            'https://hub.nimiq.com',
            'https://api.go.fastspot.io',
            'https://api.frankfurter.app',
          ],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ['*'],
        },
      },
    }),
  )
  app.disable('x-powered-by')
}