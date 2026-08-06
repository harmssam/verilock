/**
 * Read-only operator admin dashboard aggregates (snapshot + 90-day daily series).
 * Kept out of db.ts so product schema/CRUD stays separable from ops reporting.
 */
import { db } from './db.js'

const TIMELINE_DAYS = 90 as const
const MS_PER_DAY = 24 * 60 * 60 * 1000

function countScalar(sql: string): number {
  const row = db.prepare(sql).get() as { n: number } | undefined
  return Number(row?.n ?? 0)
}

function countsByColumn(sql: string): Record<string, number> {
  const rows = db.prepare(sql).all() as Array<{ key: string; n: number }>
  const out: Record<string, number> = {}
  for (const row of rows) {
    const key = row.key == null || row.key === '' ? 'unknown' : String(row.key)
    out[key] = Number(row.n ?? 0)
  }
  return out
}

/** UTC calendar day keys for the last `dayCount` days (oldest → newest), including today. */
function timelineDayKeys(dayCount: number, nowMs: number): { days: string[]; startMs: number } {
  const now = new Date(nowMs)
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days: string[] = []
  for (let i = dayCount - 1; i >= 0; i--) {
    days.push(new Date(todayUtc - i * MS_PER_DAY).toISOString().slice(0, 10))
  }
  return { days, startMs: todayUtc - (dayCount - 1) * MS_PER_DAY }
}

function fillDailySeries(
  dayKeys: string[],
  rows: Array<{ day: string; n: number | string | null | undefined }>,
): number[] {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (!row.day) continue
    map.set(String(row.day), Number(row.n ?? 0) || 0)
  }
  return dayKeys.map(d => map.get(d) ?? 0)
}

/** SQL must select `day` (YYYY-MM-DD) and `n`, with a single `?` bound to startMs. */
function dailyCountSeries(dayKeys: string[], startMs: number, sql: string): number[] {
  const rows = db.prepare(sql).all(startMs) as Array<{ day: string; n: number }>
  return fillDailySeries(dayKeys, rows)
}

function dayExpr(col: string): string {
  return `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch')`
}

/**
 * Daily activity for admin sparklines (always 90 UTC days, oldest → newest).
 * Values are new activity that day — not running totals. UI slices to 30/60/90.
 */
export interface AdminStatsTimeline {
  dayCount: typeof TIMELINE_DAYS
  days: string[]
  startMs: number
  series: {
    documentsCreated: number[]
    documentsLocked: number[]
    uniqueWalletsFirstSeen: number[]
    signatures: number[]
    parties: number[]
    attestations: number[]
    dataArchives: number[]
    creditGranted: number[]
    creditSpent: number[]
    sessionsCreated: number[]
    supportTickets: number[]
  }
}

export interface AdminStats {
  generatedAt: number
  documents: {
    total: number
    byStatus: Record<string, number>
    locked: number
    withLockedAt: number
    createdLast24h: number
    createdLast7d: number
    /** `creator_address LIKE 'GUEST:%'` - guest-native docs (never claimed). */
    guestCreated: number
    /** `claimed_from_guest = 1` - guest docs later claimed onto a wallet. */
    claimedFromGuest: number
  }
  wallets: {
    uniqueCreators: number
    uniqueSigners: number
    uniquePartyWallets: number
    uniqueAll: number
  }
  signatures: { total: number }
  parties: { total: number; withWallet: number }
  attestations: { total: number; byStatus: Record<string, number> }
  dataArchives: { total: number; onChain: number }
  sessions: { verifiedActive: number }
  credits: { accountsWithBalance: number; totalBalance: number }
  recentDocuments: Array<{
    id: string
    slug: string
    title: string
    status: string
    creatorAddress: string
    createdAt: number
    lockedAt: number | null
  }>
  support: {
    total: number
    open: number
    byStatus: Record<string, number>
  }
  timeline: AdminStatsTimeline
}

function emptySeries(len: number): number[] {
  return Array.from({ length: len }, () => 0)
}

function buildTimeline(now: number): AdminStatsTimeline {
  const { days, startMs } = timelineDayKeys(TIMELINE_DAYS, now)

  const countOn = (table: string, col: string, extraWhere = '') =>
    dailyCountSeries(
      days,
      startMs,
      `SELECT ${dayExpr(col)} AS day, COUNT(*) AS n
       FROM ${table}
       WHERE ${col} >= ?${extraWhere ? ` AND ${extraWhere}` : ''}
       GROUP BY day`,
    )

  const documentsCreated = countOn('documents', 'created_at')
  const documentsLocked = dailyCountSeries(
    days,
    startMs,
    `SELECT ${dayExpr('locked_at')} AS day, COUNT(*) AS n
     FROM documents
     WHERE locked_at IS NOT NULL AND locked_at >= ?
     GROUP BY day`,
  )
  const signatures = countOn('signatures', 'signed_at')
  // Parties have no created_at — attribute to the parent document's created_at.
  const parties = dailyCountSeries(
    days,
    startMs,
    `SELECT ${dayExpr('doc.created_at')} AS day, COUNT(*) AS n
     FROM document_parties p
     INNER JOIN documents doc ON doc.id = p.document_id
     WHERE doc.created_at >= ?
     GROUP BY day`,
  )
  const attestations = countOn('attestations', 'created_at')
  const dataArchives = countOn('document_data_archives', 'created_at')
  const sessionsCreated = countOn('sessions', 'created_at')

  let supportTickets = emptySeries(days.length)
  try {
    supportTickets = countOn('support_tickets', 'created_at')
  } catch (err) {
    console.error('[admin] support timeline unavailable', err)
  }

  const creditRows = db
    .prepare(
      `SELECT ${dayExpr('created_at')} AS day,
              COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS granted,
              COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS spent
       FROM credit_ledger
       WHERE created_at >= ?
       GROUP BY day`,
    )
    .all(startMs) as Array<{ day: string; granted: number; spent: number }>
  const creditGranted = fillDailySeries(
    days,
    creditRows.map(r => ({ day: r.day, n: r.granted })),
  )
  const creditSpent = fillDailySeries(
    days,
    creditRows.map(r => ({ day: r.day, n: r.spent })),
  )

  let uniqueWalletsFirstSeen = emptySeries(days.length)
  try {
    const walletRows = db
      .prepare(
        `WITH events AS (
           SELECT UPPER(REPLACE(creator_address, ' ', '')) AS a, created_at AS t
           FROM documents
           WHERE creator_address IS NOT NULL AND TRIM(creator_address) != ''
             AND creator_address NOT LIKE 'GUEST:%'
           UNION ALL
           SELECT UPPER(REPLACE(signer_address, ' ', '')), signed_at
           FROM signatures
           WHERE signer_address IS NOT NULL AND TRIM(signer_address) != ''
           UNION ALL
           SELECT UPPER(REPLACE(p.wallet_address, ' ', '')),
                  COALESCE(p.signed_at, doc.created_at)
           FROM document_parties p
           INNER JOIN documents doc ON doc.id = p.document_id
           WHERE p.wallet_address IS NOT NULL AND TRIM(p.wallet_address) != ''
         ),
         first_seen AS (
           SELECT a, MIN(t) AS t FROM events GROUP BY a
         )
         SELECT ${dayExpr('t')} AS day, COUNT(*) AS n
         FROM first_seen
         WHERE t >= ?
         GROUP BY day`,
      )
      .all(startMs) as Array<{ day: string; n: number }>
    uniqueWalletsFirstSeen = fillDailySeries(days, walletRows)
  } catch (err) {
    console.error('[admin] wallet first-seen timeline unavailable', err)
  }

  return {
    dayCount: TIMELINE_DAYS,
    days,
    startMs,
    series: {
      documentsCreated,
      documentsLocked,
      uniqueWalletsFirstSeen,
      signatures,
      parties,
      attestations,
      dataArchives,
      creditGranted,
      creditSpent,
      sessionsCreated,
      supportTickets,
    },
  }
}

function supportSnapshot(): AdminStats['support'] {
  try {
    const byStatus = countsByColumn(
      `SELECT status AS key, COUNT(*) AS n FROM support_tickets GROUP BY status`,
    )
    const total = Object.values(byStatus).reduce((sum, n) => sum + Number(n || 0), 0)
    const open =
      Number(byStatus.open || 0) +
      Number(byStatus.in_progress || 0) +
      Number(byStatus.waiting_customer || 0)
    return { total, open, byStatus }
  } catch (err) {
    console.error('[admin] support stats unavailable', err)
    return { total: 0, open: 0, byStatus: {} }
  }
}

/** Snapshot + 90-day daily series for the operator admin portal. */
export function getAdminStats(): AdminStats {
  const now = Date.now()
  const byStatus = countsByColumn(
    `SELECT status AS key, COUNT(*) AS n FROM documents GROUP BY status`,
  )
  const lockedByStatus = Number(byStatus.locked ?? 0)
  const withLockedAt = countScalar(
    `SELECT COUNT(*) AS n FROM documents WHERE locked_at IS NOT NULL`,
  )
  const guestCreated = countScalar(
    `SELECT COUNT(*) AS n FROM documents WHERE creator_address LIKE 'GUEST:%'`,
  )
  const claimedFromGuest = countScalar(
    `SELECT COUNT(*) AS n FROM documents WHERE claimed_from_guest = 1`,
  )

  const uniqueCreators = countScalar(
    `SELECT COUNT(DISTINCT UPPER(REPLACE(creator_address, ' ', ''))) AS n
     FROM documents
     WHERE creator_address IS NOT NULL AND TRIM(creator_address) != ''
       AND creator_address NOT LIKE 'GUEST:%'`,
  )
  const uniqueSigners = countScalar(
    `SELECT COUNT(DISTINCT UPPER(REPLACE(signer_address, ' ', ''))) AS n
     FROM signatures
     WHERE signer_address IS NOT NULL AND TRIM(signer_address) != ''`,
  )
  const uniquePartyWallets = countScalar(
    `SELECT COUNT(DISTINCT UPPER(REPLACE(wallet_address, ' ', ''))) AS n
     FROM document_parties
     WHERE wallet_address IS NOT NULL AND TRIM(wallet_address) != ''`,
  )
  const uniqueAll = countScalar(
    `SELECT COUNT(*) AS n FROM (
       SELECT UPPER(REPLACE(creator_address, ' ', '')) AS a FROM documents
         WHERE creator_address IS NOT NULL AND TRIM(creator_address) != ''
           AND creator_address NOT LIKE 'GUEST:%'
       UNION
       SELECT UPPER(REPLACE(signer_address, ' ', '')) FROM signatures
         WHERE signer_address IS NOT NULL AND TRIM(signer_address) != ''
       UNION
       SELECT UPPER(REPLACE(wallet_address, ' ', '')) FROM document_parties
         WHERE wallet_address IS NOT NULL AND TRIM(wallet_address) != ''
     )`,
  )

  const creditRow = db
    .prepare(
      `SELECT COUNT(*) AS accounts,
              COALESCE(SUM(balance), 0) AS total
       FROM credit_accounts
       WHERE balance > 0`,
    )
    .get() as { accounts: number; total: number } | undefined

  const recentRows = db
    .prepare(
      `SELECT id, slug, title, status, creator_address AS creatorAddress,
              created_at AS createdAt, locked_at AS lockedAt
       FROM documents
       ORDER BY created_at DESC
       LIMIT 12`,
    )
    .all() as Array<{
    id: string
    slug: string
    title: string
    status: string
    creatorAddress: string
    createdAt: number
    lockedAt: number | null
  }>

  return {
    generatedAt: now,
    documents: {
      total: countScalar(`SELECT COUNT(*) AS n FROM documents`),
      byStatus,
      locked: lockedByStatus,
      withLockedAt,
      createdLast24h: Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS n FROM documents WHERE created_at >= ?`)
            .get(now - MS_PER_DAY) as { n: number } | undefined
        )?.n ?? 0,
      ),
      createdLast7d: Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS n FROM documents WHERE created_at >= ?`)
            .get(now - 7 * MS_PER_DAY) as { n: number } | undefined
        )?.n ?? 0,
      ),
      guestCreated,
      claimedFromGuest,
    },
    wallets: {
      uniqueCreators,
      uniqueSigners,
      uniquePartyWallets,
      uniqueAll,
    },
    signatures: {
      total: countScalar(`SELECT COUNT(*) AS n FROM signatures`),
    },
    parties: {
      total: countScalar(`SELECT COUNT(*) AS n FROM document_parties`),
      withWallet: countScalar(
        `SELECT COUNT(*) AS n FROM document_parties
         WHERE wallet_address IS NOT NULL AND TRIM(wallet_address) != ''`,
      ),
    },
    attestations: {
      total: countScalar(`SELECT COUNT(*) AS n FROM attestations`),
      byStatus: countsByColumn(
        `SELECT status AS key, COUNT(*) AS n FROM attestations GROUP BY status`,
      ),
    },
    dataArchives: {
      total: countScalar(`SELECT COUNT(*) AS n FROM document_data_archives`),
      onChain: countScalar(
        `SELECT COUNT(*) AS n FROM document_data_archives WHERE on_chain = 1`,
      ),
    },
    sessions: {
      verifiedActive: Number(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM sessions WHERE verified = 1 AND expires_at > ?`,
            )
            .get(now) as { n: number } | undefined
        )?.n ?? 0,
      ),
    },
    credits: {
      accountsWithBalance: Number(creditRow?.accounts ?? 0),
      totalBalance: Number(creditRow?.total ?? 0),
    },
    support: supportSnapshot(),
    recentDocuments: recentRows.map(r => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      status: r.status,
      creatorAddress: r.creatorAddress,
      createdAt: r.createdAt,
      lockedAt: r.lockedAt,
    })),
    timeline: buildTimeline(now),
  }
}
