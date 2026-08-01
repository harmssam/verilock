/**
 * Operator admin portal API (password + Turnstile, cookie session).
 * Stats + support ticket queue.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Express, NextFunction, Request, Response } from 'express'
import {
  defaultSupportAutoAckBody,
  getSupportAutoAckBody,
  resetSupportAutoAckBody,
  setSupportAutoAckBody,
  SUPPORT_AUTO_ACK_MAX_LENGTH,
} from './adminSettings.js'
import { getAdminStats } from './adminStats.js'
import { rateLimit } from './rate-limit.js'
import {
  clientIpFromRequest,
  isTurnstileRequired,
  verifyTurnstileToken,
} from './supportContact.js'
import { sendCustomerTicketEmail } from './supportOutbound.js'
import {
  getInboxEmail,
  listInbox,
  markAllRead,
  replyToInbox,
  updateInboxEmail,
} from './adminInbox.js'
import { attachAdminXIdeasRoutes } from './adminXIdeas.js'
import { listSupportReplyTemplates } from './supportTemplates.js'
import {
  SUPPORT_TICKET_STATUSES,
  addSupportTicketMessage,
  getSupportTicketById,
  getSupportTicketCounts,
  listSupportTicketMessages,
  listSupportTickets,
  updateSupportTicketDocumentSlug,
  updateSupportTicketStatus,
  type SupportTicketStatus,
} from './supportTickets.js'

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

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const session = readAdminSession(req)
  if (!session) {
    res.status(401).json({ error: 'Admin sign-in required' })
    return
  }
  res.locals.adminUser = session.u
  next()
}

/**
 * Admin gate for HTML studio pages (iframe / new tab) and API.
 * Browser navigations redirect to /admin; XHR/fetch get JSON 401.
 */
export function requireAdminOrRedirect(req: Request, res: Response, next: NextFunction): void {
  const session = readAdminSession(req)
  if (!session) {
    const accept = String(req.headers.accept || '')
    const wantsHtml =
      accept.includes('text/html') ||
      req.path === '/blog-studio' ||
      req.path === '/x-studio' ||
      req.path.startsWith('/blog-studio') ||
      req.path.startsWith('/x-studio') ||
      req.path.startsWith('/x-post-studio')
    if (wantsHtml && req.method === 'GET') {
      res.redirect(302, '/admin')
      return
    }
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
    /** True when CONTENT_STUDIO_URL is set (Studio tab + reverse-proxy). */
    studioProxyEnabled: Boolean(process.env.CONTENT_STUDIO_URL?.trim()),
  }
}

const loginLimit = rateLimit(10, 15 * 60_000)
const statsLimit = rateLimit(60, 60_000)
const ticketsLimit = rateLimit(120, 60_000)
const ticketMutateLimit = rateLimit(30, 60_000)

const MAX_REPLY_LENGTH = 8000

function isTicketStatus(value: unknown): value is SupportTicketStatus {
  return (
    typeof value === 'string' &&
    (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value)
  )
}

function paramId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

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
      res.setHeader('Cache-Control', 'no-store')
      const stats = getAdminStats()
      res.json(stats)
    } catch (err) {
      console.error('[admin] stats', err)
      res.status(500).json({ error: 'Could not load admin statistics.' })
    }
  })

  // ── Support ticket queue ────────────────────────────────────────────────

  app.get('/api/admin/support/templates', ticketsLimit, requireAdmin, (_req, res) => {
    try {
      res.json({ templates: listSupportReplyTemplates() })
    } catch (err) {
      console.error('[admin] support templates', err)
      res.status(500).json({ error: 'Could not load templates.' })
    }
  })

  // Initial contact auto-reply (sent on /support form submit when email is enabled).
  app.get('/api/admin/support/auto-ack', ticketsLimit, requireAdmin, (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      const current = getSupportAutoAckBody()
      res.json({
        body: current.body,
        isCustom: current.isCustom,
        updatedAt: current.updatedAt,
        defaultBody: defaultSupportAutoAckBody(),
        maxLength: SUPPORT_AUTO_ACK_MAX_LENGTH,
        placeholders: ['{{name}}', '{{publicId}}', '{{subject}}', '{{site}}'],
      })
    } catch (err) {
      console.error('[admin] support auto-ack get', err)
      res.status(500).json({ error: 'Could not load auto-reply settings.' })
    }
  })

  app.put('/api/admin/support/auto-ack', ticketMutateLimit, requireAdmin, (req, res) => {
    try {
      const body = (req.body ?? {}) as { body?: unknown; reset?: unknown }
      if (body.reset === true) {
        const current = resetSupportAutoAckBody()
        res.json({
          ok: true as const,
          body: current.body,
          isCustom: current.isCustom,
          updatedAt: current.updatedAt,
          defaultBody: defaultSupportAutoAckBody(),
          maxLength: SUPPORT_AUTO_ACK_MAX_LENGTH,
          placeholders: ['{{name}}', '{{publicId}}', '{{subject}}', '{{site}}'],
        })
        return
      }
      if (typeof body.body !== 'string') {
        res.status(400).json({ error: 'body (string) is required, or pass reset: true.' })
        return
      }
      const current = setSupportAutoAckBody(body.body)
      res.json({
        ok: true as const,
        body: current.body,
        isCustom: current.isCustom,
        updatedAt: current.updatedAt,
        defaultBody: defaultSupportAutoAckBody(),
        maxLength: SUPPORT_AUTO_ACK_MAX_LENGTH,
        placeholders: ['{{name}}', '{{publicId}}', '{{subject}}', '{{site}}'],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save auto-reply.'
      if (
        message.includes('too short') ||
        message.includes('at most') ||
        message.includes('required')
      ) {
        res.status(400).json({ error: message })
        return
      }
      console.error('[admin] support auto-ack put', err)
      res.status(500).json({ error: 'Could not save auto-reply settings.' })
    }
  })

  app.get('/api/admin/tickets', ticketsLimit, requireAdmin, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      const statusRaw =
        typeof req.query.status === 'string' ? req.query.status.trim() : 'active'
      const status =
        statusRaw === 'all' || statusRaw === 'active' || isTicketStatus(statusRaw)
          ? statusRaw
          : 'active'
      const q = typeof req.query.q === 'string' ? req.query.q : undefined
      const limit =
        typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined
      const offset =
        typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined
      const result = listSupportTickets({
        status,
        q,
        limit: Number.isFinite(limit) ? limit : undefined,
        offset: Number.isFinite(offset) ? offset : undefined,
      })
      const counts = getSupportTicketCounts()
      res.json({
        ...result,
        statuses: SUPPORT_TICKET_STATUSES,
        counts: {
          total: counts.total,
          open: counts.open,
        },
      })
    } catch (err) {
      console.error('[admin] tickets list', err)
      res.status(500).json({ error: 'Could not load support tickets.' })
    }
  })

  app.get('/api/admin/tickets/:id', ticketsLimit, requireAdmin, (req, res) => {
    try {
      const ticket = getSupportTicketById(paramId(req.params.id))
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' })
        return
      }
      const messages = listSupportTicketMessages(ticket.id)
      res.json({ ticket, messages, statuses: SUPPORT_TICKET_STATUSES })
    } catch (err) {
      console.error('[admin] ticket get', err)
      res.status(500).json({ error: 'Could not load ticket.' })
    }
  })

  app.patch(
    '/api/admin/tickets/:id',
    ticketMutateLimit,
    requireAdmin,
    (req, res) => {
      try {
        const ticket = getSupportTicketById(paramId(req.params.id))
        if (!ticket) {
          res.status(404).json({ error: 'Ticket not found' })
          return
        }
        const body = (req.body ?? {}) as {
          status?: unknown
          documentSlug?: unknown
        }

        let updated = ticket
        if (body.status !== undefined) {
          if (!isTicketStatus(body.status)) {
            res.status(400).json({
              error: `Invalid status. Use one of: ${SUPPORT_TICKET_STATUSES.join(', ')}`,
            })
            return
          }
          const next = updateSupportTicketStatus(ticket.id, body.status)
          if (!next) {
            res.status(400).json({ error: 'Could not update status' })
            return
          }
          updated = next
        }

        if (body.documentSlug !== undefined) {
          const slug =
            body.documentSlug === null || body.documentSlug === ''
              ? null
              : typeof body.documentSlug === 'string'
                ? body.documentSlug.trim()
                : null
          if (body.documentSlug !== null && body.documentSlug !== '' && slug === null) {
            res.status(400).json({ error: 'documentSlug must be a string or null' })
            return
          }
          const next = updateSupportTicketDocumentSlug(ticket.id, slug)
          if (!next) {
            res.status(400).json({ error: 'Could not update document slug' })
            return
          }
          updated = next
        }

        res.json({ ticket: updated })
      } catch (err) {
        console.error('[admin] ticket patch', err)
        res.status(500).json({ error: 'Could not update ticket.' })
      }
    },
  )

  app.post(
    '/api/admin/tickets/:id/reply',
    ticketMutateLimit,
    requireAdmin,
    async (req, res) => {
      try {
        const ticket = getSupportTicketById(paramId(req.params.id))
        if (!ticket) {
          res.status(404).json({ error: 'Ticket not found' })
          return
        }
        const body = (req.body ?? {}) as {
          body?: unknown
          status?: unknown
          internalOnly?: unknown
        }
        const replyBody =
          typeof body.body === 'string' ? body.body.trim().slice(0, MAX_REPLY_LENGTH) : ''
        if (!replyBody || replyBody.length < 2) {
          res.status(400).json({ error: 'Reply body is required (at least 2 characters).' })
          return
        }
        if (body.status !== undefined && !isTicketStatus(body.status)) {
          res.status(400).json({
            error: `Invalid status. Use one of: ${SUPPORT_TICKET_STATUSES.join(', ')}`,
          })
          return
        }

        const internalOnly = body.internalOnly === true
        const operatorName =
          typeof res.locals.adminUser === 'string' && res.locals.adminUser
            ? res.locals.adminUser
            : adminUsername()

        if (internalOnly) {
          const message = addSupportTicketMessage({
            ticketId: ticket.id,
            messageKind: 'internal',
            authorName: operatorName,
            body: replyBody,
            bumpStatus: false,
          })
          if (!message) {
            res.status(500).json({ error: 'Could not save note.' })
            return
          }
        } else {
          const mailSubject = `Re: [${ticket.publicId}] ${ticket.subject}`
          const sent = await sendCustomerTicketEmail({
            ticket,
            subject: mailSubject,
            body: replyBody,
            messageKind: 'human_reply',
            authorName: operatorName,
            bumpStatus: body.status === undefined,
          })
          if (!sent.ok) {
            res.status(502).json({
              error: `Could not email customer: ${sent.error}`,
            })
            return
          }
        }

        if (body.status !== undefined && isTicketStatus(body.status)) {
          updateSupportTicketStatus(ticket.id, body.status)
        }

        const updated = getSupportTicketById(ticket.id)!
        const messages = listSupportTicketMessages(ticket.id)
        res.json({
          ok: true,
          ticket: updated,
          messages,
          emailed: !internalOnly,
        })
      } catch (err) {
        console.error('[admin] ticket reply', err)
        res.status(500).json({ error: 'Could not send reply.' })
      }
    },
  )

  const inboxLimit = rateLimit(60, 60_000)
  const inboxMutateLimit = rateLimit(30, 60_000)

  app.get('/api/admin/inbox', inboxLimit, requireAdmin, listInbox)
  app.get('/api/admin/inbox/:id', inboxLimit, requireAdmin, getInboxEmail)
  app.patch('/api/admin/inbox/:id', inboxMutateLimit, requireAdmin, updateInboxEmail)
  app.post('/api/admin/inbox/:id/reply', inboxMutateLimit, requireAdmin, (req, res) => {
    void replyToInbox(req, res)
  })
  app.post('/api/admin/inbox/mark-all-read', inboxMutateLimit, requireAdmin, markAllRead)

  // ── X Ideas ─────────────────────────────────────────────────────────
  attachAdminXIdeasRoutes(app, requireAdmin)

  if (isAdminConfigured()) {
    console.log('[admin] portal enabled (username=%s)', adminUsername())
  } else if (IS_PRODUCTION) {
    console.warn('[admin] portal disabled - set ADMIN_PASSWORD to enable /admin')
  } else {
    console.log('[admin] portal disabled in dev - set ADMIN_PASSWORD to enable')
  }
}
