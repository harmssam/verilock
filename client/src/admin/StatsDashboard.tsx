/**
 * Operator admin stats tab: snapshot cards with 30/60/90-day activity sparklines.
 */
import { useState } from 'react'
import type { AdminStats, AdminTimelineRange } from './adminApi'

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

function shortAddress(addr: string): string {
  const a = addr.replace(/\s+/g, '')
  if (a.length <= 14) return a
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function supportOpenCount(stats: AdminStats): number {
  const by = stats.support?.byStatus
  if (by && Object.keys(by).length > 0) {
    return (
      Number(by.open || 0) +
      Number(by.in_progress || 0) +
      Number(by.waiting_customer || 0)
    )
  }
  const n = Number(stats.support?.open)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function supportTotalCount(stats: AdminStats): number {
  const by = stats.support?.byStatus
  if (by && Object.keys(by).length > 0) {
    return Object.values(by).reduce((sum, n) => sum + Number(n || 0), 0)
  }
  const n = Number(stats.support?.total)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function sliceRange(series: number[] | undefined, range: AdminTimelineRange): number[] {
  if (!series?.length) return []
  return series.slice(-range)
}

function sum(values: number[]): number {
  return values.reduce((acc, n) => acc + (Number(n) || 0), 0)
}

function periodCount(range: AdminTimelineRange, values: number[], unit: string): string {
  return `${sum(values).toLocaleString()} ${unit} · last ${range}d`
}

type SeriesKey = keyof NonNullable<AdminStats['timeline']>['series']

type StatCardModel = {
  id: string
  label: string
  value: number
  hint?: string
  period?: string
  series: number[]
  accent?: boolean
}

function buildStatCards(stats: AdminStats, range: AdminTimelineRange): StatCardModel[] {
  const series = stats.timeline?.series
  const take = (key: SeriesKey) => sliceRange(series?.[key], range)
  const hasTimeline = Boolean(series)

  const documentsCreated = take('documentsCreated')
  const documentsLocked = take('documentsLocked')
  const walletsNew = take('uniqueWalletsFirstSeen')
  const signatures = take('signatures')
  const parties = take('parties')
  const attestations = take('attestations')
  const archives = take('dataArchives')
  const creditGranted = take('creditGranted')
  const creditSpent = take('creditSpent')
  const sessions = take('sessionsCreated')
  const supportNew = take('supportTickets')
  const creditNet = creditGranted.map((g, i) => g - (creditSpent[i] ?? 0))

  const attEntries = Object.entries(stats.attestations.byStatus).sort((a, b) => b[1] - a[1])

  return [
    {
      id: 'documents',
      label: 'Documents',
      value: stats.documents.total,
      hint: `${stats.documents.createdLast24h} last 24h · ${stats.documents.createdLast7d} last 7d`,
      period: hasTimeline ? periodCount(range, documentsCreated, 'created') : undefined,
      series: documentsCreated,
      accent: true,
    },
    {
      id: 'locked',
      label: 'Locked on chain',
      value: stats.documents.locked,
      hint:
        stats.documents.withLockedAt !== stats.documents.locked
          ? `${stats.documents.withLockedAt} with locked_at`
          : 'status = locked',
      period: hasTimeline ? periodCount(range, documentsLocked, 'locked') : undefined,
      series: documentsLocked,
      accent: true,
    },
    {
      id: 'wallets',
      label: 'Unique wallets',
      value: stats.wallets.uniqueAll,
      hint: `${stats.wallets.uniqueCreators} creators · ${stats.wallets.uniqueSigners} signers`,
      period: hasTimeline ? periodCount(range, walletsNew, 'first seen') : undefined,
      series: walletsNew,
      accent: true,
    },
    {
      id: 'signatures',
      label: 'Signatures',
      value: stats.signatures.total,
      period: hasTimeline ? periodCount(range, signatures, 'signed') : undefined,
      series: signatures,
    },
    {
      id: 'parties',
      label: 'Parties',
      value: stats.parties.total,
      hint: `${stats.parties.withWallet} with wallet`,
      period: hasTimeline ? periodCount(range, parties, 'on new docs') : undefined,
      series: parties,
    },
    {
      id: 'attestations',
      label: 'Attestations',
      value: stats.attestations.total,
      hint: attEntries.length
        ? attEntries.map(([k, v]) => `${v} ${k}`).join(' · ')
        : 'none yet',
      period: hasTimeline ? periodCount(range, attestations, 'created') : undefined,
      series: attestations,
    },
    {
      id: 'archives',
      label: 'Data archives',
      value: stats.dataArchives.total,
      hint: `${stats.dataArchives.onChain} on-chain`,
      period: hasTimeline ? periodCount(range, archives, 'created') : undefined,
      series: archives,
    },
    {
      id: 'credits',
      label: 'Credit balance',
      value: stats.credits.totalBalance,
      hint: `${stats.credits.accountsWithBalance} wallets with balance`,
      period: hasTimeline
        ? `+${sum(creditGranted).toLocaleString()} granted · ${sum(creditSpent).toLocaleString()} spent · last ${range}d`
        : undefined,
      series: creditNet,
    },
    {
      id: 'sessions',
      label: 'Active sessions',
      value: stats.sessions.verifiedActive,
      period: hasTimeline ? periodCount(range, sessions, 'created') : undefined,
      series: sessions,
    },
    {
      id: 'support',
      label: 'Support open',
      value: supportOpenCount(stats),
      hint: `${supportTotalCount(stats)} total · open / in progress / waiting`,
      period: hasTimeline ? periodCount(range, supportNew, 'tickets') : undefined,
      series: supportNew,
      accent: true,
    },
  ]
}

const RANGES: AdminTimelineRange[] = [30, 60, 90]

export function StatsDashboard({
  stats,
  loading,
  error,
  onRefresh,
}: {
  stats: AdminStats | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const [range, setRange] = useState<AdminTimelineRange>(30)

  if (loading && !stats) {
    return <p className="admin-loading">Loading statistics…</p>
  }

  if (error && !stats) {
    return (
      <div>
        <p className="admin-error" role="alert">
          {error}
        </p>
        <button type="button" className="admin-btn admin-btn-primary" onClick={onRefresh}>
          Retry
        </button>
      </div>
    )
  }

  if (!stats) return null

  const cards = buildStatCards(stats, range)
  const statusEntries = Object.entries(stats.documents.byStatus).sort((a, b) => b[1] - a[1])
  const hasTimeline = Boolean(stats.timeline?.series)

  return (
    <div>
      <div className="admin-dash-head">
        <div>
          <h1>Database stats</h1>
          <p className="admin-dash-meta">Updated {formatWhen(stats.generatedAt)}</p>
        </div>
        <div className="admin-dash-actions">
          <div className="admin-range" role="group" aria-label="Timeline range">
            {RANGES.map(days => (
              <button
                key={days}
                type="button"
                className={`admin-range-btn${range === days ? ' admin-range-btn--active' : ''}`}
                onClick={() => setRange(days)}
                aria-pressed={range === days}
              >
                {days}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className="admin-btn admin-btn-ghost"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <p className="admin-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      {hasTimeline ? (
        <p className="admin-timeline-note">
          Sparklines show daily activity over the last {range} days (UTC). Card totals are
          all-time; the period line is new activity in that window.
        </p>
      ) : null}

      <div className="admin-stat-grid">
        {cards.map(card => (
          <StatCard key={card.id} {...card} />
        ))}
      </div>

      <div className="admin-panels">
        <section className="admin-panel">
          <h2>Documents by status</h2>
          {statusEntries.length === 0 ? (
            <p className="admin-empty">No documents yet.</p>
          ) : (
            <ul className="admin-status-list">
              {statusEntries.map(([key, n]) => (
                <li key={key}>
                  <span className="key">{statusLabel(key)}</span>
                  <span className="val">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ marginTop: '1.25rem' }}>Wallets breakdown</h2>
          <ul className="admin-status-list">
            <li>
              <span className="key">Creators</span>
              <span className="val">{stats.wallets.uniqueCreators}</span>
            </li>
            <li>
              <span className="key">Signers (from signatures)</span>
              <span className="val">{stats.wallets.uniqueSigners}</span>
            </li>
            <li>
              <span className="key">Party wallets assigned</span>
              <span className="val">{stats.wallets.uniquePartyWallets}</span>
            </li>
            <li>
              <span className="key">Union (all distinct)</span>
              <span className="val">{stats.wallets.uniqueAll}</span>
            </li>
          </ul>
        </section>

        <section className="admin-panel">
          <h2>Recent documents</h2>
          {stats.recentDocuments.length === 0 ? (
            <p className="admin-empty">No documents yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Creator</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentDocuments.map(doc => (
                    <tr key={doc.id}>
                      <td>
                        <div>{doc.title || 'Untitled'}</div>
                        <div className="mono" style={{ opacity: 0.7 }}>
                          {doc.slug}
                        </div>
                      </td>
                      <td>
                        <span
                          className={
                            doc.status === 'locked'
                              ? 'admin-badge admin-badge--locked'
                              : 'admin-badge'
                          }
                        >
                          {statusLabel(doc.status)}
                        </span>
                      </td>
                      <td className="mono" title={doc.creatorAddress}>
                        {shortAddress(doc.creatorAddress)}
                      </td>
                      <td>{formatWhen(doc.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function Sparkline({ values, accent }: { values: number[]; accent?: boolean }) {
  const w = 120
  const h = 28
  const padY = 2
  if (values.length < 2) {
    return (
      <svg
        className="admin-sparkline"
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        aria-hidden
      />
    )
  }
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - padY - ((v - min) / span) * (h - padY * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const stroke = accent ? 'var(--lr-accent, #0d9488)' : 'var(--lr-muted, #4b5c6b)'
  return (
    <svg
      className="admin-sparkline"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
        opacity={0.85}
      />
    </svg>
  )
}

function StatCard({
  label,
  value,
  hint,
  period,
  series,
  accent,
}: {
  label: string
  value: number
  hint?: string
  period?: string
  series: number[]
  accent?: boolean
}) {
  return (
    <div className={accent ? 'admin-stat-card admin-stat-card--accent' : 'admin-stat-card'}>
      <p className="admin-stat-label">{label}</p>
      <p className="admin-stat-value">{value.toLocaleString()}</p>
      {series.length > 0 ? <Sparkline values={series} accent={accent} /> : null}
      {period ? <p className="admin-stat-period">{period}</p> : null}
      {hint ? <p className="admin-stat-hint">{hint}</p> : null}
    </div>
  )
}
