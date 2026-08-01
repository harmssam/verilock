/**
 * Admin v2 portal - redesigned sidebar layout with auth gate.
 * Shares auth (cookie session, adminApi, Turnstile) with the existing admin.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type AdminFeatures } from '../admin/adminApi'
import { isAdminHost } from '../admin/adminHost'
import { Dashboard } from './Dashboard'
import { Sidebar } from './components/Sidebar'
import { type AdminV2Tab } from './components/Sidebar'
import { MobileTabBar } from './components/MobileTabBar'
import { SearchModal } from './components/SearchModal'
import './AdminAppV2.css'

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

export interface AdminV2Features extends AdminFeatures {
  adminV2Enabled?: boolean
}

export interface AdminV2DashboardData {
  kpi: {
    documentsToday: number
    activeSessions: number
    openTickets: number
    creditBalance: number
  }
  recentActivity: Array<{
    type: string
    title: string
    slug: string | null
    time: string
  }>
}

type AuthState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'authed'; username: string }

export function AdminAppV2() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })
  const [features, setFeatures] = useState<AdminV2Features | null>(null)
  const [tab, setTab] = useState<AdminV2Tab>('dashboard')
  const [searchOpen, setSearchOpen] = useState(false)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [website, setWebsite] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [loginBusy, setLoginBusy] = useState(false)

  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReady, setTurnstileReady] = useState(false)
  const turnstileHostRef = useRef<HTMLDivElement | null>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)

  // Boot: features + session
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const f = await adminApi.features()
        if (cancelled) return
        setFeatures(f as AdminV2Features)
      } catch {
        if (!cancelled) {
          setFeatures({
            adminEnabled: false,
            turnstileRequired: false,
            turnstileSiteKey: null,
            adminV2Enabled: false,
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

  // Page title
  useEffect(() => {
    if (auth.kind !== 'authed') {
      document.title = 'Admin sign-in · VeriLock'
      return
    }
    document.title = 'Admin · VeriLock'
  }, [auth.kind])

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
        console.error('[admin-v2] turnstile load', err)
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
    setAuth({ kind: 'login' })
  }

  // Global Cmd+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (auth.kind === 'authed') setSearchOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [auth.kind])

  const productHref = isAdminHost() ? 'https://verilock.online' : '/'

  return (
    <div className="av2-app">
      {auth.kind === 'loading' && <p className="av2-loading">Loading…</p>}

      {auth.kind === 'login' && (
        <div className="av2-login-layout">
          <section className="av2-login-copy">
            <p className="av2-eyebrow">Secure access</p>
            <h1>Admin portal</h1>
            <p>
              Sign in for the support ticket queue and database statistics. Product traffic stays
              on the main VeriLock site.
            </p>
          </section>

          <article className="av2-login-card">
            <h2>Sign in</h2>
            <p className="av2-lead">Session-protected operator access with bot protection.</p>

            {features && !features.adminEnabled && (
              <p className="av2-warn" role="status">
                Admin is not configured on this server. Set <code>ADMIN_PASSWORD</code> (and
                optionally <code>ADMIN_USERNAME</code>) in the environment, then redeploy.
              </p>
            )}

            {loginError && (
              <p className="av2-error" role="alert">
                {loginError}
              </p>
            )}

            <form className="av2-form" onSubmit={e => void onLogin(e)} autoComplete="on">
              <div className="av2-hp" aria-hidden="true">
                <label htmlFor="av2-website">Website</label>
                <input
                  id="av2-website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={e => setWebsite(e.target.value)}
                />
              </div>

              <div className="av2-field">
                <label htmlFor="av2-username">Username</label>
                <input
                  id="av2-username"
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

              <div className="av2-field">
                <label htmlFor="av2-password">Password</label>
                <input
                  id="av2-password"
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
                <div className="av2-turnstile">
                  <div ref={turnstileHostRef} />
                  {!turnstileReady && (
                    <p className="av2-turnstile-loading">Loading bot check…</p>
                  )}
                </div>
              ) : null}

              <button
                type="submit"
                className="av2-btn av2-btn-primary"
                disabled={!features?.adminEnabled || loginBusy}
              >
                {loginBusy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </article>
        </div>
      )}

      {auth.kind === 'authed' && (
        <div className="av2-shell">
          {/* Desktop sidebar */}
          <Sidebar
            activeTab={tab}
            onTabChange={setTab}
            username={auth.username}
            onLogout={() => void onLogout()}
          />

          {/* Main content area */}
          <main className="av2-main">
            <header className="av2-header">
              <a className="av2-brand" href={productHref} title="VeriLock">
                <img src="/verilock-mark-96.png" alt="" width={32} height={32} />
                <span className="av2-brand-text">
                  <span className="av2-brand-name">VeriLock</span>
                  <span className="av2-brand-sub">Admin</span>
                </span>
              </a>
              <div className="av2-header-actions">
                <span className="av2-user">{auth.username}</span>
                <button type="button" className="av2-btn av2-btn-ghost" onClick={() => void onLogout()}>
                  Sign out
                </button>
              </div>
            </header>

            <div className="av2-content">
              {tab === 'dashboard' && <Dashboard onNavigate={setTab} />}
              {tab === 'inbox' && (
                <div className="av2-page-placeholder">
                  <h2>📬 Inbox</h2>
                  <p>Coming in Phase 1.</p>
                </div>
              )}
              {tab === 'support' && (
                <div className="av2-page-placeholder">
                  <h2>🎫 Support</h2>
                  <p>Coming in Phase 1.</p>
                </div>
              )}
              {tab === 'stats' && (
                <div className="av2-page-placeholder">
                  <h2>📈 Stats</h2>
                  <p>Coming in Phase 1.</p>
                </div>
              )}
              {tab === 'content' && (
                <div className="av2-page-placeholder">
                  <h2>✍️ Content</h2>
                  <p>Coming in Phase 2.</p>
                </div>
              )}
              {tab === 'settings' && (
                <div className="av2-page-placeholder">
                  <h2>⚙️ Settings</h2>
                  <p>Coming in Phase 2.</p>
                </div>
              )}
            </div>
          </main>

          {/* Mobile bottom tab bar */}
          <MobileTabBar
            activeTab={tab}
            onTabChange={setTab}
          />

          {/* Global search modal */}
          <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
        </div>
      )}
    </div>
  )
}
