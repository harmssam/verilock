/**
 * Operator digest: email a summary when new support tickets and/or admin inbox
 * messages arrive. Throttled to at most one email per hour.
 *
 * Env (optional):
 * - ADMIN_DIGEST_ENABLED=false to disable (default: on when Resend can send)
 * - ADMIN_DIGEST_TO=harmssam@gmail.com
 * - ADMIN_DIGEST_MIN_INTERVAL_MS=3600000  (1 hour)
 * - ADMIN_DIGEST_POLL_MS=300000           (5 minutes)
 */
import { db } from './db.js'
// Ensure admin_kv exists (side-effect of adminSettings).
import './adminSettings.js'
import { appPublicUrl, isResendSendEnabled } from './email/config.js'
import { sendTransactionalEmail } from './email/resend.js'

const DEFAULT_TO = 'harmssam@gmail.com'
const DEFAULT_MIN_INTERVAL_MS = 60 * 60 * 1000
const DEFAULT_POLL_MS = 5 * 60 * 1000
const PREVIEW_LIMIT = 8
const SNIPPET_LEN = 160

const KV_LAST_SENT = 'admin_digest_last_sent_at'
const KV_BOOTSTRAPPED = 'admin_digest_bootstrapped'

function truthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function isDigestEnabled(): boolean {
  const raw = process.env.ADMIN_DIGEST_ENABLED
  if (raw != null && raw !== '') return truthy(raw)
  return true
}

function digestTo(): string {
  return process.env.ADMIN_DIGEST_TO?.trim() || DEFAULT_TO
}

function minIntervalMs(): number {
  const n = Number(process.env.ADMIN_DIGEST_MIN_INTERVAL_MS ?? DEFAULT_MIN_INTERVAL_MS)
  return Number.isFinite(n) && n >= 60_000 ? n : DEFAULT_MIN_INTERVAL_MS
}

function pollMs(): number {
  const n = Number(process.env.ADMIN_DIGEST_POLL_MS ?? DEFAULT_POLL_MS)
  return Number.isFinite(n) && n >= 30_000 ? n : DEFAULT_POLL_MS
}

function getKv(key: string): string | null {
  const row = db.prepare(`SELECT value FROM admin_kv WHERE key = ?`).get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setKv(key: string, value: string): void {
  const now = Date.now()
  db.prepare(
    `INSERT INTO admin_kv (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now)
}

function getLastSentAt(): number | null {
  const raw = getKv(KV_LAST_SENT)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function setLastSentAt(ms: number): void {
  setKv(KV_LAST_SENT, String(ms))
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function snippet(text: string, max = SNIPPET_LEN): string {
  const one = text.replace(/\s+/g, ' ').trim()
  if (one.length <= max) return one
  return `${one.slice(0, max - 1)}…`
}

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.ADMIN_DIGEST_TZ?.trim() || 'America/Edmonton',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

interface NewTicket {
  publicId: string
  name: string
  email: string
  subject: string
  status: string
  createdAt: number
  bodyPreview: string
}

interface NewInbox {
  id: string
  fromEmail: string
  fromName: string
  subject: string
  receivedAt: number
  bodyPreview: string
}

interface NewTicketReply {
  publicId: string
  name: string
  email: string
  subject: string
  createdAt: number
  bodyPreview: string
}

function loadNewTickets(sinceMs: number): NewTicket[] {
  const rows = db
    .prepare(
      `SELECT t.public_id AS publicId, t.name, t.email, t.subject, t.status, t.created_at AS createdAt,
              (
                SELECT m.body FROM support_ticket_messages m
                WHERE m.ticket_id = t.id
                ORDER BY m.created_at ASC
                LIMIT 1
              ) AS firstBody
       FROM support_tickets t
       WHERE t.created_at > ?
       ORDER BY t.created_at DESC
       LIMIT 50`,
    )
    .all(sinceMs) as Array<{
    publicId: string
    name: string
    email: string
    subject: string
    status: string
    createdAt: number
    firstBody: string | null
  }>

  return rows.map(r => ({
    publicId: r.publicId,
    name: r.name,
    email: r.email,
    subject: r.subject,
    status: r.status,
    createdAt: r.createdAt,
    bodyPreview: snippet(r.firstBody || ''),
  }))
}

/** Customer replies on existing tickets (not the initial message window for brand-new tickets). */
function loadNewCustomerReplies(sinceMs: number): NewTicketReply[] {
  const rows = db
    .prepare(
      `SELECT t.public_id AS publicId, t.name, t.email, t.subject, m.created_at AS createdAt, m.body AS body
       FROM support_ticket_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
       WHERE m.created_at > ?
         AND (
           m.message_kind = 'customer'
           OR (m.message_kind IS NULL AND m.author_kind = 'customer')
         )
         AND m.created_at > t.created_at + 2000
       ORDER BY m.created_at DESC
       LIMIT 50`,
    )
    .all(sinceMs) as Array<{
    publicId: string
    name: string
    email: string
    subject: string
    createdAt: number
    body: string
  }>

  return rows.map(r => ({
    publicId: r.publicId,
    name: r.name,
    email: r.email,
    subject: r.subject,
    createdAt: r.createdAt,
    bodyPreview: snippet(r.body || ''),
  }))
}

function loadNewInbox(sinceMs: number): NewInbox[] {
  const rows = db
    .prepare(
      `SELECT id, from_email AS fromEmail, from_name AS fromName, subject, received_at AS receivedAt,
              body_text AS bodyText
       FROM admin_inbox
       WHERE received_at > ? AND archived = 0
       ORDER BY received_at DESC
       LIMIT 50`,
    )
    .all(sinceMs) as Array<{
    id: string
    fromEmail: string
    fromName: string
    subject: string
    receivedAt: number
    bodyText: string
  }>

  return rows.map(r => ({
    id: r.id,
    fromEmail: r.fromEmail,
    fromName: r.fromName || '',
    subject: r.subject || '(no subject)',
    receivedAt: r.receivedAt,
    bodyPreview: snippet(r.bodyText || ''),
  }))
}

function openTicketCount(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM support_tickets
       WHERE status IN ('open', 'in_progress', 'waiting_customer')`,
    )
    .get() as { n: number }
  return row?.n ?? 0
}

function unreadInboxCount(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM admin_inbox WHERE read = 0 AND archived = 0`)
    .get() as { n: number }
  return row?.n ?? 0
}

function buildDigest(input: {
  tickets: NewTicket[]
  replies: NewTicketReply[]
  inbox: NewInbox[]
  openTickets: number
  unreadEmails: number
  sinceMs: number
  now: number
}): { subject: string; text: string; html: string } {
  const { tickets, replies, inbox, openTickets, unreadEmails, sinceMs, now } = input
  const adminUrl = `${appPublicUrl()}/admin-v2`
  const nTickets = tickets.length
  const nReplies = replies.length
  const nEmails = inbox.length

  const parts: string[] = []
  if (nTickets) parts.push(`${nTickets} new ticket${nTickets === 1 ? '' : 's'}`)
  if (nReplies) parts.push(`${nReplies} ticket repl${nReplies === 1 ? 'y' : 'ies'}`)
  if (nEmails) parts.push(`${nEmails} new email${nEmails === 1 ? '' : 's'}`)
  const subject = `[VeriLock] ${parts.join(', ') || 'Activity'} · ${openTickets} open · ${unreadEmails} unread`

  const textLines: string[] = [
    'VeriLock admin digest',
    `Window: ${formatWhen(sinceMs)} → ${formatWhen(now)}`,
    '',
    `New tickets: ${nTickets}`,
    `Customer replies: ${nReplies}`,
    `New inbox emails: ${nEmails}`,
    `Open tickets (total): ${openTickets}`,
    `Unread inbox (total): ${unreadEmails}`,
    '',
    `Open admin: ${adminUrl}`,
    '',
  ]

  if (tickets.length) {
    textLines.push('── New support tickets ──')
    for (const t of tickets.slice(0, PREVIEW_LIMIT)) {
      textLines.push(
        `• [${t.publicId}] ${t.subject}`,
        `  ${t.name} <${t.email}> · ${formatWhen(t.createdAt)} · ${t.status}`,
      )
      if (t.bodyPreview) textLines.push(`  “${t.bodyPreview}”`)
      textLines.push('')
    }
    if (tickets.length > PREVIEW_LIMIT) {
      textLines.push(`  …and ${tickets.length - PREVIEW_LIMIT} more tickets`)
      textLines.push('')
    }
  }

  if (replies.length) {
    textLines.push('── Customer replies ──')
    for (const r of replies.slice(0, PREVIEW_LIMIT)) {
      textLines.push(
        `• [${r.publicId}] ${r.subject}`,
        `  ${r.name} <${r.email}> · ${formatWhen(r.createdAt)}`,
      )
      if (r.bodyPreview) textLines.push(`  “${r.bodyPreview}”`)
      textLines.push('')
    }
    if (replies.length > PREVIEW_LIMIT) {
      textLines.push(`  …and ${replies.length - PREVIEW_LIMIT} more replies`)
      textLines.push('')
    }
  }

  if (inbox.length) {
    textLines.push('── New inbox emails ──')
    for (const e of inbox.slice(0, PREVIEW_LIMIT)) {
      const from = e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail
      textLines.push(`• ${e.subject}`, `  ${from} · ${formatWhen(e.receivedAt)}`)
      if (e.bodyPreview) textLines.push(`  “${e.bodyPreview}”`)
      textLines.push('')
    }
    if (inbox.length > PREVIEW_LIMIT) {
      textLines.push(`  …and ${inbox.length - PREVIEW_LIMIT} more emails`)
      textLines.push('')
    }
  }

  textLines.push('—', 'Throttle: at most one digest per hour.')

  const section = (title: string, body: string) =>
    `<h2 style="font-size:14px;margin:20px 0 8px;color:#0f172a">${escapeHtml(title)}</h2>${body}`

  const ticketHtml = tickets
    .slice(0, PREVIEW_LIMIT)
    .map(
      t => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:0 0 8px;background:#fff">
        <div style="font-weight:600;color:#0f172a">[${escapeHtml(t.publicId)}] ${escapeHtml(t.subject)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(t.name)} &lt;${escapeHtml(t.email)}&gt; · ${escapeHtml(formatWhen(t.createdAt))} · ${escapeHtml(t.status)}</div>
        ${t.bodyPreview ? `<div style="font-size:13px;color:#334155;margin-top:6px;font-style:italic">“${escapeHtml(t.bodyPreview)}”</div>` : ''}
      </div>`,
    )
    .join('')

  const replyHtml = replies
    .slice(0, PREVIEW_LIMIT)
    .map(
      r => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:0 0 8px;background:#fff">
        <div style="font-weight:600;color:#0f172a">[${escapeHtml(r.publicId)}] ${escapeHtml(r.subject)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(r.name)} &lt;${escapeHtml(r.email)}&gt; · ${escapeHtml(formatWhen(r.createdAt))}</div>
        ${r.bodyPreview ? `<div style="font-size:13px;color:#334155;margin-top:6px;font-style:italic">“${escapeHtml(r.bodyPreview)}”</div>` : ''}
      </div>`,
    )
    .join('')

  const inboxHtml = inbox
    .slice(0, PREVIEW_LIMIT)
    .map(e => {
      const from = e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail
      return `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:0 0 8px;background:#fff">
        <div style="font-weight:600;color:#0f172a">${escapeHtml(e.subject)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px">${escapeHtml(from)} · ${escapeHtml(formatWhen(e.receivedAt))}</div>
        ${e.bodyPreview ? `<div style="font-size:13px;color:#334155;margin-top:6px;font-style:italic">“${escapeHtml(e.bodyPreview)}”</div>` : ''}
      </div>`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <h1 style="font-size:18px;margin:0 0 4px">VeriLock admin digest</h1>
    <p style="margin:0 0 16px;font-size:13px;color:#64748b">${escapeHtml(formatWhen(sinceMs))} → ${escapeHtml(formatWhen(now))}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span style="background:#ecfdf5;color:#0f766e;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600">${nTickets} new ticket${nTickets === 1 ? '' : 's'}</span>
      <span style="background:#eff6ff;color:#1d4ed8;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600">${nReplies} repl${nReplies === 1 ? 'y' : 'ies'}</span>
      <span style="background:#fff7ed;color:#c2410c;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600">${nEmails} email${nEmails === 1 ? '' : 's'}</span>
    </div>
    <p style="font-size:13px;color:#64748b;margin:0 0 16px">
      Queue: <strong>${openTickets}</strong> open tickets · <strong>${unreadEmails}</strong> unread inbox
    </p>
    <p style="margin:0 0 20px">
      <a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600">Open admin</a>
    </p>
    ${tickets.length ? section('New support tickets', ticketHtml) : ''}
    ${replies.length ? section('Customer replies', replyHtml) : ''}
    ${inbox.length ? section('New inbox emails', inboxHtml) : ''}
    <p style="font-size:11px;color:#94a3b8;margin-top:24px">At most one digest per hour. Disable with ADMIN_DIGEST_ENABLED=false.</p>
  </div>
</body></html>`

  return { subject, text: textLines.join('\n'), html }
}

export async function runAdminActivityDigestPass(): Promise<{
  sent: boolean
  skipped: string | null
  tickets: number
  replies: number
  inbox: number
}> {
  if (!isDigestEnabled()) {
    return { sent: false, skipped: 'disabled', tickets: 0, replies: 0, inbox: 0 }
  }
  if (!isResendSendEnabled()) {
    return { sent: false, skipped: 'resend_disabled', tickets: 0, replies: 0, inbox: 0 }
  }

  const now = Date.now()

  // First boot: set watermark so we only notify on future activity.
  if (getKv(KV_BOOTSTRAPPED) !== '1') {
    setLastSentAt(now)
    setKv(KV_BOOTSTRAPPED, '1')
    console.log('[admin-digest] bootstrapped watermark; will notify on new activity only')
    return { sent: false, skipped: 'bootstrap', tickets: 0, replies: 0, inbox: 0 }
  }

  const lastSent = getLastSentAt() ?? now
  const tickets = loadNewTickets(lastSent)
  const replies = loadNewCustomerReplies(lastSent)
  const inbox = loadNewInbox(lastSent)

  if (tickets.length === 0 && replies.length === 0 && inbox.length === 0) {
    return { sent: false, skipped: 'no_activity', tickets: 0, replies: 0, inbox: 0 }
  }

  const elapsed = now - lastSent
  const minMs = minIntervalMs()
  if (elapsed < minMs) {
    console.log('[admin-digest] throttled', {
      waitMs: minMs - elapsed,
      tickets: tickets.length,
      replies: replies.length,
      inbox: inbox.length,
    })
    return {
      sent: false,
      skipped: 'throttled',
      tickets: tickets.length,
      replies: replies.length,
      inbox: inbox.length,
    }
  }

  const openTickets = openTicketCount()
  const unreadEmails = unreadInboxCount()
  const { subject, text, html } = buildDigest({
    tickets,
    replies,
    inbox,
    openTickets,
    unreadEmails,
    sinceMs: lastSent,
    now,
  })

  const result = await sendTransactionalEmail({
    to: digestTo(),
    subject,
    text,
    html,
  })

  if (!result.ok) {
    if ('skipped' in result && result.skipped) {
      console.log('[admin-digest] send skipped', result.reason)
      return {
        sent: false,
        skipped: result.reason,
        tickets: tickets.length,
        replies: replies.length,
        inbox: inbox.length,
      }
    }
    console.error('[admin-digest] send failed', 'error' in result ? result.error : result)
    return {
      sent: false,
      skipped: 'send_failed',
      tickets: tickets.length,
      replies: replies.length,
      inbox: inbox.length,
    }
  }

  // Advance watermark only after successful send so failures retry next pass.
  setLastSentAt(now)
  console.log('[admin-digest] sent', {
    id: result.id,
    to: digestTo(),
    tickets: tickets.length,
    replies: replies.length,
    inbox: inbox.length,
  })

  return {
    sent: true,
    skipped: null,
    tickets: tickets.length,
    replies: replies.length,
    inbox: inbox.length,
  }
}

export function startAdminActivityDigestWorker(): void {
  if (!isDigestEnabled()) {
    console.log('[admin-digest] worker disabled (ADMIN_DIGEST_ENABLED)')
    return
  }

  const interval = pollMs()
  const minH = Math.round(minIntervalMs() / 3600000 * 10) / 10
  console.log(
    `[admin-digest] worker: poll every ${Math.round(interval / 60000)}m, min interval ${minH}h, to ${digestTo()}`,
  )

  const run = () => {
    void runAdminActivityDigestPass().catch(err => {
      console.error('[admin-digest] pass failed', err)
    })
  }

  setTimeout(run, 60_000)
  const timer = setInterval(run, interval)
  if (typeof timer.unref === 'function') timer.unref()
}
