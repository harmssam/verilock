/**
 * Operator admin portal - sign-in (Turnstile + password) and DB stats dashboard.
 * Mounted for `/admin` and `admin.*` hosts (see adminHost.ts).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  adminApi,
  type AdminFeatures,
  type AdminStats,
  type SupportReplyTemplate,
  type SupportTicket,
  type SupportTicketListItem,
  type SupportTicketMessage,
  type SupportTicketStatus,
} from './adminApi'
import { isAdminHost } from './adminHost'
import './AdminApp.css'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'compact' | 'flexible'
        },
      ) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-verilock-turnstile]')
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed')), {
        once: true,
      })
      return
    }
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.dataset.verilockTurnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })

  return turnstileScriptPromise
}

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

const TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
}

type AuthState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'authed'; username: string }

type AdminTab = 'stats' | 'support'

export function AdminApp() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })
  const [features, setFeatures] = useState<AdminFeatures | null>(null)
  const [tab, setTab] = useState<AdminTab>('support')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [website, setWebsite] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReady, setTurnstileReady] = useState(false)
  const turnstileHostRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const s = await adminApi.stats()
      setStats(normalizeAdminStats(s))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load stats'
      setStatsError(message)
      if ((err as { status?: number }).status === 401) {
        setAuth({ kind: 'login' })
        setStats(null)
      }
    } finally {
      setStatsLoading(false)
    }
  }, [])

  /** Keep Support open badge/card in sync when the ticket queue loads or mutates. */
  const applySupportCounts = useCallback((counts: { open: number; total: number }) => {
    setStats(prev => {
      if (!prev) {
        return {
          generatedAt: Date.now(),
          documents: {
            total: 0,
            byStatus: {},
            locked: 0,
            withLockedAt: 0,
            createdLast24h: 0,
            createdLast7d: 0,
          },
          wallets: {
            uniqueCreators: 0,
            uniqueSigners: 0,
            uniquePartyWallets: 0,
            uniqueAll: 0,
          },
          signatures: { total: 0 },
          parties: { total: 0, withWallet: 0 },
          attestations: { total: 0, byStatus: {} },
          dataArchives: { total: 0, onChain: 0 },
          sessions: { verifiedActive: 0 },
          credits: { accountsWithBalance: 0, totalBalance: 0 },
          recentDocuments: [],
          support: {
            open: counts.open,
            total: counts.total,
            byStatus: {},
          },
        }
      }
      return {
        ...prev,
        support: {
          open: counts.open,
          total: counts.total,
          // Clear byStatus so the live `open` from the tickets API wins over a stale breakdown.
          byStatus: {},
        },
      }
    })
  }, [])

  // Boot: features + session
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const f = await adminApi.features()
        if (cancelled) return
        setFeatures(f)
      } catch {
        if (!cancelled) {
          setFeatures({
            adminEnabled: false,
            turnstileRequired: false,
            turnstileSiteKey: null,
          })
        }
      }
      try {
        const me = await adminApi.me()
        if (cancelled) return
        if (me.authenticated && me.username) {
          setAuth({ kind: 'authed', username: me.username })
        } else {
          setAuth({ kind: 'login' })
        }
      } catch {
        if (!cancelled) setAuth({ kind: 'login' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load full stats when authed; refresh again whenever Stats tab is selected
  useEffect(() => {
    if (auth.kind !== 'authed') return
    void loadStats()
  }, [auth, tab, loadStats])

  // Page title
  useEffect(() => {
    if (auth.kind !== 'authed') {
      document.title = 'Admin sign-in · VeriLock'
      return
    }
    document.title =
      tab === 'support' ? 'Admin · Support · VeriLock' : 'Admin · Stats · VeriLock'
  }, [auth.kind, tab])

  // Turnstile widget on login
  useEffect(() => {
    if (auth.kind !== 'login') return
    const siteKey = features?.turnstileSiteKey?.trim()
    if (!siteKey || !turnstileHostRef.current) return

    let cancelled = false
    setTurnstileReady(false)
    setTurnstileToken(null)

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !turnstileHostRef.current || !window.turnstile) return
        if (turnstileWidgetIdRef.current && window.turnstile) {
          try {
            window.turnstile.remove(turnstileWidgetIdRef.current)
          } catch {
            /* ignore */
          }
          turnstileWidgetIdRef.current = null
        }
        turnstileHostRef.current.innerHTML = ''
        const widgetId = window.turnstile.render(turnstileHostRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: token => {
            setTurnstileToken(token)
            setTurnstileReady(true)
          },
          'expired-callback': () => {
            setTurnstileToken(null)
          },
          'error-callback': () => {
            setTurnstileToken(null)
            setTurnstileReady(false)
          },
        })
        turnstileWidgetIdRef.current = widgetId
        setTurnstileReady(true)
      })
      .catch(err => {
        console.error('[admin] turnstile load', err)
      })

    return () => {
      cancelled = true
      const id = turnstileWidgetIdRef.current
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id)
        } catch {
          /* ignore */
        }
      }
      turnstileWidgetIdRef.current = null
    }
  }, [auth.kind, features?.turnstileSiteKey])

  async function onLogin(e: FormEvent) {
    e.preventDefault()
    setLoginError(null)
    if (features?.turnstileRequired && !turnstileToken) {
      setLoginError('Please complete the bot check and try again.')
      return
    }
    setLoginBusy(true)
    try {
      const result = await adminApi.login({
        username,
        password,
        turnstileToken,
        website: website || undefined,
      })
      setPassword('')
      setAuth({ kind: 'authed', username: result.username })
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Sign-in failed')
      const id = turnstileWidgetIdRef.current
      if (id && window.turnstile) {
        try {
          window.turnstile.reset(id)
        } catch {
          /* ignore */
        }
      }
      setTurnstileToken(null)
    } finally {
      setLoginBusy(false)
    }
  }

  async function onLogout() {
    try {
      await adminApi.logout()
    } catch {
      /* still clear local state */
    }
    setStats(null)
    setAuth({ kind: 'login' })
  }

  const productHref = isAdminHost() ? 'https://verilock.online' : '/'

  return (
    <div className="admin-app">
      <header className="admin-header">
        <a className="admin-brand" href={productHref} title="VeriLock">
          <img src="/verilock-mark-96.png" alt="" width={32} height={32} />
          <span className="admin-brand-text">
            <span className="admin-brand-name">VeriLock</span>
            <span className="admin-brand-sub">Admin</span>
          </span>
        </a>
        <div className="admin-header-actions">
          {auth.kind === 'authed' && (
            <>
              <span className="admin-user">{auth.username}</span>
              <button type="button" className="admin-btn admin-btn-ghost" onClick={() => void onLogout()}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main className="admin-main">
        {auth.kind === 'loading' && <p className="admin-loading">Loading…</p>}

        {auth.kind === 'login' && (
          <div className="admin-login-layout">
            <section className="admin-login-copy">
              <p className="eyebrow">Secure access</p>
              <h1>Admin portal</h1>
              <p>
                Sign in for the support ticket queue and database statistics. Product traffic stays
                on the main VeriLock site.
              </p>
            </section>

            <article className="admin-login-card">
              <h2>Sign in</h2>
              <p className="lead">Session-protected operator access with bot protection.</p>

              {features && !features.adminEnabled && (
                <p className="admin-warn" role="status">
                  Admin is not configured on this server. Set <code>ADMIN_PASSWORD</code> (and
                  optionally <code>ADMIN_USERNAME</code>) in the environment, then redeploy.
                </p>
              )}

              {loginError && (
                <p className="admin-error" role="alert">
                  {loginError}
                </p>
              )}

              <form className="admin-form" onSubmit={e => void onLogin(e)} autoComplete="on">
                <div className="admin-hp" aria-hidden="true">
                  <label htmlFor="admin-website">Website</label>
                  <input
                    id="admin-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={e => setWebsite(e.target.value)}
                  />
                </div>

                <div className="admin-field">
                  <label htmlFor="admin-username">Username</label>
                  <input
                    id="admin-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    required
                    autoFocus
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    disabled={!features?.adminEnabled || loginBusy}
                  />
                </div>

                <div className="admin-field">
                  <label htmlFor="admin-password">Password</label>
                  <input
                    id="admin-password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={!features?.adminEnabled || loginBusy}
                  />
                </div>

                {features?.turnstileSiteKey ? (
                  <div className="admin-turnstile">
                    <div ref={turnstileHostRef} />
                    {!turnstileReady && (
                      <p className="admin-turnstile-loading">Loading bot check…</p>
                    )}
                  </div>
                ) : null}

                <button
                  type="submit"
                  className="admin-btn admin-btn-primary"
                  disabled={!features?.adminEnabled || loginBusy}
                >
                  {loginBusy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </article>
          </div>
        )}

        {auth.kind === 'authed' && (
          <>
            <nav className="admin-tabs" aria-label="Admin sections">
              <button
                type="button"
                className={`admin-tab${tab === 'support' ? ' admin-tab--active' : ''}`}
                onClick={() => setTab('support')}
              >
                Support
                {supportOpenCount(stats) > 0 ? (
                  <span className="admin-tab-badge">{supportOpenCount(stats)}</span>
                ) : null}
              </button>
              <button
                type="button"
                className={`admin-tab${tab === 'stats' ? ' admin-tab--active' : ''}`}
                onClick={() => setTab('stats')}
              >
                Stats
              </button>
            </nav>

            {tab === 'support' && (
              <SupportQueue
                onAuthLost={() => {
                  setAuth({ kind: 'login' })
                  setStats(null)
                }}
                onCountsChange={applySupportCounts}
              />
            )}
            {tab === 'stats' && (
              <Dashboard
                stats={stats}
                loading={statsLoading}
                error={statsError}
                onRefresh={() => void loadStats()}
              />
            )}
          </>
        )}
      </main>

      <footer className="admin-footer">Operator-only · not linked from the public product</footer>
    </div>
  )
}

function Dashboard({
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

  const statusEntries = Object.entries(stats.documents.byStatus).sort((a, b) => b[1] - a[1])
  const attEntries = Object.entries(stats.attestations.byStatus).sort((a, b) => b[1] - a[1])

  return (
    <div>
      <div className="admin-dash-head">
        <div>
          <h1>Database stats</h1>
          <p className="admin-dash-meta">Updated {formatWhen(stats.generatedAt)}</p>
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

      {error && (
        <p className="admin-error" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </p>
      )}

      <div className="admin-stat-grid">
        <StatCard
          label="Documents"
          value={stats.documents.total}
          hint={`${stats.documents.createdLast24h} last 24h · ${stats.documents.createdLast7d} last 7d`}
          accent
        />
        <StatCard
          label="Locked on chain"
          value={stats.documents.locked}
          hint={
            stats.documents.withLockedAt !== stats.documents.locked
              ? `${stats.documents.withLockedAt} with locked_at`
              : 'status = locked'
          }
          accent
        />
        <StatCard
          label="Unique wallets"
          value={stats.wallets.uniqueAll}
          hint={`${stats.wallets.uniqueCreators} creators · ${stats.wallets.uniqueSigners} signers`}
          accent
        />
        <StatCard label="Signatures" value={stats.signatures.total} />
        <StatCard
          label="Parties"
          value={stats.parties.total}
          hint={`${stats.parties.withWallet} with wallet`}
        />
        <StatCard
          label="Attestations"
          value={stats.attestations.total}
          hint={
            attEntries.length
              ? attEntries.map(([k, v]) => `${v} ${k}`).join(' · ')
              : 'none yet'
          }
        />
        <StatCard
          label="Data archives"
          value={stats.dataArchives.total}
          hint={`${stats.dataArchives.onChain} on-chain`}
        />
        <StatCard
          label="Credit balance"
          value={stats.credits.totalBalance}
          hint={`${stats.credits.accountsWithBalance} wallets with balance`}
        />
        <StatCard label="Active sessions" value={stats.sessions.verifiedActive} />
        <StatCard
          label="Support open"
          value={supportOpenCount(stats)}
          hint={`${supportTotalCount(stats)} total · open / in progress / waiting`}
          accent
        />
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

function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: number
  hint?: string
  accent?: boolean
}) {
  return (
    <div className={accent ? 'admin-stat-card admin-stat-card--accent' : 'admin-stat-card'}>
      <p className="admin-stat-label">{label}</p>
      <p className="admin-stat-value">{value.toLocaleString()}</p>
      {hint ? <p className="admin-stat-hint">{hint}</p> : null}
    </div>
  )
}

function renderTemplateBody(
  body: string,
  vars: { name?: string; publicId?: string; subject?: string },
): string {
  const map: Record<string, string> = {
    name: vars.name?.trim() || 'there',
    publicId: vars.publicId?.trim() || '—',
    subject: vars.subject?.trim() || 'your request',
    site: typeof window !== 'undefined' ? window.location.origin : 'https://verilock.online',
  }
  return body.replace(/\{\{\s*(name|publicId|subject|site)\s*\}\}/g, (_, key: string) => {
    return map[key] ?? ''
  })
}

/** Active tickets: open + in_progress + waiting_customer (matches list filter "Active"). */
function supportOpenCount(stats: AdminStats | null | undefined): number {
  if (!stats?.support) return 0
  const by = stats.support.byStatus
  if (by && Object.keys(by).length > 0) {
    return (
      Number(by.open || 0) +
      Number(by.in_progress || 0) +
      Number(by.waiting_customer || 0)
    )
  }
  const n = Number(stats.support.open)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function supportTotalCount(stats: AdminStats | null | undefined): number {
  if (!stats?.support) return 0
  const by = stats.support.byStatus
  if (by && Object.keys(by).length > 0) {
    return Object.values(by).reduce((sum, n) => sum + Number(n || 0), 0)
  }
  const n = Number(stats.support.total)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function normalizeAdminStats(s: AdminStats): AdminStats {
  const by = s.support?.byStatus ?? {}
  const hasBy = Object.keys(by).length > 0
  const openFromBy =
    Number(by.open || 0) +
    Number(by.in_progress || 0) +
    Number(by.waiting_customer || 0)
  const totalFromBy = Object.values(by).reduce((sum, n) => sum + Number(n || 0), 0)
  return {
    ...s,
    support: {
      byStatus: by,
      open: hasBy ? openFromBy : Number(s.support?.open ?? 0) || 0,
      total: hasBy ? totalFromBy : Number(s.support?.total ?? 0) || 0,
    },
  }
}

function SupportQueue({
  onAuthLost,
  onCountsChange,
}: {
  onAuthLost: () => void
  onCountsChange?: (counts: { open: number; total: number }) => void
}) {
  const [filter, setFilter] = useState<'active' | 'all' | SupportTicketStatus>('active')
  const [query, setQuery] = useState('')
  const [qInput, setQInput] = useState('')
  const [tickets, setTickets] = useState<SupportTicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTicket, setDetailTicket] = useState<SupportTicket | null>(null)
  const [messages, setMessages] = useState<SupportTicketMessage[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [replyBody, setReplyBody] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [internalOnly, setInternalOnly] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [templates, setTemplates] = useState<SupportReplyTemplate[]>([])

  const handleAuthError = useCallback(
    (err: unknown) => {
      if ((err as { status?: number }).status === 401) onAuthLost()
    },
    [onAuthLost],
  )

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const result = await adminApi.tickets({
        status: filter,
        q: query || undefined,
        limit: 100,
      })
      setTickets(result.tickets)
      setTotal(result.total)
      if (result.counts) {
        onCountsChange?.(result.counts)
      } else if (filter === 'active' && !query) {
        // Fallback when server has no counts field yet
        onCountsChange?.({ open: result.total, total: result.total })
      }
    } catch (err) {
      handleAuthError(err)
      setListError(err instanceof Error ? err.message : 'Could not load tickets')
    } finally {
      setListLoading(false)
    }
  }, [filter, query, handleAuthError, onCountsChange])

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true)
      setDetailError(null)
      try {
        const result = await adminApi.ticket(id)
        setDetailTicket(result.ticket)
        setMessages(result.messages)
      } catch (err) {
        handleAuthError(err)
        setDetailError(err instanceof Error ? err.message : 'Could not load ticket')
        setDetailTicket(null)
        setMessages([])
      } finally {
        setDetailLoading(false)
      }
    },
    [handleAuthError],
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    let cancelled = false
    void adminApi
      .supportTemplates()
      .then(r => {
        if (!cancelled) setTemplates(r.templates)
      })
      .catch(err => {
        handleAuthError(err)
      })
    return () => {
      cancelled = true
    }
  }, [handleAuthError])

  useEffect(() => {
    if (!selectedId) {
      setDetailTicket(null)
      setMessages([])
      return
    }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  function applyTemplate(tpl: SupportReplyTemplate) {
    if (!detailTicket) return
    const rendered = renderTemplateBody(tpl.body, {
      name: detailTicket.name,
      publicId: detailTicket.publicId,
      subject: detailTicket.subject,
    })
    setReplyBody(prev => {
      const cur = prev.trim()
      return cur ? `${cur}\n\n${rendered}` : rendered
    })
    setInternalOnly(false)
    setReplyError(null)
  }

  async function onStatusChange(status: SupportTicketStatus) {
    if (!detailTicket) return
    setStatusBusy(true)
    setDetailError(null)
    try {
      const result = await adminApi.updateTicket(detailTicket.id, { status })
      setDetailTicket(result.ticket)
      void loadList()
    } catch (err) {
      handleAuthError(err)
      setDetailError(err instanceof Error ? err.message : 'Could not update status')
    } finally {
      setStatusBusy(false)
    }
  }

  async function onReply(e: FormEvent) {
    e.preventDefault()
    if (!detailTicket || replyBusy) return
    const body = replyBody.trim()
    if (body.length < 2) {
      setReplyError('Write a short reply first.')
      return
    }
    setReplyBusy(true)
    setReplyError(null)
    try {
      const result = await adminApi.replyTicket(detailTicket.id, {
        body,
        internalOnly,
      })
      setDetailTicket(result.ticket)
      setMessages(result.messages)
      setReplyBody('')
      setInternalOnly(false)
      void loadList()
    } catch (err) {
      handleAuthError(err)
      setReplyError(err instanceof Error ? err.message : 'Could not send reply')
    } finally {
      setReplyBusy(false)
    }
  }

  return (
    <div className="admin-support">
      <div className="admin-dash-head">
        <div>
          <h1>Support tickets</h1>
          <p className="admin-dash-meta">
            {total} {filter === 'active' ? 'active' : 'matching'} · from /support contact form
          </p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn-ghost"
          onClick={() => void loadList()}
          disabled={listLoading}
        >
          {listLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="admin-support-toolbar">
        <div className="admin-support-filters" role="group" aria-label="Ticket status filter">
          {(
            [
              ['active', 'Active'],
              ['all', 'All'],
              ['open', 'Open'],
              ['in_progress', 'In progress'],
              ['waiting_customer', 'Waiting'],
              ['resolved', 'Resolved'],
              ['closed', 'Closed'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`admin-chip${filter === value ? ' admin-chip--active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="admin-support-search"
          onSubmit={e => {
            e.preventDefault()
            setQuery(qInput.trim())
          }}
        >
          <input
            type="search"
            placeholder="Search email, subject, ticket id, slug…"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            aria-label="Search tickets"
          />
          <button type="submit" className="admin-btn admin-btn-ghost">
            Search
          </button>
        </form>
      </div>

      {listError && (
        <p className="admin-error" role="alert" style={{ marginBottom: '1rem' }}>
          {listError}
        </p>
      )}

      <div className="admin-support-layout">
        <section className="admin-panel admin-ticket-list" aria-label="Ticket list">
          {listLoading && tickets.length === 0 ? (
            <p className="admin-empty">Loading tickets…</p>
          ) : tickets.length === 0 ? (
            <p className="admin-empty">No tickets match this filter.</p>
          ) : (
            <ul className="admin-ticket-items">
              {tickets.map(t => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`admin-ticket-item${selectedId === t.id ? ' admin-ticket-item--active' : ''}`}
                    onClick={() => {
                      setSelectedId(t.id)
                      setReplyBody('')
                      setReplyError(null)
                    }}
                  >
                    <div className="admin-ticket-item-top">
                      <span className="admin-ticket-id">{t.publicId}</span>
                      <span className={`admin-badge admin-badge--${t.status}`}>
                        {TICKET_STATUS_LABELS[t.status] ?? statusLabel(t.status)}
                      </span>
                    </div>
                    <div className="admin-ticket-subject">{t.subject}</div>
                    <div className="admin-ticket-meta">
                      {t.name} · {t.email}
                      {t.documentSlug ? ` · /d/${t.documentSlug}` : ''}
                    </div>
                    {t.lastMessagePreview ? (
                      <div className="admin-ticket-preview">{t.lastMessagePreview}</div>
                    ) : null}
                    <div className="admin-ticket-when">{formatWhen(t.updatedAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-panel admin-ticket-detail" aria-label="Ticket detail">
          {!selectedId && <p className="admin-empty">Select a ticket to read and reply.</p>}
          {selectedId && detailLoading && !detailTicket && (
            <p className="admin-empty">Loading…</p>
          )}
          {selectedId && detailError && !detailTicket && (
            <p className="admin-error" role="alert">
              {detailError}
            </p>
          )}
          {detailTicket && (
            <>
              <div className="admin-ticket-detail-head">
                <div>
                  <p className="admin-ticket-id">{detailTicket.publicId}</p>
                  <h2>{detailTicket.subject}</h2>
                  <p className="admin-ticket-meta">
                    {detailTicket.name} ·{' '}
                    <a href={`mailto:${detailTicket.email}`}>{detailTicket.email}</a>
                    {detailTicket.documentSlug ? (
                      <>
                        {' · '}
                        <a
                          href={`/d/${detailTicket.documentSlug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          /d/{detailTicket.documentSlug}
                        </a>
                      </>
                    ) : null}
                  </p>
                  <p className="admin-dash-meta">
                    Opened {formatWhen(detailTicket.createdAt)} · Updated{' '}
                    {formatWhen(detailTicket.updatedAt)}
                  </p>
                </div>
                <label className="admin-status-select">
                  <span>Status</span>
                  <select
                    value={detailTicket.status}
                    disabled={statusBusy}
                    onChange={e => void onStatusChange(e.target.value as SupportTicketStatus)}
                  >
                    {(Object.keys(TICKET_STATUS_LABELS) as SupportTicketStatus[]).map(s => (
                      <option key={s} value={s}>
                        {TICKET_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {detailError && (
                <p className="admin-error" role="alert" style={{ marginBottom: '0.75rem' }}>
                  {detailError}
                </p>
              )}

              <div className="admin-thread">
                {messages.map(m => {
                  const emailed = Boolean(m.resendMessageId) || m.body.startsWith('[Emailed to customer]')
                  return (
                    <article
                      key={m.id}
                      className={`admin-thread-msg admin-thread-msg--${m.authorKind}${emailed ? ' admin-thread-msg--emailed' : ''}`}
                    >
                      <header>
                        <strong>
                          {m.authorKind === 'customer'
                            ? m.authorName || 'Customer'
                            : m.authorKind === 'operator'
                              ? m.authorName || 'Operator'
                              : m.authorName || 'Internal note'}
                          {emailed ? (
                            <span className="admin-msg-pill admin-msg-pill--emailed">Emailed</span>
                          ) : m.authorKind === 'system' ? (
                            <span className="admin-msg-pill">Internal</span>
                          ) : null}
                        </strong>
                        <span>{formatWhen(m.createdAt)}</span>
                      </header>
                      <div className="admin-thread-body">{m.body}</div>
                    </article>
                  )
                })}
              </div>

              <form className="admin-reply-form" onSubmit={e => void onReply(e)}>
                <label htmlFor="admin-reply-body">
                  {internalOnly ? 'Internal note' : 'Reply to customer'}
                </label>
                {templates.length > 0 && !internalOnly ? (
                  <div className="admin-templates" role="group" aria-label="Reply templates">
                    <span className="admin-templates-label">Templates</span>
                    <div className="admin-templates-list">
                      {templates.map(tpl => (
                        <button
                          key={tpl.id}
                          type="button"
                          className="admin-chip"
                          title={tpl.category}
                          disabled={replyBusy}
                          onClick={() => applyTemplate(tpl)}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <textarea
                  id="admin-reply-body"
                  rows={7}
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder={
                    internalOnly
                      ? 'Note for operators only (not emailed)…'
                      : 'Write a reply — emailed to the customer and saved on this ticket…'
                  }
                  disabled={replyBusy}
                />
                <div className="admin-reply-actions">
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={internalOnly}
                      onChange={e => setInternalOnly(e.target.checked)}
                      disabled={replyBusy}
                    />
                    Internal note only
                  </label>
                  <button
                    type="submit"
                    className="admin-btn admin-btn-primary"
                    disabled={replyBusy || replyBody.trim().length < 2}
                  >
                    {replyBusy
                      ? 'Sending…'
                      : internalOnly
                        ? 'Save note'
                        : 'Send reply'}
                  </button>
                </div>
                {replyError && (
                  <p className="admin-error" role="alert">
                    {replyError}
                  </p>
                )}
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
