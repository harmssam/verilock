/**
 * Operator admin portal API (password + Turnstile, cookie session).
 * Stats-only for now - no product data export / mutation routes.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import { getAdminStats } from './db.js'
import { rateLimit } from './rate-limit.js'
import {
  clientIpFromRequest,
  isTurnstileRequired,
  verifyTurnstileToken,
} from './supportContact.js'

const COOKIE_NAME = 'verilock_admin'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function truthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function isAdminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD?.trim())
}

export function adminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || 'admin'
}

function sessionSecret(): string {
  const explicit = process.env.ADMIN_SESSION_SECRET?.trim()
  if (explicit) return explicit
  const password = process.env.ADMIN_PASSWORD?.trim() ?? ''
  // Derived secret so rotating ADMIN_PASSWORD invalidates existing cookies.
  return createHmac('sha256', 'verilock-admin-session-v1')
    .update(password)
    .digest('hex')
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function fromB64url(value: string): Buffer | null {
  try {
    const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad
    return Buffer.from(b64, 'base64')
  } catch {
    return null
  }
}

interface AdminSessionPayload {
  u: string
  iat: number
  exp: number
  n: string
}

function signPayload(payload: AdminSessionPayload): string {
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', sessionSecret()).update(body).digest()
  return `${body}.${b64url(sig)}`
}

function verifySignedToken(token: string): AdminSessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sigB64] = parts
  if (!body || !sigB64) return null
  const expected = createHmac('sha256', sessionSecret()).update(body).digest()
  const got = fromB64url(sigB64)
  if (!got || got.length !== expected.length) return null
  if (!timingSafeEqual(got, expected)) return null
  const raw = fromB64url(body)
  if (!raw) return null
  try {
    const payload = JSON.parse(raw.toString('utf8')) as AdminSessionPayload
    if (!payload || typeof payload !== 'object') return null
    if (typeof payload.u !== 'string' || !payload.u) return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (typeof payload.iat !== 'number') return null
    return payload
  } catch {
    return null
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx <= 0) continue
    const key = part.slice(0, idx).trim()
    const val = part.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(val)
    } catch {
      out[key] = val
    }
  }
  return out
}

function safeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) {
    // Still run a compare to reduce trivial timing leaks on length.
    const dummy = Buffer.alloc(ab.length)
    timingSafeEqual(ab, dummy)
    return false
  }
  return timingSafeEqual(ab, bb)
}

function cookieOptions(maxAgeMs: number): string {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
  ]
  if (IS_PRODUCTION || truthy(process.env.ADMIN_COOKIE_SECURE)) {
    parts.push('Secure')
  }
  return parts.join('; ')
}

function setAdminCookie(res: Response, token: string): void {
  // Embed token into the cookie string built by cookieOptions prefix.
  const base = cookieOptions(SESSION_TTL_MS)
  res.append('Set-Cookie', base.replace(`${COOKIE_NAME}=`, `${COOKIE_NAME}=${encodeURIComponent(token)}`))
}

function clearAdminCookie(res: Response): void {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]
  if (IS_PRODUCTION || truthy(process.env.ADMIN_COOKIE_SECURE)) {
    parts.push('Secure')
  }
  res.append('Set-Cookie', parts.join('; '))
}

function readAdminSession(req: Request): AdminSessionPayload | null {
  if (!isAdminConfigured()) return null
  const cookies = parseCookies(
    typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
  )
  const raw = cookies[COOKIE_NAME]
  if (!raw) return null
  return verifySignedToken(raw)
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = readAdminSession(req)
  if (!session) {
    res.status(401).json({ error: 'Admin sign-in required' })
    return
  }
  res.locals.adminUser = session.u
  next()
}

export function adminPublicFeatures() {
  return {
    adminEnabled: isAdminConfigured(),
    turnstileRequired: isTurnstileRequired() && isAdminConfigured(),
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY?.trim() || null,
  }
}

const loginLimit = rateLimit(10, 15 * 60_000)
const statsLimit = rateLimit(60, 60_000)

export function attachAdminRoutes(app: Express): void {
  app.get('/api/admin/features', (_req, res) => {
    res.json(adminPublicFeatures())
  })

  app.get('/api/admin/me', (req, res) => {
    if (!isAdminConfigured()) {
      res.status(503).json({ error: 'Admin portal is not configured', authenticated: false })
      return
    }
    const session = readAdminSession(req)
    if (!session) {
      res.status(401).json({ authenticated: false })
      return
    }
    res.json({ authenticated: true, username: session.u, expiresAt: session.exp })
  })

  app.post('/api/admin/login', loginLimit, async (req, res) => {
    if (!isAdminConfigured()) {
      res.status(503).json({
        error:
          'Admin portal is not configured. Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) on the server.',
      })
      return
    }

    const body = (req.body ?? {}) as {
      username?: unknown
      password?: unknown
      turnstileToken?: unknown
      website?: unknown
    }

    // Honeypot - bots that fill hidden fields are rejected silently.
    if (typeof body.website === 'string' && body.website.trim().length > 0) {
      res.json({ ok: true })
      return
    }

    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const turnstileToken =
      typeof body.turnstileToken === 'string' && body.turnstileToken.trim()
        ? body.turnstileToken.trim()
        : null

    const remoteIp = clientIpFromRequest(req)
    const turnstile = await verifyTurnstileToken(turnstileToken, remoteIp)
    if (!turnstile.ok) {
      res.status(400).json({ error: turnstile.error })
      return
    }

    const expectedUser = adminUsername()
    const expectedPass = process.env.ADMIN_PASSWORD!.trim()
    const userOk = safeEqualString(username, expectedUser)
    const passOk = safeEqualString(password, expectedPass)
    if (!userOk || !passOk) {
      res.status(401).json({ error: 'Invalid username or password.' })
      return
    }

    const now = Date.now()
    const payload: AdminSessionPayload = {
      u: expectedUser,
      iat: now,
      exp: now + SESSION_TTL_MS,
      n: randomBytes(16).toString('hex'),
    }
    const token = signPayload(payload)
    setAdminCookie(res, token)
    res.json({ ok: true, username: expectedUser, expiresAt: payload.exp })
  })

  app.post('/api/admin/logout', (req, res) => {
    clearAdminCookie(res)
    // Always succeed so the client can clear UI state even if already logged out.
    void req
    res.json({ ok: true })
  })

  app.get('/api/admin/stats', statsLimit, requireAdmin, (_req, res) => {
    try {
      const stats = getAdminStats()
      res.json(stats)
    } catch (err) {
      console.error('[admin] stats', err)
      res.status(500).json({ error: 'Could not load admin statistics.' })
    }
  })

  if (isAdminConfigured()) {
    console.log('[admin] portal enabled (username=%s)', adminUsername())
  } else if (IS_PRODUCTION) {
    console.warn('[admin] portal disabled - set ADMIN_PASSWORD to enable /admin')
  } else {
    console.log('[admin] portal disabled in dev - set ADMIN_PASSWORD to enable')
  }
}
