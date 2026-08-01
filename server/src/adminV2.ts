/**
 * Admin v2 portal API — dashboard KPI + recent activity.
 * Shares the same cookie session (verilock_admin) as the existing admin.
 * Also adds v2-specific bulk endpoints.
 */
import type { Express, Request, Response, NextFunction } from 'express'
import { db } from './db.js'
import { getSupportTicketCounts, SUPPORT_TICKET_STATUSES, updateSupportTicketStatus } from './supportTickets.js'
import { isAdminConfigured, adminPublicFeatures } from './admin.js'

// Re-expose the same features endpoint for v2 (no new env vars needed yet).
// We also add `adminV2Enabled` so the client can decide which admin to show.

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

  // Convert time to ISO string
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

  // Bulk inbox operations
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

      res.json({ ok: true, updated: ids.length })
    } catch (err) {
      console.error('[admin-v2] inbox bulk', err)
      res.status(500).json({ error: 'Could not update emails.' })
    }
  })

  // Sidebar badge counts (lightweight — cheaper than two API calls)
  app.get('/api/admin-v2/sidebar-counts', requireAdmin, (_req, res) => {
    try {
      // Unread inbox count
      const inboxRow = db
        .prepare('SELECT COUNT(*) as n FROM admin_inbox WHERE read = 0 AND archived = 0')
        .get() as { n: number }
      const inboxUnread = Number(inboxRow?.n ?? 0)

      // Open support tickets (aggregate from statuses)
      const ticketCounts = getSupportTicketCounts()
      const supportOpen = ticketCounts.open

      res.setHeader('Cache-Control', 'no-store')
      res.json({ inboxUnread, supportOpen })
    } catch (err) {
      console.error('[admin-v2] sidebar-counts', err)
      res.status(500).json({ error: 'Could not load sidebar counts.' })
    }
  })

  // Global search — simple LIKE across admin_inbox, support_tickets, admin_x_ideas, documents
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
        id: string
        subject: string
        from_email: string
        from_name: string
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
        id: string
        public_id: string
        subject: string
        email: string
        status: string
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

      // Search admin_x_ideas
      const ideaRows = db
        .prepare(
          `SELECT id, copy, source_url FROM admin_x_ideas
           WHERE copy LIKE ? OR source_url LIKE ?
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(like, like, limit) as Array<{
        id: string
        copy: string
        source_url: string
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
        id: string
        slug: string
        title: string
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

      // Trim to limit
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

      // Validate status
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

      res.json({ ok: true, updated })
    } catch (err) {
      console.error('[admin-v2] bulk status', err)
      res.status(500).json({ error: 'Could not update tickets.' })
    }
  })
}
