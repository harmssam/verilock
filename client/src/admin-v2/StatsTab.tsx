/**
 * Admin v2 Stats — ported from StatsDashboard with v2 styling.
 * New: CSV export, uses v2 StatCard component.
 */
import { useCallback, useEffect, useState } from 'react'
import { adminApi, type AdminStats, type AdminTimelineRange } from '../admin/adminApi'
import { StatCard } from './components/StatCard'
import './StatsTab.css'

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
  return `${a.slice(0, 4)}…${a.slice(-4)}`
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

interface StatCardData {
  id: string
  label: string
  value: number
  hint?: string
  period?: string
  series: number[]
}

function buildStatCards(stats: AdminStats, range: AdminTimelineRange): StatCardData[] {
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

  return [
    {
      id: 'documents',
      label: 'Documents',
      value: stats.documents.total,
      hint: `${stats.documents.createdLast24h} last 24h · ${stats.documents.createdLast7d} last 7d`,
      period: hasTimeline ? periodCount(range, documentsCreated, 'created') : undefined,
      series: documentsCreated,
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
    },
    {
      id: 'wallets',
      label: 'Unique wallets',
      value: stats.wallets.uniqueAll,
      hint: `${stats.wallets.uniqueCreators} creators · ${stats.wallets.uniqueSigners} signers`,
      period: hasTimeline ? periodCount(range, walletsNew, 'first seen') : undefined,
      series: walletsNew,
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
      hint: Object.entries(stats.attestations.byStatus)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ') || 'none yet',
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
    },
  ]
}

const RANGES: AdminTimelineRange[] = [30, 60, 90]

export function StatsTab() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<AdminTimelineRange>(30)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.stats()
      setStats(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stats')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  function downloadCSV() {
    if (!stats) return

    const headers = ['Metric', 'Value']
    const rows: string[][] = []
    const cards = buildStatCards(stats, range)
    for (const card of cards) {
      rows.push([card.label, String(card.value)])
    }

    // Add breakdowns
    rows.push([''])
    rows.push(['', ''])
    rows.push(['Documents by Status', ''])
    for (const [key, n] of Object.entries(stats.documents.byStatus).sort((a, b) => b[1] - a[1])) {
      rows.push([`  ${statusLabel(key)}`, String(n)])
    }
    rows.push(['', ''])
    rows.push(['Recent Documents', ''])
    for (const doc of stats.recentDocuments) {
      rows.push([`  ${doc.title || 'Untitled'}`, doc.slug])
    }

    const csvContent = [headers, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `verilock-stats-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  if (loading && !stats) {
    return <p className="av2-loading">Loading statistics…</p>
  }

  if (error && !stats) {
    return (
      <div>
        <p className="av2-error" role="alert">{error}</p>
        <button type="button" className="av2-btn av2-btn-primary" onClick={() => void fetchStats()}>
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
    <div className="av2-stats">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">Database stats</h1>
          <p className="av2-dash-subtitle">Updated {formatWhen(stats.generatedAt)}</p>
        </div>
        <div className="av2-stats-actions">
          <div className="av2-stats-range" role="group" aria-label="Timeline range">
            {RANGES.map(days => (
              <button
                key={days}
                type="button"
                className={`av2-stats-range-btn${range === days ? ' av2-stats-range-btn--active' : ''}`}
                onClick={() => setRange(days)}
                aria-pressed={range === days}
              >
                {days}d
              </button>
            ))}
          </div>
          <button
            type="button"
            className="av2-btn av2-btn-ghost"
            onClick={() => void fetchStats()}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="av2-btn av2-btn-accent"
            onClick={downloadCSV}
          >
            Download CSV
          </button>
        </div>
      </div>

      {error && (
        <p className="av2-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      {hasTimeline ? (
        <p className="av2-stats-note">
          Sparklines show daily activity over the last {range} days (UTC). Card totals are
          all-time; the period line is new activity in that window.
        </p>
      ) : null}

      {/* KPI cards using v2 StatCard */}
      <div className="av2-stats-grid">
        {cards.map(card => (
          <StatCard
            key={card.id}
            label={card.label}
            value={card.value}
            delta={card.period}
          />
        ))}
      </div>

      <div className="av2-stats-panels">
        <section className="av2-stats-panel">
          <h2>Documents by status</h2>
          {statusEntries.length === 0 ? (
            <p className="av2-empty">No documents yet.</p>
          ) : (
            <ul className="av2-stats-status-list">
              {statusEntries.map(([key, n]) => (
                <li key={key}>
                  <span className="av2-stats-status-key">{statusLabel(key)}</span>
                  <span className="av2-stats-status-val">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 style={{ marginTop: '1.25rem' }}>Wallets breakdown</h2>
          <ul className="av2-stats-status-list">
            <li>
              <span className="av2-stats-status-key">Creators</span>
              <span className="av2-stats-status-val">{stats.wallets.uniqueCreators}</span>
            </li>
            <li>
              <span className="av2-stats-status-key">Signers (from signatures)</span>
              <span className="av2-stats-status-val">{stats.wallets.uniqueSigners}</span>
            </li>
            <li>
              <span className="av2-stats-status-key">Party wallets assigned</span>
              <span className="av2-stats-status-val">{stats.wallets.uniquePartyWallets}</span>
            </li>
            <li>
              <span className="av2-stats-status-key">Union (all distinct)</span>
              <span className="av2-stats-status-val">{stats.wallets.uniqueAll}</span>
            </li>
          </ul>
        </section>

        <section className="av2-stats-panel">
          <h2>Recent documents</h2>
          {stats.recentDocuments.length === 0 ? (
            <p className="av2-empty">No documents yet.</p>
          ) : (
            <div className="av2-stats-table-wrap">
              <table className="av2-stats-table">
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
                        <div className="av2-stats-table-mono">{doc.slug}</div>
                      </td>
                      <td>
                        <span
                          className={`av2-badge${doc.status === 'locked' ? ' av2-badge--mint' : ' av2-badge--gray'}`}
                        >
                          {statusLabel(doc.status)}
                        </span>
                      </td>
                      <td className="av2-stats-table-mono" title={doc.creatorAddress}>
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
