/**
 * Admin v2 portal API — dashboard KPI + recent activity.
 * Shares the same cookie session (verilock_admin) as the existing admin.
 */
import type { Express, Request, Response, NextFunction } from 'express'
import { db } from './db.js'
import { getSupportTicketCounts } from './supportTickets.js'
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
}
