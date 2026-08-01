/**
 * Personal inbox — receives mail for sam@verilock.online via Resend webhook.
 * DB migration + handlers. Routes registered in admin.ts with requireAdmin middleware.
 * Separate from the support ticket queue — completely different data and purpose.
 */
import type { Request, Response } from 'express'
import { db } from './db.js'

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

// ── Inbound webhook handler (no admin auth — called by Resend) ─────────────

export async function handleInboxWebhook(req: Request, res: Response): Promise<void> {
  const payload = req.body as Record<string, unknown>
  const eventType = String(payload.type || '')

  if (eventType !== 'email.received') {
    res.json({ ok: true, ignored: true, type: eventType })
    return
  }

  const data = (payload.data || {}) as Record<string, unknown>
  const email = (data.email || data) as Record<string, unknown>

  const toRaw = Array.isArray(email.to) ? String(email.to[0] || '') : String(email.to || '')
  const toEmail = extractEmailAddress(toRaw)
  const expectedTo = inboxToAddress()

  if (toEmail !== expectedTo.toLowerCase()) {
    res.json({ ok: true, ignored: true, reason: `not for ${expectedTo}` })
    return
  }

  const fromRaw = String(email.from || '')
  const fromEmail = extractEmailAddress(fromRaw)
  const fromName = extractEmailName(fromRaw)
  const subject = String(email.subject || '').slice(0, 500)
  const bodyText = String(email.text || email.body_text || '')
  const bodyHtml = String(email.html || email.body_html || '') || null
  const resendEmailId = (String(data.email_id || email.email_id || email.id || '') || null) as string | null
  const receivedAt = (email.created_at || email.received_at)
    ? new Date(String(email.created_at || email.received_at)).getTime()
    : Date.now()

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

  console.log(`[inbox] ${fromEmail} → ${toEmail}  "${subject.slice(0, 60)}"`)
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
