/**
 * Personal inbox — receives mail for sam@verilock.online via Resend webhook.
 * DB migration + handlers. Routes registered in admin.ts with requireAdmin middleware.
 * Separate from the support ticket queue — completely different data and purpose.
 */
import type { Request, Response } from 'express'
import { Resend } from 'resend'
import { db } from './db.js'
import { isResendSendEnabled, resendFromAddress } from './email/config.js'
import { sendTransactionalEmail } from './email/resend.js'

// ── DB migration ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_inbox (
    id TEXT PRIMARY KEY,
    resend_email_id TEXT UNIQUE,
    from_email TEXT NOT NULL,
    from_name TEXT DEFAULT '',
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    body_html TEXT DEFAULT '',
    received_at INTEGER NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_admin_inbox_received ON admin_inbox(received_at DESC);
  CREATE INDEX IF NOT EXISTS idx_admin_inbox_unread ON admin_inbox(read, archived);
`)

// Add reply column if missing (migration for existing DBs)
const inboxColumns = db.prepare('PRAGMA table_info(admin_inbox)').all() as Array<{ name: string }>
if (!inboxColumns.some(c => c.name === 'reply_sent_at')) {
  db.exec('ALTER TABLE admin_inbox ADD COLUMN reply_sent_at INTEGER')
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface InboxEmail {
  id: string
  resendEmailId: string | null
  fromEmail: string
  fromName: string
  toEmail: string
  subject: string
  bodyText: string
  bodyHtml: string | null
  receivedAt: number
  read: boolean
  archived: boolean
  replySentAt: number | null
}

function rowToEmail(row: Record<string, unknown>): InboxEmail {
  return {
    id: row.id as string,
    resendEmailId: (row.resend_email_id as string) || null,
    fromEmail: row.from_email as string,
    fromName: (row.from_name as string) || '',
    toEmail: row.to_email as string,
    subject: (row.subject as string) || '',
    bodyText: (row.body_text as string) || '',
    bodyHtml: (row.body_html as string) || null,
    receivedAt: row.received_at as number,
    read: Boolean(row.read),
    archived: Boolean(row.archived),
    replySentAt: (row.reply_sent_at as number) || null,
  }
}

// ── Config helpers ─────────────────────────────────────────────────────────

function inboxToAddress(): string {
  return process.env.ADMIN_INBOX_TO?.trim() || 'sam@verilock.online'
}

function paramId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/)
  if (match) return match[1]!.trim().toLowerCase()
  return raw.trim().toLowerCase()
}

function extractEmailName(raw: string): string {
  const match = raw.match(/^([^<]+)</)
  if (match) return match[1]!.trim()
  return ''
}

/** Try multiple field names — Resend uses different keys depending on context. */
function coalesce(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
    if (typeof val === 'number') return String(val)
  }
  return ''
}

// ── Inbound webhook handler (no admin auth — called by Resend) ─────────────

function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return null
  return new Resend(key)
}

export async function handleInboxWebhook(req: Request, res: Response): Promise<void> {
  const payload = req.body as Record<string, unknown>
  const eventType = String(payload.type || '')

  if (eventType !== 'email.received') {
    res.json({ ok: true, ignored: true, type: eventType })
    return
  }

  const data = (payload.data || {}) as Record<string, unknown>

  // Resend webhook only sends metadata — fetch full email (with body) via API
  const emailId = coalesce(data, 'email_id', 'id')
  let fullEmail: Record<string, unknown> | null = null

  if (emailId) {
    const resend = getResendClient()
    if (resend) {
      try {
        const result = await resend.emails.receiving.get(emailId)
        if (result.data) {
          fullEmail = result.data as unknown as Record<string, unknown>
        }
      } catch (err) {
        console.warn(`[inbox] could not fetch full email ${emailId}:`, err instanceof Error ? err.message : String(err))
      }
    }
  }

  // Fall back to webhook data if API call failed
  const email = fullEmail || data

  // Recipient filtering
  const toArray = email.to
  const toRaw = Array.isArray(toArray) ? String(toArray[0] || '') : String(toArray || '')
  const toEmail = extractEmailAddress(toRaw) || coalesce(data, 'received_for')
  const expectedTo = inboxToAddress()

  if (toEmail !== expectedTo.toLowerCase()) {
    res.json({ ok: true, ignored: true, reason: `not for ${expectedTo}` })
    return
  }

  // Field extraction — from the full fetched email or webhook fallback
  const fromRaw = coalesce(email, 'from', 'from_email', 'sender')
  const fromEmail = extractEmailAddress(fromRaw) || 'unknown@unknown.com'
  const fromName = extractEmailName(fromRaw)
  const subject = coalesce(email, 'subject', 'mail_subject').slice(0, 500) || '(no subject)'
  let bodyText = coalesce(email, 'text', 'body_text')
  let bodyHtml = coalesce(email, 'html', 'body_html') || null
  if (!bodyText && bodyHtml) {
    bodyText = bodyHtml.replace(/<[^>]*>/g, '').slice(0, 5000)
  }

  const resendEmailId = emailId || (coalesce(data, 'email_id') || null) as string | null
  const receivedAtRaw = coalesce(email, 'created_at', 'received_at', 'date')
  const receivedAt = receivedAtRaw ? new Date(receivedAtRaw).getTime() : Date.now()

  const id = resendEmailId || `inbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Deduplicate by resend_email_id
  if (resendEmailId) {
    const existing = db.prepare('SELECT id FROM admin_inbox WHERE resend_email_id = ?').get(resendEmailId)
    if (existing) {
      res.json({ ok: true, duplicate: true })
      return
    }
  }

  db.prepare(`
    INSERT INTO admin_inbox (id, resend_email_id, from_email, from_name, to_email, subject, body_text, body_html, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, resendEmailId, fromEmail, fromName, toEmail, subject, bodyText, bodyHtml, receivedAt)

  console.log(`[inbox] ${fromEmail} → ${toEmail}  "${subject.slice(0, 60)}"  body=${bodyText ? `${bodyText.length} chars` : 'EMPTY'}`)
  res.json({ ok: true })
}

// ── Admin API handlers (auth applied by caller in admin.ts) ────────────────

export function listInbox(req: Request, res: Response): void {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const archived = req.query.archived === '1' || req.query.archived === 'true'
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0

  let where = archived ? 'WHERE archived = 1' : 'WHERE archived = 0'
  const params: unknown[] = []

  if (q) {
    where += ' AND (from_email LIKE ? OR from_name LIKE ? OR subject LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like)
  }

  const countRow = db.prepare(`SELECT COUNT(*) as total FROM admin_inbox ${where}`).get(...params) as { total: number }
  const total = countRow.total

  const rows = db.prepare(`
    SELECT * FROM admin_inbox ${where}
    ORDER BY received_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as Record<string, unknown>[]

  const unreadCount = (db.prepare(
    'SELECT COUNT(*) as n FROM admin_inbox WHERE read = 0 AND archived = 0'
  ).get() as { n: number }).n

  res.setHeader('Cache-Control', 'no-store')
  res.json({ emails: rows.map(rowToEmail), total, unreadCount })
}

export function getInboxEmail(req: Request, res: Response): void {
  const email = db.prepare('SELECT * FROM admin_inbox WHERE id = ?').get(
    paramId(req.params.id),
  ) as Record<string, unknown> | undefined
  if (!email) {
    res.status(404).json({ error: 'Email not found' })
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json({ email: rowToEmail(email) })
}

export function updateInboxEmail(req: Request, res: Response): void {
  const id = paramId(req.params.id)
  const body = req.body as { read?: boolean; archived?: boolean }

  const existing = db.prepare('SELECT id FROM admin_inbox WHERE id = ?').get(id)
  if (!existing) {
    res.status(404).json({ error: 'Email not found' })
    return
  }

  if (typeof body.read === 'boolean') {
    db.prepare('UPDATE admin_inbox SET read = ? WHERE id = ?').run(body.read ? 1 : 0, id)
  }
  if (typeof body.archived === 'boolean') {
    db.prepare('UPDATE admin_inbox SET archived = ? WHERE id = ?').run(body.archived ? 1 : 0, id)
  }

  const updated = db.prepare('SELECT * FROM admin_inbox WHERE id = ?').get(id) as Record<string, unknown>
  res.json({ email: rowToEmail(updated) })
}

export function markAllRead(_req: Request, res: Response): void {
  db.prepare('UPDATE admin_inbox SET read = 1 WHERE read = 0 AND archived = 0').run()
  res.json({ ok: true })
}

// ── Reply ──────────────────────────────────────────────────────────────────

const MAX_REPLY_LENGTH = 8000

export async function replyToInbox(req: Request, res: Response): Promise<void> {
  const id = paramId(req.params.id)
  const body = req.body as { body?: unknown }

  const email = db.prepare('SELECT * FROM admin_inbox WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!email) {
    res.status(404).json({ error: 'Email not found' })
    return
  }

  const replyBody = typeof body.body === 'string' ? body.body.trim() : ''
  if (!replyBody) {
    res.status(400).json({ error: 'Reply body is required' })
    return
  }
  if (replyBody.length > MAX_REPLY_LENGTH) {
    res.status(400).json({ error: `Reply too long (max ${MAX_REPLY_LENGTH} characters)` })
    return
  }

  if (!isResendSendEnabled()) {
    res.status(503).json({ error: 'Email sending is not enabled on this server' })
    return
  }

  const subject = String(email.subject || '(no subject)')
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`
  const fromAddr = resendFromAddress()

  const result = await sendTransactionalEmail({
    to: email.from_email as string,
    subject: replySubject,
    text: replyBody,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.6;max-width:560px"><div style="white-space:pre-wrap">${replyBody.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div></div>`,
  })

  if (!result.ok) {
    const errMsg = result.skipped ? result.reason : result.error
    res.status(502).json({ error: errMsg })
    return
  }

  db.prepare('UPDATE admin_inbox SET reply_sent_at = ? WHERE id = ?').run(Date.now(), id)

  const updated = db.prepare('SELECT * FROM admin_inbox WHERE id = ?').get(id) as Record<string, unknown>
  res.json({ ok: true, email: rowToEmail(updated) })
}
