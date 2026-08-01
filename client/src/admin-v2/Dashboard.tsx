/**
 * Admin v2 Dashboard — KPI cards, activity feed, quick actions.
 * Fetches data from GET /api/admin-v2/dashboard.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  FileText,
  Ticket,
  PenLine,
  Pin,
  Users,
  CircleDollarSign,
  TrendingUp,
  MailX,
} from 'lucide-react'
import { StatCard } from './components/StatCard'
import { EmptyState } from './components/EmptyState'
import { type AdminV2Tab, type StudioPane } from './components/Sidebar'
import type { AdminV2DashboardData } from './AdminAppV2'
import './Dashboard.css'

function timeAgo(isoString: string): string {
  const now = Date.now()
  const then = new Date(isoString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return new Date(isoString).toLocaleDateString()
}

const iconSize = 18
const iconStroke = 1.5

function activityIcon(type: string) {
  switch (type) {
    case 'document_created':
      return <FileText size={iconSize} strokeWidth={iconStroke} />
    case 'ticket_opened':
      return <Ticket size={iconSize} strokeWidth={iconStroke} />
    case 'signature_completed':
      return <PenLine size={iconSize} strokeWidth={iconStroke} />
    default:
      return <Pin size={iconSize} strokeWidth={iconStroke} />
  }
}

function activityLabel(type: string): string {
  switch (type) {
    case 'document_created':
      return 'Document created'
    case 'ticket_opened':
      return 'Ticket opened'
    case 'signature_completed':
      return 'Signature completed'
    default:
      return type.replace(/_/g, ' ')
  }
}

interface DashboardProps {
  onNavigate: (tab: AdminV2Tab, opts?: { studioPane?: StudioPane }) => void
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const [data, setData] = useState<AdminV2DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? ''}/api/admin-v2/dashboard`,
        { credentials: 'include', headers: { Accept: 'application/json' } },
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => null)
        throw new Error(errData?.error || `Request failed (${res.status})`)
      }
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  if (loading) {
    return <p className="av2-loading">Loading dashboard…</p>
  }

  if (error && !data) {
    return (
      <div>
        <p className="av2-error" role="alert">{error}</p>
        <button type="button" className="av2-btn av2-btn-primary" onClick={() => void fetchDashboard()}>
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="av2-dashboard">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">Dashboard</h1>
          <p className="av2-dash-subtitle">Overview of your VeriLock admin portal</p>
        </div>
        <button
          type="button"
          className="av2-btn av2-btn-ghost"
          onClick={() => void fetchDashboard()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="av2-kpi-grid">
        <StatCard
          label="Documents Today"
          value={data.kpi.documentsToday}
          icon={<FileText size={20} strokeWidth={1.5} />}
        />
        <StatCard
          label="Active Sessions"
          value={data.kpi.activeSessions}
          icon={<Users size={20} strokeWidth={1.5} />}
        />
        <StatCard
          label="Open Tickets"
          value={data.kpi.openTickets}
          icon={<Ticket size={20} strokeWidth={1.5} />}
        />
        <StatCard
          label="Credit Balance"
          value={data.kpi.creditBalance}
          icon={<CircleDollarSign size={20} strokeWidth={1.5} />}
        />
      </div>

      {/* Quick Actions */}
      <section className="av2-section">
        <h2 className="av2-section-title">Quick Actions</h2>
        <div className="av2-quick-actions">
          <button type="button" className="av2-btn av2-btn-accent" onClick={() => onNavigate('studio', { studioPane: 'blog' })}>
            <PenLine size={16} strokeWidth={1.5} /> New Blog Post
          </button>
          <button type="button" className="av2-btn av2-btn-accent" onClick={() => onNavigate('support')}>
            <Ticket size={16} strokeWidth={1.5} /> Check Tickets
          </button>
          <button type="button" className="av2-btn av2-btn-accent" onClick={() => onNavigate('stats')}>
            <TrendingUp size={16} strokeWidth={1.5} /> View Stats
          </button>
        </div>
      </section>

      {/* Activity Feed */}
      <section className="av2-section">
        <h2 className="av2-section-title">Recent Activity</h2>
        {data.recentActivity.length === 0 ? (
          <EmptyState
            icon={<MailX size={40} strokeWidth={1.5} />}
            title="No recent activity"
            description="Activity will appear here as documents are created and signed."
          />
        ) : (
          <div className="av2-activity-feed">
            {data.recentActivity.map((activity, i) => (
              <div key={`${activity.type}-${activity.time}-${i}`} className="av2-activity-item">
                <span className="av2-activity-icon" aria-hidden="true">
                  {activityIcon(activity.type)}
                </span>
                <div className="av2-activity-body">
                  <div className="av2-activity-header">
                    <span className="av2-activity-type">{activityLabel(activity.type)}</span>
                    <span className="av2-activity-time">{timeAgo(activity.time)}</span>
                  </div>
                  <div className="av2-activity-title">{activity.title}</div>
                  {activity.slug && (
                    <div className="av2-activity-slug">{activity.slug}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
