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
