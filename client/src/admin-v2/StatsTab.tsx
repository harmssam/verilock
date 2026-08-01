/**
 * Admin v2 Stats — date range picker, comparison mode, CSV export.
 * Replaces the 30/60/90 toggle with custom start/end date inputs.
 * Comparison mode shows delta vs previous equal-length period.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminApi, type AdminStats } from '../admin/adminApi'
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

type SeriesKey = keyof NonNullable<AdminStats['timeline']>['series']

function sliceRangeToDates(
  days: string[],
  series: number[],
  startDate: string,
  endDate: string,
): number[] {
  if (!series?.length || !days?.length) return []
  return days.reduce<number[]>((acc, day, i) => {
    if (day >= startDate && day <= endDate) {
      acc.push(series[i] ?? 0)
    }
    return acc
  }, [])
}

function sum(values: number[]): number {
  return values.reduce((acc, n) => acc + (Number(n) || 0), 0)
}

function getDateDaysAgo(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00Z')
  const e = new Date(end + 'T00:00:00Z')
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1
}

interface StatCardData {
  id: string
  label: string
  value: number
  hint?: string
  period?: string
  series: number[]
  /** Numeric delta when comparison mode is active */
  deltaValue?: number
}

export function StatsTab() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Date range — defaults to last 30 days
  const [startDate, setStartDate] = useState(() => getDateDaysAgo(30))
  const [endDate, setEndDate] = useState(() => getDateDaysAgo(0))
  const [compareMode, setCompareMode] = useState(false)

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

  // Quick range buttons
  function setQuickRange(days: number) {
    setEndDate(getDateDaysAgo(0))
    setStartDate(getDateDaysAgo(days - 1))
  }

  // Build stat cards with optional comparison
  const cards = useMemo(() => {
    if (!stats) return []
    const timeline = stats.timeline
    const hasTimeline = Boolean(timeline?.series && timeline?.days)

    const take = (key: SeriesKey): number[] => {
      if (!hasTimeline) return []
      return sliceRangeToDates(timeline!.days, timeline!.series[key], startDate, endDate)
    }

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

    // Comparison: previous equal-length period
    const periodDays = daysBetween(startDate, endDate)
    const prevStart = subtractDays(startDate, periodDays)
    const prevEnd = subtractDays(startDate, 1)

    function prevTake(key: SeriesKey): number[] {
      if (!hasTimeline) return []
      return sliceRangeToDates(timeline!.days, timeline!.series[key], prevStart, prevEnd)
    }

    const prevMap: Record<string, number[]> = {}
    if (compareMode && hasTimeline) {
      for (const [id, key] of Object.entries({
        documents: 'documentsCreated' as SeriesKey,
        locked: 'documentsLocked' as SeriesKey,
        wallets: 'uniqueWalletsFirstSeen' as SeriesKey,
        signatures: 'signatures' as SeriesKey,
        parties: 'parties' as SeriesKey,
        attestations: 'attestations' as SeriesKey,
        archives: 'dataArchives' as SeriesKey,
        credits: null, // handled below
        sessions: 'sessionsCreated' as SeriesKey,
        support: 'supportTickets' as SeriesKey,
      })) {
        if (key) prevMap[id] = prevTake(key)
      }
      // Credits net
      const prevGranted = prevTake('creditGranted')
      const prevSpent = prevTake('creditSpent')
      prevMap['credits'] = prevGranted.map((g, i) => g - (prevSpent[i] ?? 0))
    }

    function computeDelta(currentValues: number[], prevValues: number[]): number | undefined {
      if (!compareMode || prevValues.length === 0) return undefined
      return sum(currentValues) - sum(prevValues)
    }

    const fmtPeriod = (s: number[]): string | undefined => {
      if (!hasTimeline || s.length === 0) return undefined
      const total = sum(s)
      return `${total.toLocaleString()} · ${startDate} → ${endDate}`
    }

    const result: StatCardData[] = [
      {
        id: 'documents',
        label: 'Documents',
        value: stats.documents.total,
        hint: `${stats.documents.createdLast24h} last 24h · ${stats.documents.createdLast7d} last 7d`,
        period: fmtPeriod(documentsCreated),
        series: documentsCreated,
        deltaValue: computeDelta(documentsCreated, prevMap['documents'] || []),
      },
      {
        id: 'locked',
        label: 'Locked on chain',
        value: stats.documents.locked,
        hint:
          stats.documents.withLockedAt !== stats.documents.locked
            ? `${stats.documents.withLockedAt} with locked_at`
            : 'status = locked',
        period: fmtPeriod(documentsLocked),
        series: documentsLocked,
        deltaValue: computeDelta(documentsLocked, prevMap['locked'] || []),
      },
      {
        id: 'wallets',
        label: 'Unique wallets',
        value: stats.wallets.uniqueAll,
        hint: `${stats.wallets.uniqueCreators} creators · ${stats.wallets.uniqueSigners} signers`,
        period: fmtPeriod(walletsNew),
        series: walletsNew,
        deltaValue: computeDelta(walletsNew, prevMap['wallets'] || []),
      },
      {
        id: 'signatures',
        label: 'Signatures',
        value: stats.signatures.total,
        period: fmtPeriod(signatures),
        series: signatures,
        deltaValue: computeDelta(signatures, prevMap['signatures'] || []),
      },
      {
        id: 'parties',
        label: 'Parties',
        value: stats.parties.total,
        hint: `${stats.parties.withWallet} with wallet`,
        period: fmtPeriod(parties),
        series: parties,
        deltaValue: computeDelta(parties, prevMap['parties'] || []),
      },
      {
        id: 'attestations',
        label: 'Attestations',
        value: stats.attestations.total,
        hint: Object.entries(stats.attestations.byStatus)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${v} ${k}`)
          .join(' · ') || 'none yet',
        period: fmtPeriod(attestations),
        series: attestations,
        deltaValue: computeDelta(attestations, prevMap['attestations'] || []),
      },
      {
        id: 'archives',
        label: 'Data archives',
        value: stats.dataArchives.total,
        hint: `${stats.dataArchives.onChain} on-chain`,
        period: fmtPeriod(archives),
        series: archives,
        deltaValue: computeDelta(archives, prevMap['archives'] || []),
      },
      {
        id: 'credits',
        label: 'Credit balance',
        value: stats.credits.totalBalance,
        hint: `${stats.credits.accountsWithBalance} wallets with balance`,
        period: hasTimeline
          ? `+${sum(creditGranted).toLocaleString()} granted · ${sum(creditSpent).toLocaleString()} spent`
          : undefined,
        series: creditNet,
        deltaValue: computeDelta(creditNet, prevMap['credits'] || []),
      },
      {
        id: 'sessions',
        label: 'Active sessions',
        value: stats.sessions.verifiedActive,
        period: fmtPeriod(sessions),
        series: sessions,
        deltaValue: computeDelta(sessions, prevMap['sessions'] || []),
      },
      {
        id: 'support',
        label: 'Support open',
        value: supportOpenCount(stats),
        hint: `${supportTotalCount(stats)} total · open / in progress / waiting`,
        period: fmtPeriod(supportNew),
        series: supportNew,
        deltaValue: computeDelta(supportNew, prevMap['support'] || []),
      },
    ]

    return result
  }, [stats, startDate, endDate, compareMode])

  function downloadCSV() {
    if (!stats) return

    const headers = ['Metric', 'Value']
    const rows: string[][] = []
    for (const card of cards) {
      rows.push([card.label, String(card.value)])
    }

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

  const periodDays = daysBetween(startDate, endDate)
  const prevStart = subtractDays(startDate, periodDays)
  const prevEnd = subtractDays(startDate, 1)

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

  const statusEntries = Object.entries(stats.documents.byStatus).sort((a, b) => b[1] - a[1])
  const hasTimeline = Boolean(stats.timeline?.series)

  const today = getDateDaysAgo(0)
  const ninetyDaysAgo = getDateDaysAgo(90)

  return (
    <div className="av2-stats">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">Database stats</h1>
          <p className="av2-dash-subtitle">Updated {formatWhen(stats.generatedAt)}</p>
        </div>
        <div className="av2-stats-actions">
          {/* Quick range presets */}
          <div className="av2-stats-range" role="group" aria-label="Quick date range">
            {[7, 30, 60, 90].map(days => (
              <button
                key={days}
                type="button"
                className={`av2-stats-range-btn${startDate === getDateDaysAgo(days - 1) && endDate === today ? ' av2-stats-range-btn--active' : ''}`}
                onClick={() => setQuickRange(days)}
              >
                {days}d
              </button>
            ))}
          </div>

          {/* Custom date inputs */}
          <div className="av2-stats-date-inputs">
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              min={ninetyDaysAgo}
              max={endDate}
              aria-label="Start date"
              className="av2-stats-date-input"
            />
            <span className="av2-stats-date-sep">→</span>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              min={startDate}
              max={today}
              aria-label="End date"
              className="av2-stats-date-input"
            />
          </div>

          {/* Compare toggle */}
          <button
            type="button"
            className={`av2-chip${compareMode ? ' av2-chip--active' : ''}`}
            onClick={() => setCompareMode(c => !c)}
            title="Compare to previous equal-length period"
          >
            Compare
          </button>

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

      {compareMode && (
        <p className="av2-stats-compare-note">
          Comparing {startDate} → {endDate} ({periodDays}d) with previous period {prevStart} → {prevEnd}.
          Green ▲ = increase, Red ▼ = decrease.
        </p>
      )}

      {hasTimeline && !compareMode ? (
        <p className="av2-stats-note">
          Sparklines show daily activity for {startDate} → {endDate} ({periodDays} days). Card totals are
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
            delta={
              compareMode && card.deltaValue !== undefined
                ? formatDelta(card.deltaValue)
                : card.period
            }
            deltaPositive={
              compareMode && card.deltaValue !== undefined
                ? card.deltaValue > 0
                : undefined
            }
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

function formatDelta(value: number): string {
  if (value === 0) return '±0'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toLocaleString()}`
}
