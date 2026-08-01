/**
 * Admin v2 portal - redesigned sidebar layout with auth gate.
 * Shares auth (cookie session, adminApi, Turnstile) with the existing admin.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { adminApi, type AdminFeatures } from '../admin/adminApi'
import { isAdminHost } from '../admin/adminHost'
import { Dashboard } from './Dashboard'
import { InboxTab } from './InboxTab'
import { SupportTab } from './SupportTab'
import { StatsTab } from './StatsTab'
import { IdeasTab } from './IdeasTab'
import { SettingsTab } from './SettingsTab'
import { StudioTab } from './StudioTab'
import { Sidebar, type AdminV2Tab, type StudioPane } from './components/Sidebar'
import { MobileTabBar } from './components/MobileTabBar'
import { SearchModal } from './components/SearchModal'
import { DarkModeToggle } from './components/DarkModeToggle'
import { ShortcutModal } from './components/ShortcutModal'
import { Breadcrumbs, type BreadcrumbSegment } from './components/Breadcrumbs'
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

export interface AdminV2Notification {
  type: 'new_email' | 'new_ticket' | 'ticket_reply'
  title: string
  subtitle: string
  id: string
}

type AuthState =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'authed'; username: string }

export function AdminAppV2() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })
  const [features, setFeatures] = useState<AdminV2Features | null>(null)
  const [tab, setTab] = useState<AdminV2Tab>('dashboard')
  const [studioPane, setStudioPane] = useState<StudioPane>('x')
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutOpen, setShortcutOpen] = useState(false)

  // Badge counts
  const [inboxUnread, setInboxUnread] = useState(0)
  const [supportOpen, setSupportOpen] = useState(0)

  // Notification center
  const [notifications, setNotifications] = useState<AdminV2Notification[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)

  // Breadcrumbs
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([])

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

  // Poll sidebar badge counts + notifications every 60s
  useEffect(() => {
    if (auth.kind !== 'authed') return

    const fetchCounts = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL ?? ''}/api/admin-v2/sidebar-counts`,
          { credentials: 'include', headers: { Accept: 'application/json' } },
        )
        if (res.ok) {
          const data = await res.json()
          setInboxUnread(Number(data.inboxUnread ?? 0))
          setSupportOpen(Number(data.supportOpen ?? 0))
        }
      } catch {
        /* silent — badge counts are non-critical */
      }
    }

    const fetchNotifications = async () => {
      try {
        const data = await adminApi.notifications()
        setNotifications(data.notifications)
      } catch {
        /* silent */
      }
    }

    void fetchCounts()
    void fetchNotifications()

    const interval = setInterval(() => {
      void fetchCounts()
      void fetchNotifications()
    }, 60_000)

    return () => clearInterval(interval)
  }, [auth.kind])

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifOpen])

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

  function handleAuthLost() {
    setAuth({ kind: 'login' })
  }

  // Notification click handler — navigates to relevant tab
  function handleNotificationClick(n: AdminV2Notification) {
    setNotifOpen(false)
    if (n.type === 'new_email') {
      handleTabChange('inbox')
    } else if (n.type === 'new_ticket' || n.type === 'ticket_reply') {
      handleTabChange('support')
    }
  }

  // Tab change handler — updates tab, studio pane, and breadcrumbs
  const handleTabChange = useCallback(
    (newTab: AdminV2Tab, opts?: { studioPane?: StudioPane }) => {
      setTab(newTab)
      if (opts?.studioPane) {
        setStudioPane(opts.studioPane)
      }

      const segments: BreadcrumbSegment[] = [{ label: tabLabel(newTab), tab: newTab }]

      if (newTab === 'studio') {
        const pane = opts?.studioPane || studioPane
        segments.push({ label: pane === 'blog' ? 'Blog Studio' : 'X Post Studio' })
      }

      setBreadcrumbs(segments)
    },
    [studioPane],
  )

  // Search navigation
  const handleSearchNavigate = useCallback(
    (newTab: AdminV2Tab, opts?: { studioPane?: StudioPane; emailId?: string; ticketId?: string }) => {
      handleTabChange(newTab, opts)
    },
    [handleTabChange],
  )

  // Global keyboard shortcuts
  useEffect(() => {
    let gPrefix = false
    let gTimer: ReturnType<typeof setTimeout> | null = null

    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      const isContentEditable = (e.target as HTMLElement)?.isContentEditable

      // Cmd+K / Ctrl+K — search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (auth.kind === 'authed') setSearchOpen(prev => !prev)
        return
      }

      if (auth.kind !== 'authed') return
      if (isInput || isContentEditable) {
        // Still allow Escape in inputs
        if (e.key === 'Escape') {
          setShortcutOpen(false)
        }
        return
      }

      // ? — show shortcut modal
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setShortcutOpen(prev => !prev)
        return
      }

      // g prefix for tab navigation
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        gPrefix = true
        if (gTimer) clearTimeout(gTimer)
        gTimer = setTimeout(() => { gPrefix = false }, 1500)
        return
      }

      if (gPrefix) {
        e.preventDefault()
        gPrefix = false
        if (gTimer) { clearTimeout(gTimer); gTimer = null }

        const tabMap: Record<string, AdminV2Tab> = {
          d: 'dashboard',
          i: 'inbox',
          s: 'support',
          t: 'stats',
          c: 'content',
          m: 'studio',
          e: 'settings',
        }
        const target = tabMap[e.key.toLowerCase()]
        if (target) {
          if (target === 'studio') {
            handleTabChange('studio', { studioPane: 'x' })
          } else {
            handleTabChange(target)
          }
        }
        return
      }

      // Numbered shortcuts 1-7 for tabs
      if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '7') {
        e.preventDefault()
        const numTabs: AdminV2Tab[] = [
          'dashboard', 'inbox', 'support', 'stats', 'content', 'studio', 'settings',
        ]
        const idx = Number(e.key) - 1
        const target = numTabs[idx]
        if (target) {
          if (target === 'studio') {
            handleTabChange('studio', { studioPane: 'x' })
          } else {
            handleTabChange(target)
          }
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (gTimer) clearTimeout(gTimer)
    }
  }, [auth.kind, handleTabChange])

  // Dark mode init on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('verilock-admin-v2-theme')
      if (stored === 'dark' || stored === 'light') {
        document.documentElement.setAttribute('data-theme', stored)
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark')
      }
    } catch { /* noop */ }
  }, [])

  // Breadcrumbs derived from tab
  const visibleBreadcrumbs = useMemo(() => {
    if (tab === 'dashboard') return []
    return breadcrumbs.length > 0 ? breadcrumbs : [{ label: tabLabel(tab), tab }]
  }, [tab, breadcrumbs])

  const productHref = isAdminHost() ? 'https://verilock.online' : '/'

  // Notification icons
  const notifIcon = (type: string) => {
    if (type === 'new_email') return '📧'
    if (type === 'new_ticket') return '🎫'
    return '💬'
  }

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
            onTabChange={handleTabChange}
            username={auth.username}
            onLogout={() => void onLogout()}
            inboxBadge={inboxUnread}
            supportBadge={supportOpen}
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
                {/* Notification bell */}
                <div className="av2-notif-wrap" ref={notifRef}>
                  <button
                    type="button"
                    className={`av2-notif-bell${notifOpen ? ' av2-notif-bell--active' : ''}`}
                    onClick={() => setNotifOpen(prev => !prev)}
                    aria-label={`${notifications.length} notifications`}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                    {notifications.length > 0 && (
                      <span className="av2-notif-badge">{notifications.length}</span>
                    )}
                  </button>

                  {/* Notification dropdown */}
                  {notifOpen && (
                    <div className="av2-notif-dropdown">
                      <div className="av2-notif-dropdown-head">
                        <span className="av2-notif-dropdown-title">
                          Notifications ({notifications.length})
                        </span>
                      </div>
                      <div className="av2-notif-dropdown-body">
                        {notifications.length === 0 ? (
                          <p className="av2-notif-empty">No recent activity.</p>
                        ) : (
                          notifications.map(n => (
                            <button
                              key={`${n.type}-${n.id}`}
                              type="button"
                              className="av2-notif-item"
                              onClick={() => handleNotificationClick(n)}
                            >
                              <span className="av2-notif-item-icon">{notifIcon(n.type)}</span>
                              <div className="av2-notif-item-body">
                                <span className="av2-notif-item-title">{n.title}</span>
                                <span className="av2-notif-item-sub">{n.subtitle}</span>
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <span className="av2-user">{auth.username}</span>
                <DarkModeToggle />
                <button type="button" className="av2-btn av2-btn-ghost" onClick={() => void onLogout()}>
                  Sign out
                </button>
              </div>
            </header>

            <div className="av2-content">
              {/* Breadcrumbs */}
              <Breadcrumbs segments={visibleBreadcrumbs} onNavigate={handleTabChange} />

              {tab === 'dashboard' && <Dashboard onNavigate={handleTabChange} />}
              {tab === 'inbox' && <InboxTab onAuthLost={handleAuthLost} />}
              {tab === 'support' && <SupportTab onAuthLost={handleAuthLost} />}
              {tab === 'stats' && <StatsTab />}
              {tab === 'content' && <IdeasTab onAuthLost={handleAuthLost} />}
              {tab === 'studio' && (
                <StudioTab
                  pane={studioPane}
                  studioProxyEnabled={features?.studioProxyEnabled}
                />
              )}
              {tab === 'settings' && <SettingsTab />}
            </div>
          </main>

          {/* Mobile bottom tab bar */}
          <MobileTabBar
            activeTab={tab}
            onTabChange={handleTabChange}
            inboxBadge={inboxUnread}
            supportBadge={supportOpen}
          />

          {/* Global search modal */}
          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            onNavigate={handleSearchNavigate}
          />

          {/* Keyboard shortcut reference */}
          <ShortcutModal
            open={shortcutOpen}
            onClose={() => setShortcutOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

function tabLabel(tab: AdminV2Tab): string {
  const labels: Record<AdminV2Tab, string> = {
    dashboard: 'Dashboard',
    inbox: 'Inbox',
    support: 'Support',
    stats: 'Stats',
    content: 'Content',
    studio: 'Studio',
    settings: 'Settings',
  }
  return labels[tab] || tab
}
