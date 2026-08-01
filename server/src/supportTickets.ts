/**
 * Support ticket persistence (operator queue + contact form).
 * Owns schema and all ticket/message queries — keep this out of db.ts.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { db } from './db.js'

export const SUPPORT_TICKET_STATUSES = [
  'open',
  'in_progress',
  'waiting_customer',
  'resolved',
  'closed',
] as const

export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number]

/** Explicit message taxonomy — do not infer from author_name. */
export const SUPPORT_MESSAGE_KINDS = [
  'customer',
  'human_reply',
  'auto_ack',
  'volume_notice',
  'internal',
] as const

export type SupportMessageKind = (typeof SUPPORT_MESSAGE_KINDS)[number]

/** UI/author channel (legacy + display). */
export type SupportMessageAuthorKind = 'customer' | 'operator' | 'system'

export interface SupportTicketRecord {
  id: string
  publicId: string
  name: string
  email: string
  /** Human-readable issue label (also used as email subject line). */
  subject: string
  /** Stable issue category id (e.g. wallet_connect, other). */
  issue: string | null
  /** Optional Nimiq wallet from a signed-in session (ops-only; not shown on public form). */
  walletAddress: string | null
  status: SupportTicketStatus
  documentSlug: string | null
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  volumeNoticeSentAt: number | null
}

export interface SupportTicketMessageRecord {
  id: string
  ticketId: string
  authorKind: SupportMessageAuthorKind
  authorName: string | null
  body: string
  resendMessageId: string | null
  createdAt: number
  messageKind: SupportMessageKind
}

export interface SupportTicketListItem extends SupportTicketRecord {
  messageCount: number
  lastMessageAt: number
  lastMessagePreview: string | null
  lastAuthorKind: SupportMessageAuthorKind | null
}

export interface SupportTicketCounts {
  total: number
  open: number
  byStatus: Record<string, number>
}

db.exec(`
  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    document_slug TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    author_kind TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    resend_message_id TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_email ON support_tickets(email);
  CREATE INDEX IF NOT EXISTS idx_support_tickets_updated ON support_tickets(updated_at);
  CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket ON support_ticket_messages(ticket_id);
`)

const ticketCols = db.prepare('PRAGMA table_info(support_tickets)').all() as Array<{ name: string }>
if (!ticketCols.some(col => col.name === 'volume_notice_sent_at')) {
  db.exec('ALTER TABLE support_tickets ADD COLUMN volume_notice_sent_at INTEGER')
}
if (!ticketCols.some(col => col.name === 'issue')) {
  db.exec('ALTER TABLE support_tickets ADD COLUMN issue TEXT')
  db.exec(`CREATE INDEX IF NOT EXISTS idx_support_tickets_issue ON support_tickets(issue)`)
}
if (!ticketCols.some(col => col.name === 'wallet_address')) {
  db.exec('ALTER TABLE support_tickets ADD COLUMN wallet_address TEXT')
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_support_tickets_wallet ON support_tickets(wallet_address)`,
  )
}

const messageCols = db
  .prepare('PRAGMA table_info(support_ticket_messages)')
  .all() as Array<{ name: string }>
if (!messageCols.some(col => col.name === 'message_kind')) {
  db.exec(`ALTER TABLE support_ticket_messages ADD COLUMN message_kind TEXT`)
  // Backfill once from legacy author_name / author_kind heuristics.
  db.exec(`
    UPDATE support_ticket_messages SET message_kind = CASE
      WHEN author_kind = 'customer' THEN 'customer'
      WHEN author_kind = 'system' THEN 'internal'
      WHEN author_name LIKE '%(auto-reply)%' THEN 'auto_ack'
      WHEN author_name LIKE '%(volume notice)%' THEN 'volume_notice'
      WHEN author_kind = 'operator' THEN 'human_reply'
      ELSE 'internal'
    END
    WHERE message_kind IS NULL OR TRIM(message_kind) = ''
  `)
}

db.exec(`CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_kind
  ON support_ticket_messages(message_kind)`)

// Composite index for fast ticket message lookups (list query + window functions)
db.exec(`CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_created
  ON support_ticket_messages(ticket_id, created_at DESC)`)

function isSupportTicketStatus(value: string): value is SupportTicketStatus {
  return (SUPPORT_TICKET_STATUSES as readonly string[]).includes(value)
}

function isMessageKind(value: string | null | undefined): value is SupportMessageKind {
  return (
    typeof value === 'string' &&
    (SUPPORT_MESSAGE_KINDS as readonly string[]).includes(value)
  )
}

function authorKindForMessageKind(kind: SupportMessageKind): SupportMessageAuthorKind {
  if (kind === 'customer') return 'customer'
  if (kind === 'internal') return 'system'
  return 'operator'
}

function mapTicketRow(row: {
  id: string
  public_id: string
  name: string
  email: string
  subject: string
  issue?: string | null
  wallet_address?: string | null
  status: string
  document_slug: string | null
  created_at: number
  updated_at: number
  resolved_at: number | null
  volume_notice_sent_at?: number | null
}): SupportTicketRecord {
  return {
    id: row.id,
    publicId: row.public_id,
    name: row.name,
    email: row.email,
    subject: row.subject,
    issue: row.issue?.trim() || null,
    walletAddress: row.wallet_address?.trim() || null,
    status: isSupportTicketStatus(row.status) ? row.status : 'open',
    documentSlug: row.document_slug,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    volumeNoticeSentAt:
      row.volume_notice_sent_at == null ? null : Number(row.volume_notice_sent_at),
  }
}

function mapMessageRow(row: {
  id: string
  ticket_id: string
  author_kind: string
  author_name: string | null
  body: string
  resend_message_id: string | null
  created_at: number
  message_kind?: string | null
}): SupportTicketMessageRecord {
  let messageKind: SupportMessageKind
  if (isMessageKind(row.message_kind)) {
    messageKind = row.message_kind
  } else if (row.author_kind === 'customer') {
    messageKind = 'customer'
  } else if (row.author_kind === 'system') {
    messageKind = 'internal'
  } else if ((row.author_name || '').includes('(auto-reply)')) {
    messageKind = 'auto_ack'
  } else if ((row.author_name || '').includes('(volume notice)')) {
    messageKind = 'volume_notice'
  } else if (row.author_kind === 'operator') {
    messageKind = 'human_reply'
  } else {
    messageKind = 'internal'
  }

  const authorKind =
    row.author_kind === 'operator' ||
    row.author_kind === 'system' ||
    row.author_kind === 'customer'
      ? row.author_kind
      : authorKindForMessageKind(messageKind)

  return {
    id: row.id,
    ticketId: row.ticket_id,
    authorKind,
    authorName: row.author_name,
    body: row.body,
    resendMessageId: row.resend_message_id,
    createdAt: row.created_at,
    messageKind,
  }
}

/** Extract optional agreement slug from free text (/d/slug or full URL). */
export function extractDocumentSlugFromText(
  ...parts: Array<string | null | undefined>
): string | null {
  const combined = parts.filter(Boolean).join('\n')
  const match = combined.match(/\/d\/([a-zA-Z0-9_-]{4,80})\b/i)
  if (!match?.[1]) return null
  return match[1].slice(0, 80)
}

function nextPublicTicketId(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `VL-${randomBytes(4).toString('hex').toUpperCase()}`
    const existing = db
      .prepare(`SELECT 1 AS n FROM support_tickets WHERE public_id = ?`)
      .get(candidate) as { n: number } | undefined
    if (!existing) return candidate
  }
  return `VL-${randomBytes(6).toString('hex').toUpperCase()}`
}

const TICKET_SELECT = `id, public_id, name, email, subject, issue, wallet_address, status, document_slug,
              created_at, updated_at, resolved_at, volume_notice_sent_at`

export function createSupportTicket(input: {
  name: string
  email: string
  subject: string
  message: string
  issue?: string | null
  walletAddress?: string | null
  documentSlug?: string | null
}): SupportTicketRecord {
  const now = Date.now()
  const id = randomUUID()
  const publicId = nextPublicTicketId()
  const documentSlug =
    (input.documentSlug?.trim() || extractDocumentSlugFromText(input.subject, input.message)) ??
    null
  const issue = input.issue?.trim() || null
  const walletAddress = input.walletAddress?.trim() || null
  const messageId = randomUUID()

  const insertTicket = db.prepare(`
    INSERT INTO support_tickets (
      id, public_id, name, email, subject, issue, wallet_address, status, document_slug,
      created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL)
  `)
  const insertMessage = db.prepare(`
    INSERT INTO support_ticket_messages (
      id, ticket_id, author_kind, author_name, body, resend_message_id, created_at, message_kind
    ) VALUES (?, ?, 'customer', ?, ?, NULL, ?, 'customer')
  `)

  const tx = db.transaction(() => {
    insertTicket.run(
      id,
      publicId,
      input.name,
      input.email.toLowerCase(),
      input.subject,
      issue,
      walletAddress,
      documentSlug,
      now,
      now,
    )
    insertMessage.run(messageId, id, input.name, input.message, now)
  })
  tx()

  return {
    id,
    publicId,
    name: input.name,
    email: input.email.toLowerCase(),
    subject: input.subject,
    issue,
    walletAddress,
    status: 'open',
    documentSlug,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    volumeNoticeSentAt: null,
  }
}

export function getSupportTicketById(id: string): SupportTicketRecord | null {
  const row = db.prepare(`SELECT ${TICKET_SELECT} FROM support_tickets WHERE id = ?`).get(id) as
    | Parameters<typeof mapTicketRow>[0]
    | undefined
  return row ? mapTicketRow(row) : null
}

export function getSupportTicketByPublicId(publicId: string): SupportTicketRecord | null {
  const row = db
    .prepare(`SELECT ${TICKET_SELECT} FROM support_tickets WHERE public_id = ?`)
    .get(publicId.trim().toUpperCase()) as Parameters<typeof mapTicketRow>[0] | undefined
  return row ? mapTicketRow(row) : null
}

export function listSupportTicketMessages(ticketId: string): SupportTicketMessageRecord[] {
  const rows = db
    .prepare(
      `SELECT id, ticket_id, author_kind, author_name, body, resend_message_id, created_at, message_kind
       FROM support_ticket_messages
       WHERE ticket_id = ?
       ORDER BY created_at ASC`,
    )
    .all(ticketId) as Array<Parameters<typeof mapMessageRow>[0]>
  return rows.map(mapMessageRow)
}

export function listSupportTickets(opts: {
  status?: SupportTicketStatus | 'active' | 'all'
  q?: string
  limit?: number
  offset?: number
} = {}): { tickets: SupportTicketListItem[]; total: number } {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)
  const status = opts.status ?? 'active'
  const q = opts.q?.trim().toLowerCase() ?? ''

  const where: string[] = []
  const params: Array<string | number> = []

  if (status === 'active') {
    where.push(`t.status IN ('open', 'in_progress', 'waiting_customer')`)
  } else if (status !== 'all' && isSupportTicketStatus(status)) {
    where.push(`t.status = ?`)
    params.push(status)
  }

  if (q) {
    where.push(
      `(LOWER(t.email) LIKE ? OR LOWER(t.subject) LIKE ? OR LOWER(t.name) LIKE ?
        OR LOWER(t.public_id) LIKE ? OR LOWER(COALESCE(t.document_slug, '')) LIKE ?
        OR LOWER(COALESCE(t.issue, '')) LIKE ?
        OR LOWER(COALESCE(t.wallet_address, '')) LIKE ?)`,
    )
    const like = `%${q}%`
    params.push(like, like, like, like, like, like, like)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS n FROM support_tickets t ${whereSql}`)
        .get(...params) as { n: number } | undefined
    )?.n ?? 0,
  )

  // Use a CTE with ROW_NUMBER() window function to get latest message per ticket
  // in a single pass, instead of N correlated subqueries per row.
  const rows = db
    .prepare(
      `WITH latest_msg AS (
         SELECT ticket_id, body, created_at, author_kind,
           ROW_NUMBER() OVER (PARTITION BY ticket_id ORDER BY created_at DESC) AS rn
         FROM support_ticket_messages
       ),
       msg_counts AS (
         SELECT ticket_id, COUNT(*) AS cnt
         FROM support_ticket_messages
         GROUP BY ticket_id
       )
       SELECT t.id, t.public_id, t.name, t.email, t.subject, t.issue, t.wallet_address, t.status, t.document_slug,
              t.created_at, t.updated_at, t.resolved_at, t.volume_notice_sent_at,
              COALESCE(mc.cnt, 0) AS message_count,
              lm.created_at AS last_message_at,
              lm.body AS last_message_preview,
              lm.author_kind AS last_author_kind
       FROM support_tickets t
       LEFT JOIN msg_counts mc ON mc.ticket_id = t.id
       LEFT JOIN latest_msg lm ON lm.ticket_id = t.id AND lm.rn = 1
       ${whereSql}
       ORDER BY t.updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<
    Parameters<typeof mapTicketRow>[0] & {
      message_count: number
      last_message_at: number | null
      last_message_preview: string | null
      last_author_kind: string | null
    }
  >

  const tickets: SupportTicketListItem[] = rows.map(row => {
    const base = mapTicketRow(row)
    const lastKind =
      row.last_author_kind === 'operator' ||
      row.last_author_kind === 'system' ||
      row.last_author_kind === 'customer'
        ? row.last_author_kind
        : null
    const preview = row.last_message_preview
      ? row.last_message_preview.replace(/\s+/g, ' ').trim().slice(0, 140)
      : null
    return {
      ...base,
      messageCount: Number(row.message_count ?? 0),
      lastMessageAt: Number(row.last_message_at ?? row.updated_at),
      lastMessagePreview: preview,
      lastAuthorKind: lastKind,
    }
  })

  return { tickets, total }
}

/** Cheap global counts for badge / stats (no list materialization). */
export function getSupportTicketCounts(): SupportTicketCounts {
  const rows = db
    .prepare(`SELECT status AS key, COUNT(*) AS n FROM support_tickets GROUP BY status`)
    .all() as Array<{ key: string; n: number }>
  const byStatus: Record<string, number> = {}
  for (const row of rows) {
    byStatus[row.key || 'unknown'] = Number(row.n ?? 0)
  }
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0)
  const open =
    Number(byStatus.open || 0) +
    Number(byStatus.in_progress || 0) +
    Number(byStatus.waiting_customer || 0)
  return { total, open, byStatus }
}

export function updateSupportTicketStatus(
  ticketId: string,
  status: SupportTicketStatus,
): SupportTicketRecord | null {
  if (!isSupportTicketStatus(status)) return null
  const existing = getSupportTicketById(ticketId)
  if (!existing) return null
  const now = Date.now()
  const resolvedAt =
    status === 'resolved' || status === 'closed' ? existing.resolvedAt ?? now : null
  db.prepare(
    `UPDATE support_tickets
     SET status = ?, updated_at = ?, resolved_at = ?
     WHERE id = ?`,
  ).run(status, now, resolvedAt, ticketId)
  return getSupportTicketById(ticketId)
}

export function updateSupportTicketDocumentSlug(
  ticketId: string,
  documentSlug: string | null,
): SupportTicketRecord | null {
  const existing = getSupportTicketById(ticketId)
  if (!existing) return null
  const slug = documentSlug?.trim() ? documentSlug.trim().slice(0, 80) : null
  const now = Date.now()
  db.prepare(
    `UPDATE support_tickets SET document_slug = ?, updated_at = ? WHERE id = ?`,
  ).run(slug, now, ticketId)
  return getSupportTicketById(ticketId)
}

export function addSupportTicketMessage(input: {
  ticketId: string
  messageKind: SupportMessageKind
  authorName?: string | null
  body: string
  resendMessageId?: string | null
  /**
   * When true (default for human_reply only), bump open/in_progress → waiting_customer.
   * Auto/volume notices never bump.
   */
  bumpStatus?: boolean
}): SupportTicketMessageRecord | null {
  const ticket = getSupportTicketById(input.ticketId)
  if (!ticket) return null
  const body = input.body.trim()
  if (!body) return null
  if (!isMessageKind(input.messageKind)) return null

  const now = Date.now()
  const id = randomUUID()
  const authorKind = authorKindForMessageKind(input.messageKind)

  db.prepare(
    `INSERT INTO support_ticket_messages (
      id, ticket_id, author_kind, author_name, body, resend_message_id, created_at, message_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ticketId,
    authorKind,
    input.authorName ?? null,
    body,
    input.resendMessageId ?? null,
    now,
    input.messageKind,
  )

  let nextStatus = ticket.status
  const shouldBump =
    input.bumpStatus !== false &&
    input.messageKind === 'human_reply' &&
    (ticket.status === 'open' || ticket.status === 'in_progress')
  if (shouldBump) {
    nextStatus = 'waiting_customer'
  }
  if (input.messageKind === 'customer' && ticket.status === 'waiting_customer') {
    nextStatus = 'in_progress'
  }

  const resolvedAt =
    nextStatus === 'resolved' || nextStatus === 'closed' ? ticket.resolvedAt ?? now : null

  db.prepare(
    `UPDATE support_tickets SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?`,
  ).run(nextStatus, now, resolvedAt, input.ticketId)

  return {
    id,
    ticketId: input.ticketId,
    authorKind,
    authorName: input.authorName ?? null,
    body,
    resendMessageId: input.resendMessageId ?? null,
    createdAt: now,
    messageKind: input.messageKind,
  }
}

/**
 * Tickets still waiting on a human reply after `minAgeMs`, not yet claimed for volume notice.
 * Uses message_kind = human_reply (not name heuristics).
 */
export function listSupportTicketsNeedingVolumeNotice(opts: {
  now?: number
  minAgeMs?: number
  limit?: number
} = {}): SupportTicketRecord[] {
  const now = opts.now ?? Date.now()
  const minAgeMs = opts.minAgeMs ?? 3 * 24 * 60 * 60 * 1000
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const cutoff = now - minAgeMs

  const rows = db
    .prepare(
      `SELECT ${TICKET_SELECT}
       FROM support_tickets t
       WHERE t.status IN ('open', 'in_progress')
         AND t.volume_notice_sent_at IS NULL
         AND COALESCE(
           (SELECT MAX(m.created_at) FROM support_ticket_messages m
            WHERE m.ticket_id = t.id AND m.message_kind = 'customer'),
           t.created_at
         ) <= ?
         AND NOT EXISTS (
           SELECT 1 FROM support_ticket_messages m
           WHERE m.ticket_id = t.id
             AND m.message_kind = 'human_reply'
         )
       ORDER BY t.created_at ASC
       LIMIT ?`,
    )
    .all(cutoff, limit) as Array<Parameters<typeof mapTicketRow>[0]>

  return rows.map(mapTicketRow)
}

/**
 * Atomically claim a ticket for the volume-notice email.
 * Returns true only if this caller owns the send (changes() === 1).
 */
export function claimSupportVolumeNotice(ticketId: string, at = Date.now()): boolean {
  const result = db
    .prepare(
      `UPDATE support_tickets
       SET volume_notice_sent_at = ?, updated_at = ?
       WHERE id = ? AND volume_notice_sent_at IS NULL`,
    )
    .run(at, at, ticketId)
  return result.changes === 1
}

/** Clear claim so a failed send can retry later. */
export function releaseSupportVolumeNoticeClaim(ticketId: string): void {
  db.prepare(
    `UPDATE support_tickets
     SET volume_notice_sent_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(Date.now(), ticketId)
}
