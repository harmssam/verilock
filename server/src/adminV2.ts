/**
 * Admin v2 portal API — dashboard KPI, recent activity, notifications,
 * audit log, X Ideas pipeline, ticket tags, and bulk endpoints.
 * Shares the same cookie session (verilock_admin) as the existing admin.
 */
import type { Express, Request, Response, NextFunction } from 'express'
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { getSupportTicketCounts, SUPPORT_TICKET_STATUSES, updateSupportTicketStatus } from './supportTickets.js'
import { isAdminConfigured, adminPublicFeatures } from './admin.js'

// ── Helper: column existence check ────────────────────────────────────────

function columnExists(table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some(c => c.name === column)
}

// ── Audit Log ─────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    metadata TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON admin_audit_log(action);
  CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at);
`)

function logAdminAction(
  action: string,
  actor: string,
  targetType?: string,
  targetId?: string,
  detail?: string,
  metadata?: Record<string, unknown>,
): void {
  try {
    db.prepare(
      `INSERT INTO admin_audit_log (id, action, actor, target_type, target_id, detail, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      action,
      actor,
      targetType ?? null,
      targetId ?? null,
      detail ?? null,
      metadata ? JSON.stringify(metadata) : null,
      Date.now(),
    )
  } catch (err) {
    console.error('[admin-v2] audit log insert failed', err)
  }
}

// ── X Ideas Pipeline ──────────────────────────────────────────────────────

// Add status + posted_url columns to existing admin_x_ideas table
if (!columnExists('admin_x_ideas', 'status')) {
  db.exec("ALTER TABLE admin_x_ideas ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'")
}
if (!columnExists('admin_x_ideas', 'posted_url')) {
  db.exec("ALTER TABLE admin_x_ideas ADD COLUMN posted_url TEXT NOT NULL DEFAULT ''")
}

// ── Ticket Tags ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_ticket_tags (
    ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
    tag TEXT NOT NULL,
    PRIMARY KEY (ticket_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_admin_ticket_tags_tag ON admin_ticket_tags(tag);
  CREATE INDEX IF NOT EXISTS idx_admin_ticket_tags_ticket ON admin_ticket_tags(ticket_id);
`)

// ── Types ─────────────────────────────────────────────────────────────────

interface AdminV2DashboardActivity {
  type: string
  title: string
  slug?: string | null
  time: string
}

interface AdminV2DashboardResponse {
  kpi: {
    documentsToday: number
    activeSessions: number
    openTickets: number
    creditBalance: number
  }
  recentActivity: AdminV2DashboardActivity[]
}

interface AdminV2Notification {
  type: 'new_email' | 'new_ticket' | 'ticket_reply'
  title: string
  subtitle: string
  id: string
}

// ── Dashboard helpers ─────────────────────────────────────────────────────

function countDocumentsToday(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM documents
       WHERE created_at > ?`,
    )
    .get(Date.now() - 24 * 60 * 60 * 1000) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

function countActiveSessions(): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as n FROM sessions
       WHERE verified = 1 AND expires_at > ?`,
    )
    .get(Date.now()) as { n: number } | undefined
  return Number(row?.n ?? 0)
}

function getCreditBalance(): number {
  const row = db
    .prepare(`SELECT COALESCE(SUM(balance), 0) as n FROM credit_accounts`)
    .get() as { n: number } | undefined
  return Number(row?.n ?? 0)
}

function getRecentActivity(): AdminV2DashboardActivity[] {
  const limit = 10
  const rows = db
    .prepare(
      `SELECT
        'document_created' as type,
        title,
        slug,
        created_at as time
       FROM documents
       UNION ALL
       SELECT
        'ticket_opened' as type,
        subject as title,
        NULL as slug,
        created_at as time
       FROM support_tickets
       UNION ALL
       SELECT
        'signature_completed' as type,
        (SELECT d.title FROM documents d WHERE d.id = s.document_id) as title,
        (SELECT d.slug FROM documents d WHERE d.id = s.document_id) as slug,
        s.signed_at as time
       FROM signatures s
       WHERE s.signed_at IS NOT NULL
       ORDER BY time DESC
       LIMIT ?`,
    )
    .all(limit) as AdminV2DashboardActivity[]

  return rows.map(row => ({
    type: row.type,
    title: row.title || 'Untitled',
    slug: row.slug || null,
    time: new Date(row.time as unknown as number).toISOString(),
  }))
}

function getDashboard(): AdminV2DashboardResponse {
  const ticketCounts = getSupportTicketCounts()
  return {
    kpi: {
      documentsToday: countDocumentsToday(),
      activeSessions: countActiveSessions(),
      openTickets: ticketCounts.open,
      creditBalance: getCreditBalance(),
    },
    recentActivity: getRecentActivity(),
  }
}

// ── Notifications ─────────────────────────────────────────────────────────

function getNotifications(): { notifications: AdminV2Notification[]; total: number } {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000

  // Unread inbox emails (last 24h)
  const inboxEmails = db
    .prepare(
      `SELECT id, subject, from_name, received_at FROM admin_inbox
       WHERE received_at > ? AND archived = 0
       ORDER BY received_at DESC
       LIMIT 5`,
    )
    .all(dayAgo) as Array<{ id: string; subject: string; from_name: string; received_at: number }>

  // New tickets (last 24h, status=open)
  const newTickets = db
    .prepare(
      `SELECT id, public_id, subject, created_at FROM support_tickets
       WHERE created_at > ? AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 5`,
    )
    .all(dayAgo) as Array<{ id: string; public_id: string; subject: string; created_at: number }>

  // Recent customer replies
  const customerReplies = db
    .prepare(
      `SELECT m.id, m.ticket_id, m.created_at, t.public_id, t.subject
       FROM support_ticket_messages m
       JOIN support_tickets t ON t.id = m.ticket_id
       WHERE m.author_kind = 'customer' AND m.created_at > ?
       ORDER BY m.created_at DESC
       LIMIT 5`,
    )
    .all(dayAgo) as Array<{
    id: string; ticket_id: string; created_at: number; public_id: string; subject: string
  }>

  const notifications: { item: AdminV2Notification; ts: number }[] = []

  for (const e of inboxEmails) {
    const minutesAgo = Math.round((Date.now() - e.received_at) / 60000)
    const timeStr = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.round(minutesAgo / 60)}h ago`
    notifications.push({
      item: {
        type: 'new_email',
        title: e.subject || '(no subject)',
        subtitle: `from ${e.from_name || 'unknown'} · ${timeStr}`,
        id: e.id,
      },
      ts: e.received_at,
    })
  }

  for (const t of newTickets) {
    const minutesAgo = Math.round((Date.now() - t.created_at) / 60000)
    const timeStr = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.round(minutesAgo / 60)}h ago`
    notifications.push({
      item: {
        type: 'new_ticket',
        title: t.subject || '(no subject)',
        subtitle: `#${t.public_id} · ${timeStr}`,
        id: t.id,
      },
      ts: t.created_at,
    })
  }

  for (const r of customerReplies) {
    const minutesAgo = Math.round((Date.now() - r.created_at) / 60000)
    const timeStr = minutesAgo < 60 ? `${minutesAgo}m ago` : `${Math.round(minutesAgo / 60)}h ago`
    notifications.push({
      item: {
        type: 'ticket_reply',
        title: `Re: ${r.subject || '(no subject)'}`,
        subtitle: `customer replied · ${timeStr}`,
        id: r.ticket_id,
      },
      ts: r.created_at,
    })
  }

  // Sort by time descending
  notifications.sort((a, b) => b.ts - a.ts)
  const limited = notifications.slice(0, 10)

  return {
    notifications: limited.map(n => n.item),
    total: limited.length,
  }
}

// ── Ticket tag helpers ────────────────────────────────────────────────────

function getTicketTags(ticketId: string): string[] {
  const rows = db
    .prepare('SELECT tag FROM admin_ticket_tags WHERE ticket_id = ? ORDER BY tag')
    .all(ticketId) as Array<{ tag: string }>
  return rows.map(r => r.tag)
}

function setTicketTags(ticketId: string, tags: string[]): void {
  const clean = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(t => t.length > 0))]
  db.prepare('DELETE FROM admin_ticket_tags WHERE ticket_id = ?').run(ticketId)
  const insert = db.prepare(
    'INSERT OR IGNORE INTO admin_ticket_tags (ticket_id, tag) VALUES (?, ?)',
  )
  for (const tag of clean) {
    insert.run(ticketId, tag)
  }
}

function getAllTags(): string[] {
  const rows = db
    .prepare('SELECT DISTINCT tag FROM admin_ticket_tags ORDER BY tag')
    .all() as Array<{ tag: string }>
  return rows.map(r => r.tag)
}

// ── Route attachment ──────────────────────────────────────────────────────

export function attachAdminV2Routes(app: Express, requireAdmin: (req: Request, res: Response, next: NextFunction) => void): void {
  // Same features endpoint as existing admin, plus adminV2Enabled flag
  app.get('/api/admin-v2/features', (_req, res) => {
    const base = adminPublicFeatures()
    res.json({
      ...base,
      adminV2Enabled: isAdminConfigured(),
    })
  })

  // Dashboard KPI + activity feed
  app.get('/api/admin-v2/dashboard', requireAdmin, (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      const dashboard = getDashboard()
      res.json(dashboard)
    } catch (err) {
      console.error('[admin-v2] dashboard', err)
      res.status(500).json({ error: 'Could not load dashboard.' })
    }
  })

  // ── Notifications ────────────────────────────────────────────────────

  app.get('/api/admin-v2/notifications', requireAdmin, (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json(getNotifications())
    } catch (err) {
      console.error('[admin-v2] notifications', err)
      res.status(500).json({ error: 'Could not load notifications.' })
    }
  })

  // ── Bulk inbox operations ────────────────────────────────────────────

  app.post('/api/admin-v2/inbox/bulk', requireAdmin, (req, res) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown; archived?: unknown }
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        res.status(400).json({ error: 'ids (array of email ids) is required' })
        return
      }
      const archive = body.archived === true
      const ids = body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length === 0) {
        res.status(400).json({ error: 'No valid email ids provided' })
        return
      }

      const placeholders = ids.map(() => '?').join(',')
      db.prepare(
        `UPDATE admin_inbox SET archived = ? WHERE id IN (${placeholders})`,
      ).run(archive ? 1 : 0, ...ids)

      // Audit log
      const username = (res.locals as any).adminUser || 'admin'
      logAdminAction(
        archive ? 'inbox_bulk_archive' : 'inbox_bulk_unarchive',
        username,
        'inbox',
        undefined,
        `${ids.length} email(s) ${archive ? 'archived' : 'unarchived'}`,
        { ids },
      )

      res.json({ ok: true, updated: ids.length })
    } catch (err) {
      console.error('[admin-v2] inbox bulk', err)
      res.status(500).json({ error: 'Could not update emails.' })
    }
  })

  // Sidebar badge counts (lightweight — cheaper than two API calls)
  app.get('/api/admin-v2/sidebar-counts', requireAdmin, (_req, res) => {
    try {
      const inboxRow = db
        .prepare('SELECT COUNT(*) as n FROM admin_inbox WHERE read = 0 AND archived = 0')
        .get() as { n: number }
      const inboxUnread = Number(inboxRow?.n ?? 0)

      const ticketCounts = getSupportTicketCounts()
      const supportOpen = ticketCounts.open

      res.setHeader('Cache-Control', 'no-store')
      res.json({ inboxUnread, supportOpen })
    } catch (err) {
      console.error('[admin-v2] sidebar-counts', err)
      res.status(500).json({ error: 'Could not load sidebar counts.' })
    }
  })

  // Global search — searches inbox, tickets, ideas, documents, AND tags
  app.get('/api/admin-v2/search', requireAdmin, (req, res) => {
    try {
      const q = (typeof req.query.q === 'string' ? req.query.q : '').trim()
      if (!q || q.length < 2) {
        res.json({ results: [] })
        return
      }

      const like = `%${q}%`
      const limit = 20

      interface SearchResultItem {
        type: string
        id: string
        title: string
        subtitle: string
        url: string
      }

      const results: SearchResultItem[] = []

      // Search admin_inbox
      const inboxRows = db
        .prepare(
          `SELECT id, subject, from_email, from_name FROM admin_inbox
           WHERE (subject LIKE ? OR from_email LIKE ? OR body_text LIKE ?) AND archived = 0
           ORDER BY received_at DESC
           LIMIT ?`,
        )
        .all(like, like, like, limit) as Array<{
        id: string; subject: string; from_email: string; from_name: string
      }>
      for (const row of inboxRows) {
        results.push({
          type: 'inbox',
          id: row.id,
          title: row.subject || '(no subject)',
          subtitle: `from ${row.from_name || row.from_email}`,
          url: `?tab=inbox&email=${encodeURIComponent(row.id)}`,
        })
      }

      // Search support_tickets
      const ticketRows = db
        .prepare(
          `SELECT id, public_id, subject, email, status FROM support_tickets
           WHERE subject LIKE ? OR email LIKE ? OR public_id LIKE ?
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .all(like, like, like, limit) as Array<{
        id: string; public_id: string; subject: string; email: string; status: string
      }>
      for (const row of ticketRows) {
        results.push({
          type: 'ticket',
          id: row.id,
          title: row.subject || '(no subject)',
          subtitle: `#${row.public_id} · ${row.email}`,
          url: `?tab=support&ticket=${encodeURIComponent(row.id)}`,
        })
      }

      // Search ticket tags
      const tagTicketRows = db
        .prepare(
          `SELECT DISTINCT t.id, t.public_id, t.subject, t.email, t.status
           FROM support_tickets t
           JOIN admin_ticket_tags att ON att.ticket_id = t.id
           WHERE att.tag LIKE ?
           ORDER BY t.updated_at DESC
           LIMIT ?`,
        )
        .all(like, limit) as Array<{
        id: string; public_id: string; subject: string; email: string; status: string
      }>
      for (const row of tagTicketRows) {
        const url = `?tab=support&ticket=${encodeURIComponent(row.id)}`
        // Avoid duplicates (ticket might already be in results from subject/email search)
        if (!results.some(r => r.type === 'ticket' && r.id === row.id)) {
          results.push({
            type: 'ticket',
            id: row.id,
            title: row.subject || '(no subject)',
            subtitle: `#${row.public_id} · ${row.email} (tag match)`,
            url,
          })
        }
      }

      // Search admin_x_ideas
      const ideaRows = db
        .prepare(
          `SELECT id, copy, source_url FROM admin_x_ideas
           WHERE copy LIKE ? OR source_url LIKE ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(like, like, limit) as Array<{
        id: string; copy: string; source_url: string
      }>
      for (const row of ideaRows) {
        results.push({
          type: 'idea',
          id: row.id,
          title: row.copy.length > 80 ? row.copy.slice(0, 80) + '…' : row.copy,
          subtitle: row.source_url ? `Source: ${row.source_url.slice(0, 60)}` : 'X Idea',
          url: `?tab=content`,
        })
      }

      // Search documents
      const docRows = db
        .prepare(
          `SELECT id, slug, title FROM documents
           WHERE title LIKE ? OR slug LIKE ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(like, like, limit) as Array<{
        id: string; slug: string; title: string
      }>
      for (const row of docRows) {
        results.push({
          type: 'document',
          id: row.id,
          title: row.title || 'Untitled',
          subtitle: `/${row.slug}`,
          url: `/d/${row.slug}`,
        })
      }

      const final = results.slice(0, limit)
      res.setHeader('Cache-Control', 'no-store')
      res.json({ results: final })
    } catch (err) {
      console.error('[admin-v2] search', err)
      res.status(500).json({ error: 'Search failed.' })
    }
  })

  // Bulk ticket status change
  app.post('/api/admin-v2/tickets/bulk-status', requireAdmin, (req, res) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown; status?: unknown }
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        res.status(400).json({ error: 'ids (array of ticket ids) is required' })
        return
      }
      if (typeof body.status !== 'string') {
        res.status(400).json({ error: 'status (string) is required' })
        return
      }

      if (!(SUPPORT_TICKET_STATUSES as readonly string[]).includes(body.status)) {
        res.status(400).json({
          error: `Invalid status. Use one of: ${(SUPPORT_TICKET_STATUSES as readonly string[]).join(', ')}`,
        })
        return
      }

      const ids = body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length === 0) {
        res.status(400).json({ error: 'No valid ticket ids provided' })
        return
      }

      let updated = 0
      for (const id of ids) {
        const next = updateSupportTicketStatus(id, body.status as Parameters<typeof updateSupportTicketStatus>[1])
        if (next) updated++
      }

      // Audit log
      const username = (res.locals as any).adminUser || 'admin'
      logAdminAction(
        'ticket_bulk_status',
        username,
        'ticket',
        undefined,
        `${updated} ticket(s) set to ${body.status}`,
        { ids, status: body.status },
      )

      res.json({ ok: true, updated })
    } catch (err) {
      console.error('[admin-v2] bulk status', err)
      res.status(500).json({ error: 'Could not update tickets.' })
    }
  })

  // ── X Ideas Pipeline ─────────────────────────────────────────────────

  // Update pipeline status + posted_url for an idea
  app.patch('/api/admin-v2/x-ideas/:id/pipeline', requireAdmin, (req, res) => {
    try {
      const id = String(req.params.id ?? '')
      if (!id) {
        res.status(400).json({ error: 'Idea id is required.' })
        return
      }

      const body = (req.body ?? {}) as { status?: unknown; posted_url?: unknown }
      const updates: string[] = []
      const params: (string | number)[] = []

      if (typeof body.status === 'string' && body.status.trim()) {
        const validStatuses = ['draft', 'ready', 'scheduled', 'posted', 'archived']
        if (!validStatuses.includes(body.status)) {
          res.status(400).json({ error: `Invalid status. Use one of: ${validStatuses.join(', ')}` })
          return
        }
        updates.push('status = ?')
        params.push(body.status)
      }

      if (typeof body.posted_url === 'string') {
        updates.push('posted_url = ?')
        params.push(body.posted_url)
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'At least one of status or posted_url is required.' })
        return
      }

      updates.push('updated_at = ?')
      params.push(Date.now())
      params.push(id)

      db.prepare(
        `UPDATE admin_x_ideas SET ${updates.join(', ')} WHERE id = ?`,
      ).run(...params)

      const idea = db.prepare('SELECT * FROM admin_x_ideas WHERE id = ?').get(id) as Record<string, unknown> | undefined
      if (!idea) {
        res.status(404).json({ error: 'Idea not found.' })
        return
      }

      // Audit log
      const username = (res.locals as any).adminUser || 'admin'
      logAdminAction(
        'x_idea_pipeline_update',
        username,
        'x_idea',
        id,
        `Idea pipeline updated: ${body.status ?? 'no status change'}`,
        { status: body.status, posted_url: body.posted_url },
      )

      res.json({ idea })
    } catch (err) {
      console.error('[admin-v2] x-ideas pipeline', err)
      res.status(500).json({ error: 'Could not update idea pipeline.' })
    }
  })

  // ── Audit Log ────────────────────────────────────────────────────────

  app.get('/api/admin-v2/audit-log', requireAdmin, (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200)
      const offset = Math.max(Number(req.query.offset) || 0, 0)
      const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim() : null

      let sql = 'SELECT * FROM admin_audit_log'
      const params: (string | number)[] = []

      if (actionFilter) {
        sql += ' WHERE action = ?'
        params.push(actionFilter)
      }

      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const rows = db.prepare(sql).all(...params) as Array<{
        id: string; action: string; actor: string; target_type: string | null
        target_id: string | null; detail: string | null; metadata: string | null; created_at: number
      }>

      // Get total count for pagination
      let countSql = 'SELECT COUNT(*) as n FROM admin_audit_log'
      const countParams: string[] = []
      if (actionFilter) {
        countSql += ' WHERE action = ?'
        countParams.push(actionFilter)
      }
      const countRow = db.prepare(countSql).get(...countParams) as { n: number }

      // Get distinct actions for filter dropdown
      const actionRows = db
        .prepare('SELECT DISTINCT action FROM admin_audit_log ORDER BY action')
        .all() as Array<{ action: string }>

      res.setHeader('Cache-Control', 'no-store')
      res.json({
        entries: rows.map(r => ({
          ...r,
          metadata: r.metadata ? JSON.parse(r.metadata) : null,
        })),
        total: countRow.n,
        actions: actionRows.map(r => r.action),
      })
    } catch (err) {
      console.error('[admin-v2] audit-log', err)
      res.status(500).json({ error: 'Could not load audit log.' })
    }
  })

  // ── Ticket Tags ──────────────────────────────────────────────────────

  // Get all unique tags (for autocomplete)
  app.get('/api/admin-v2/tags', requireAdmin, (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store')
      res.json({ tags: getAllTags() })
    } catch (err) {
      console.error('[admin-v2] tags list', err)
      res.status(500).json({ error: 'Could not load tags.' })
    }
  })

  // Get tags for a specific ticket
  app.get('/api/admin-v2/tickets/:id/tags', requireAdmin, (req, res) => {
    try {
      const id = String(req.params.id ?? '')
      if (!id) {
        res.status(400).json({ error: 'Ticket id is required.' })
        return
      }
      res.setHeader('Cache-Control', 'no-store')
      res.json({ tags: getTicketTags(id) })
    } catch (err) {
      console.error('[admin-v2] ticket tags get', err)
      res.status(500).json({ error: 'Could not load ticket tags.' })
    }
  })

  // Replace tags for a ticket
  app.put('/api/admin-v2/tickets/:id/tags', requireAdmin, (req, res) => {
    try {
      const id = String(req.params.id ?? '')
      if (!id) {
        res.status(400).json({ error: 'Ticket id is required.' })
        return
      }

      const body = (req.body ?? {}) as { tags?: unknown }
      if (!Array.isArray(body.tags)) {
        res.status(400).json({ error: 'tags (array of strings) is required.' })
        return
      }

      const tags = body.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      setTicketTags(id, tags)

      // Audit log
      const username = (res.locals as any).adminUser || 'admin'
      logAdminAction(
        'ticket_tags_update',
        username,
        'ticket',
        id,
        `Tags set: ${tags.join(', ') || '(none)'}`,
        { tags },
      )

      res.json({ tags: getTicketTags(id) })
    } catch (err) {
      console.error('[admin-v2] ticket tags put', err)
      res.status(500).json({ error: 'Could not update ticket tags.' })
    }
  })

  // Batch get tags for multiple tickets (avoids N+1 requests client-side)
  app.post('/api/admin-v2/tickets/tags/batch', requireAdmin, (req, res) => {
    try {
      const body = (req.body ?? {}) as { ids?: unknown }
      if (!Array.isArray(body.ids) || body.ids.length === 0) {
        res.json({ tags: {} })
        return
      }
      const ids = body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (ids.length === 0) {
        res.json({ tags: {} })
        return
      }

      const tagsMap: Record<string, string[]> = {}
      const placeholders = ids.map(() => '?').join(',')
      const rows = db
        .prepare(
          `SELECT ticket_id, tag FROM admin_ticket_tags WHERE ticket_id IN (${placeholders}) ORDER BY tag`,
        )
        .all(...ids) as Array<{ ticket_id: string; tag: string }>

      for (const row of rows) {
        if (!tagsMap[row.ticket_id]) tagsMap[row.ticket_id] = []
        tagsMap[row.ticket_id].push(row.tag)
      }

      // Ensure all requested IDs have an entry (empty array if no tags)
      for (const id of ids) {
        if (!tagsMap[id]) tagsMap[id] = []
      }

      res.setHeader('Cache-Control', 'no-store')
      res.json({ tags: tagsMap })
    } catch (err) {
      console.error('[admin-v2] batch tags', err)
      res.status(500).json({ error: 'Could not load batch tags.' })
    }
  })

  // ── Customer Profile ──────────────────────────────────────────────

  app.get('/api/admin-v2/customer/:email/profile', requireAdmin, (req, res) => {
    try {
      const email = decodeURIComponent(String(req.params.email ?? '')).trim().toLowerCase()
      if (!email) {
        res.status(400).json({ error: 'Email is required.' })
        return
      }

      // All tickets for this email
      const tickets = db
        .prepare(
          `SELECT id, public_id, subject, status, created_at, updated_at
           FROM support_tickets
           WHERE LOWER(email) = ?
           ORDER BY created_at DESC
           LIMIT 50`,
        )
        .all(email) as Array<{
        id: string; public_id: string; subject: string; status: string
        created_at: number; updated_at: number
      }>

      // All draft/locked documents owned by this email
      const documents = db
        .prepare(
          `SELECT d.id, d.slug, d.title, d.status, d.created_at
           FROM documents d
           WHERE LOWER(d.creator_email) = ?
           ORDER BY d.created_at DESC
           LIMIT 50`,
        )
        .all(email) as Array<{
        id: string; slug: string; title: string; status: string; created_at: number
      }>

      res.setHeader('Cache-Control', 'no-store')
      res.json({ email, tickets, documents })
    } catch (err) {
      console.error('[admin-v2] customer profile', err)
      res.status(500).json({ error: 'Could not load customer profile.' })
    }
  })
}
