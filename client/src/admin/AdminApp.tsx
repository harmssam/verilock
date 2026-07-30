/**
 * Operator admin portal - sign-in (Turnstile + password) and DB stats dashboard.
 * Mounted for `/admin` and `admin.*` hosts (see adminHost.ts).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type AdminFeatures, type AdminStats } from './adminApi'
import { isAdminHost } from './adminHost'
import { StatsDashboard } from './StatsDashboard'
import { SupportQueue } from './SupportQueue'
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

type AuthState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'authed'; username: string }

type AdminTab = 'stats' | 'support' | 'studio'
type StudioPane = 'blog' | 'x'

export function AdminApp() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })
  const [features, setFeatures] = useState<AdminFeatures | null>(null)
  const [tab, setTab] = useState<AdminTab>('support')
  const [studioPane, setStudioPane] = useState<StudioPane>('x')
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
      // Skip no-op updates so SupportQueue effects do not re-fire in a loop.
      if (
        prev.support?.open === counts.open &&
        prev.support?.total === counts.total &&
        Object.keys(prev.support?.byStatus ?? {}).length === 0
      ) {
        return prev
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

  const handleAuthLost = useCallback(() => {
    setAuth({ kind: 'login' })
    setStats(null)
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
      tab === 'support'
        ? 'Admin · Support · VeriLock'
        : tab === 'studio'
          ? 'Admin · Studio · VeriLock'
          : 'Admin · Stats · VeriLock'
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
              <button
                type="button"
                className={`admin-tab${tab === 'studio' ? ' admin-tab--active' : ''}`}
                onClick={() => setTab('studio')}
              >
                Studio
              </button>
            </nav>

            {tab === 'support' && (
              <SupportQueue
                onAuthLost={handleAuthLost}
                onCountsChange={applySupportCounts}
              />
            )}
            {tab === 'stats' && (
              <StatsDashboard
                stats={stats}
                loading={statsLoading}
                error={statsError}
                onRefresh={() => void loadStats()}
              />
            )}
            {tab === 'studio' && (
              <section className="admin-studio">
                {!features?.studioProxyEnabled ? (
                  <div className="admin-studio-missing">
                    <h2>Content Studio not connected</h2>
                    <p>
                      Set <code>CONTENT_STUDIO_URL</code> and{' '}
                      <code>CONTENT_STUDIO_TOKEN</code> on the VeriLock Railway service
                      (private URL of the <code>content-studio</code> service). Redeploy
                      after saving variables.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="admin-studio-toolbar">
                      <div className="admin-range" role="group" aria-label="Studio type">
                        <button
                          type="button"
                          className={`admin-range-btn${studioPane === 'x' ? ' admin-range-btn--active' : ''}`}
                          onClick={() => setStudioPane('x')}
                        >
                          X Post Studio
                        </button>
                        <button
                          type="button"
                          className={`admin-range-btn${studioPane === 'blog' ? ' admin-range-btn--active' : ''}`}
                          onClick={() => setStudioPane('blog')}
                        >
                          Blog Studio
                        </button>
                      </div>
                      <a
                        className="admin-btn admin-btn-ghost"
                        href={studioPane === 'blog' ? '/blog-studio' : '/x-studio'}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open in new tab
                      </a>
                    </div>
                    <iframe
                      key={studioPane}
                      className="admin-studio-frame"
                      title={studioPane === 'blog' ? 'Blog Studio' : 'X Post Studio'}
                      src={studioPane === 'blog' ? '/blog-studio' : '/x-studio'}
                    />
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="admin-footer">Operator-only · not linked from the public product</footer>
    </div>
  )
}
