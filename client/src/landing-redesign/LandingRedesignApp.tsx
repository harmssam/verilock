/**
 * Landing redesign shell.
 * Parity with ExperimentApp routes + account chrome; new landing visual only.
 * Production ExperimentApp.tsx is not modified.
 */
import { Fingerprint, ScanSearch, Users, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isAgreementsPath,
  isBlogPath,
  isKnownAppPath,
  isPricingPath,
  isPrivacyPath,
  isSecurityPath,
  saveHubReturnPath,
} from '../hubReturnPath'
import { applyPageMeta, blogPostMeta, journeyPathMeta, PAGE_META, type PageMeta } from '../seo'
import { blogSlugFromPath, getPostBySlug } from '../blog'
import type { SealDocument } from '../types'
import { PricePage } from '../PricePage'
import { PrivacyPolicyPage } from '../PrivacyPolicyPage'
import { SecurityPage } from '../SecurityPage'
import { AccountMenu } from '../experiment/AccountMenu'
import { AgreementsPage } from '../experiment/AgreementsPage'
import { BlogPage } from '../experiment/BlogPage'
import { DocumentJourney } from '../experiment/DocumentJourney'
import { NotFoundPage } from '../experiment/NotFoundPage'
import { useCreditBalance } from '../experiment/useCreditBalance'
import {
  clearJourneyIntent,
  resolveIntentForConnect,
  resolveJourneyIntent,
  saveJourneyIntent,
  syncIntentToUrl,
} from '../experiment/journeyIntent'
import {
  journeyConnectOptions,
  resolveJourneyConnectMode,
} from '../experiment/journeyConnectUi'
import { useJourneyWallet } from '../experiment/useJourneyWallet'
import {
  clearStripeCheckoutReturnFromUrl,
  fulfillStripeCheckoutReturn,
  peekStripeCheckoutReturn,
} from '../experiment/stripeCheckoutReturn'
import type { PathRole } from '../experiment/types'
import { LandingHome } from './LandingHome'
import { formatObjectPosition, PATH_PLACEMENTS, PATH_STILLS } from './pathMedia'

/** Path card labels — stills + placement from pathMedia. */
const TRACK_META: Record<
  PathRole,
  {
    title: string
    detail: string
    icon: LucideIcon
    accent: 'creator' | 'signer' | 'verifier'
  }
> = {
  creator: {
    title: 'Create & seal',
    detail: 'Fingerprint, multi-party sign, lock on Nimiq',
    icon: Fingerprint,
    accent: 'creator',
  },
  signer: {
    title: 'I was invited',
    detail: 'Drop the shared PDF (or open your invite link), then sign',
    icon: Users,
    accent: 'signer',
  },
  verifier: {
    title: 'Verify a PDF',
    detail: 'Drop a file. Look up sealed fingerprints',
    icon: ScanSearch,
    accent: 'verifier',
  },
}

/** Match landing path card icons. */
const PATH_ICON_STROKE = 1.5

/** Home ↔ track crossfade duration (must match CSS). */
const VIEW_BLEND_MS = 260

type ShellScreen =
  | 'journey'
  | 'pricing'
  | 'privacy'
  | 'security'
  | 'agreements'
  | 'blog'
  | 'not-found'

function screenFromPath(pathname: string): ShellScreen {
  if (isPricingPath(pathname)) return 'pricing'
  if (isPrivacyPath(pathname)) return 'privacy'
  if (isSecurityPath(pathname)) return 'security'
  if (isAgreementsPath(pathname)) return 'agreements'
  if (isBlogPath(pathname)) return 'blog'
  if (!isKnownAppPath(pathname)) return 'not-found'
  return 'journey'
}

function isDeepLinkPath(pathname: string): boolean {
  return pathname.startsWith('/d/') || pathname.startsWith('/v/')
}

/** True when we should show production DocumentJourney (not redesigned welcome). */
function shouldShowJourneyFlow(pathname: string, forceFlow: boolean): boolean {
  if (forceFlow) return true
  if (isDeepLinkPath(pathname)) return true
  if (resolveJourneyIntent()) return true
  return false
}

export function LandingRedesignApp() {
  const wallet = useJourneyWallet()
  const { balance: creditBalance, refresh: refreshCredits } = useCreditBalance(wallet.token)
  const [screen, setScreen] = useState<ShellScreen>(() =>
    typeof window !== 'undefined' ? screenFromPath(window.location.pathname) : 'journey',
  )
  const journeyReturnPathRef = useRef('/')
  const [journeyEpoch, setJourneyEpoch] = useState(0)
  const [navEpoch, setNavEpoch] = useState(0)
  const [journeyMeta, setJourneyMeta] = useState<PageMeta | null>(null)
  /** Active path for track title (shell-owned; intent can lag after Start over). */
  const [trackRole, setTrackRole] = useState<PathRole | null>(() =>
    typeof window !== 'undefined' ? resolveJourneyIntent() : null,
  )
  /**
   * View blend: `shown` is what is mounted; `phase` drives opacity/blur.
   * home → track and track → home crossfade without hard cuts.
   */
  const [viewSurface, setViewSurface] = useState<'home' | 'track'>(() =>
    typeof window !== 'undefined' && shouldShowJourneyFlow(window.location.pathname, false)
      ? 'track'
      : 'home',
  )
  const [viewPhase, setViewPhase] = useState<'idle' | 'exit' | 'enter'>('idle')
  const blendTimersRef = useRef<number[]>([])

  const connectMode = resolveJourneyConnectMode({
    inNimiqPay: wallet.inNimiqPay,
    mobilePayConnect: wallet.mobilePayConnect,
    showOpenInPay: wallet.showOpenInPay,
  })

  const clearBlendTimers = useCallback(() => {
    for (const id of blendTimersRef.current) window.clearTimeout(id)
    blendTimersRef.current = []
  }, [])

  const viewSurfaceRef = useRef(viewSurface)
  viewSurfaceRef.current = viewSurface

  const blendToSurface = useCallback(
    (
      next: 'home' | 'track',
      opts?: { clearTrackRole?: boolean; remountJourney?: boolean },
    ) => {
      const finishSwap = () => {
        if (opts?.clearTrackRole) setTrackRole(null)
        if (opts?.remountJourney) setJourneyEpoch(n => n + 1)
        setViewSurface(next)
        setViewPhase('enter')
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setViewPhase('idle')
          })
        })
      }

      if (typeof window === 'undefined') {
        if (opts?.clearTrackRole) setTrackRole(null)
        if (opts?.remountJourney) setJourneyEpoch(n => n + 1)
        setViewSurface(next)
        setViewPhase('idle')
        return
      }
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (reduce || viewSurfaceRef.current === next) {
        clearBlendTimers()
        if (opts?.clearTrackRole) setTrackRole(null)
        if (opts?.remountJourney) setJourneyEpoch(n => n + 1)
        setViewSurface(next)
        setViewPhase('idle')
        return
      }
      clearBlendTimers()
      setViewPhase('exit')
      const mid = window.setTimeout(finishSwap, VIEW_BLEND_MS)
      blendTimersRef.current.push(mid)
    },
    [clearBlendTimers],
  )

  useEffect(() => () => clearBlendTimers(), [clearBlendTimers])

  const rememberJourneyPath = useCallback(() => {
    if (typeof window === 'undefined') return
    const path = `${window.location.pathname}${window.location.search}`
    if (
      !isPricingPath(window.location.pathname) &&
      !isPrivacyPath(window.location.pathname) &&
      !isSecurityPath(window.location.pathname) &&
      !isAgreementsPath(window.location.pathname) &&
      !isBlogPath(window.location.pathname)
    ) {
      journeyReturnPathRef.current = path || '/'
    }
  }, [])

  const goJourney = useCallback(() => {
    setScreen('journey')
    clearJourneyIntent()
    syncIntentToUrl(null)
    journeyReturnPathRef.current = '/'
    window.history.pushState({}, '', '/')
    setNavEpoch(n => n + 1)
    // Remount + clear title at blend mid so the current track fades out cleanly.
    blendToSurface('home', { clearTrackRole: true, remountJourney: true })
  }, [blendToSurface])

  const goPricing = useCallback(() => {
    rememberJourneyPath()
    setScreen('pricing')
    window.history.pushState({}, '', '/pricing')
  }, [rememberJourneyPath])

  const goPrivacy = useCallback(() => {
    rememberJourneyPath()
    setScreen('privacy')
    window.history.pushState({}, '', '/privacy')
  }, [rememberJourneyPath])

  const goSecurity = useCallback(() => {
    rememberJourneyPath()
    setScreen('security')
    window.history.pushState({}, '', '/security')
  }, [rememberJourneyPath])

  const goBlog = useCallback((slug?: string) => {
    rememberJourneyPath()
    setScreen('blog')
    const next = slug ? `/blog/${slug}` : '/blog'
    window.history.pushState({}, '', next)
    setNavEpoch(n => n + 1)
  }, [rememberJourneyPath])

  const goAgreements = useCallback(() => {
    rememberJourneyPath()
    setScreen('agreements')
    window.history.pushState({}, '', '/agreements')
  }, [rememberJourneyPath])

  const openAgreement = useCallback(
    (doc: SealDocument, preferSeal = false) => {
      setScreen('journey')
      setTrackRole(null)
      const q = preferSeal ? '?preferSeal=1' : ''
      window.history.pushState({}, '', `/d/${doc.slug}${q}`)
      setJourneyEpoch(n => n + 1)
      setNavEpoch(n => n + 1)
      blendToSurface('track')
    },
    [blendToSurface],
  )

  const startCreate = useCallback(() => {
    clearJourneyIntent()
    saveJourneyIntent('creator')
    syncIntentToUrl('creator')
    setTrackRole('creator')
    setScreen('journey')
    setJourneyEpoch(n => n + 1)
    window.history.pushState({}, '', '/?intent=creator')
    setNavEpoch(n => n + 1)
    blendToSurface('track')
  }, [blendToSurface])

  const pickRole = useCallback(
    (role: PathRole) => {
      saveJourneyIntent(role)
      syncIntentToUrl(role)
      setTrackRole(role)
      setScreen('journey')
      setJourneyEpoch(n => n + 1)
      window.history.pushState({}, '', `/?intent=${role}`)
      setNavEpoch(n => n + 1)
      blendToSurface('track')
    },
    [blendToSurface],
  )

  const connectPreservingPath = useCallback(() => {
    const intent = resolveIntentForConnect(null)
    if (intent) {
      saveJourneyIntent(intent)
      syncIntentToUrl(intent)
    }
    saveHubReturnPath()
    void wallet.connect(journeyConnectOptions(connectMode))
  }, [connectMode, wallet])

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname
      const nextScreen = screenFromPath(path)
      setScreen(nextScreen)
      const flow = shouldShowJourneyFlow(path, false)
      const intent = resolveJourneyIntent()
      setTrackRole(intent)
      setNavEpoch(n => n + 1)
      if (nextScreen === 'journey') {
        blendToSurface(flow || intent ? 'track' : 'home')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [blendToSurface])

  const walletToken = wallet.token
  const walletBootReady = wallet.bootReady
  const setWalletError = wallet.setError
  useEffect(() => {
    const ret = peekStripeCheckoutReturn()
    if (!ret.status) return

    // Prefer pricing screen after Checkout return (success_url/cancel_url → /pricing).
    setScreen('pricing')

    if (ret.status === 'cancel') {
      clearStripeCheckoutReturnFromUrl()
      setWalletError('Card checkout was cancelled.')
      return
    }

    if (!walletBootReady) return
    if (!walletToken) {
      clearStripeCheckoutReturnFromUrl()
      setWalletError('Sign in with the same wallet to apply your card purchase.')
      return
    }
    if (!ret.sessionId) {
      clearStripeCheckoutReturnFromUrl()
      void refreshCredits()
      return
    }

    let cancelled = false
    void (async () => {
      const result = await fulfillStripeCheckoutReturn(walletToken, ret.sessionId!)
      if (cancelled) return
      clearStripeCheckoutReturnFromUrl()
      if (!result.ok) {
        setWalletError(result.message)
      } else {
        setWalletError(null)
        // CreditsPanel shows +N via verilock:credits-topup from fulfill.
      }
      void refreshCredits()
    })()
    return () => {
      cancelled = true
    }
  }, [walletBootReady, walletToken, refreshCredits, setWalletError])

  const handleJourneyPageMeta = useCallback((meta: PageMeta) => {
    setJourneyMeta(meta)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const path = window.location.pathname
    const search = window.location.search

    if (screen === 'pricing') {
      applyPageMeta({ ...PAGE_META.pricing })
      return
    }
    if (screen === 'privacy') {
      applyPageMeta({ ...PAGE_META.privacy })
      return
    }
    if (screen === 'security') {
      applyPageMeta({ ...PAGE_META.security })
      return
    }
    if (screen === 'blog') {
      const slug = blogSlugFromPath(path)
      if (slug) {
        const post = getPostBySlug(slug)
        if (post) {
          applyPageMeta(blogPostMeta(post))
          return
        }
        applyPageMeta({ ...PAGE_META.notFound, path })
        return
      }
      applyPageMeta({ ...PAGE_META.blog })
      return
    }
    if (screen === 'agreements') {
      applyPageMeta({ ...PAGE_META.agreements })
      return
    }
    if (screen === 'not-found') {
      applyPageMeta({ ...PAGE_META.notFound, path })
      return
    }
    const meta = journeyMeta ?? journeyPathMeta(path, search)
    applyPageMeta({ ...meta, path: meta.path ?? path })
  }, [screen, journeyMeta, navEpoch])

  /**
   * Home can remount; track + DocumentJourney stay mounted (hidden when not active)
   * so mid-flow state survives pricing / blog / privacy / security visits.
   */
  const showHome = screen === 'journey' && viewSurface === 'home'
  const showTrack = viewSurface === 'track'
  const trackMeta = trackRole ? TRACK_META[trackRole] : null
  const TrackIcon = trackMeta?.icon

  // Wider content shell (blog, privacy, etc.). Agreements matches landing (960px), not this.
  const wideShell =
    screen === 'pricing' ||
    screen === 'privacy' ||
    screen === 'security' ||
    screen === 'blog' ||
    screen === 'not-found'

  return (
    <div
      className={[
        'lr-app',
        'exp-app',
        wideShell ? 'exp-app--wide' : '',
        // Home, tracks, and agreements share one desktop content width.
        screen === 'journey' || screen === 'agreements' ? 'lr-app--landing' : '',
        screen === 'pricing' ? 'lr-app--pricing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="lr-preview-banner" role="status">
        <span>
          <strong>Landing redesign preview</strong>
          {' · '}
          production files untouched · continue after path pick uses original journey steps
        </span>
        <a className="lr-preview-link" href="http://localhost:5176/">
          Open production Journey (:5176)
        </a>
      </div>

      <header className="lr-header">
        <div className="lr-header-inner">
          <button type="button" className="lr-brand" onClick={goJourney} aria-label="VeriLock home">
            <img
              className="lr-brand-mark"
              src="/verilock-mark.png"
              alt=""
              width={72}
              height={72}
            />
            <div className="lr-brand-text">
              <span className="lr-brand-name">VeriLock</span>
              <span className="lr-brand-tag">Sign together. Prove forever.</span>
            </div>
          </button>

          <div className="lr-header-actions">
            {/* Logged-in: Agreements nav (parity with production ExperimentApp). */}
            {wallet.account && (
              <button
                type="button"
                className={`lr-nav${screen === 'agreements' ? ' lr-nav--active' : ''}`}
                onClick={screen === 'agreements' ? goJourney : goAgreements}
              >
                Agreements
              </button>
            )}
            {/*
              Credits chip (AccountMenu) already opens Pricing when balance is known.
              Hide Pricing nav for logged-in users with a finite credit balance (prod parity).
            */}
            {!(wallet.account && creditBalance != null && Number.isFinite(creditBalance)) && (
              <button
                type="button"
                className={`lr-nav${screen === 'pricing' ? ' lr-nav--active' : ''}`}
                onClick={screen === 'pricing' ? goJourney : goPricing}
              >
                Pricing
              </button>
            )}
            <button
              type="button"
              className={`lr-nav lr-nav--blog${screen === 'blog' ? ' lr-nav--active' : ''}`}
              onClick={screen === 'blog' ? goJourney : () => goBlog()}
            >
              Blog
            </button>
            {/* Desktop only: on narrow viewports Security lives in the footer (prod parity, less crowding). */}
            <button
              type="button"
              className={`lr-nav lr-nav--security${screen === 'security' ? ' lr-nav--active' : ''}`}
              onClick={screen === 'security' ? goJourney : goSecurity}
            >
              Security
            </button>
            <AccountMenu
              account={wallet.account}
              connecting={wallet.connecting}
              walletStatus={wallet.walletStatus}
              connectMode={connectMode}
              creditBalance={wallet.account ? creditBalance : null}
              onConnect={connectPreservingPath}
              onDisconnect={wallet.disconnect}
              onAgreements={wallet.account ? goAgreements : undefined}
              onCredits={goPricing}
            />
          </div>
        </div>
      </header>

      {(wallet.error || wallet.walletStatus) && (
        <p
          className={`exp-status${wallet.error ? ' exp-status--error' : ''}`}
          role={wallet.error ? 'alert' : 'status'}
        >
          {wallet.error ?? wallet.walletStatus}
        </p>
      )}

      {(screen === 'pricing' ||
        screen === 'privacy' ||
        screen === 'security' ||
        screen === 'agreements' ||
        screen === 'blog' ||
        screen === 'not-found') && (
        <button type="button" className="lr-back" onClick={goJourney}>
          ← Back to home
        </button>
      )}

      {screen === 'pricing' && (
        <PricePage
          token={wallet.token}
          address={wallet.address}
          nimiq={wallet.nimiq}
          setNimiq={wallet.setNimiq}
          connecting={wallet.connecting}
          connectMode={connectMode}
          onConnect={connectPreservingPath}
          onCreditsPurchased={() => {
            void refreshCredits()
          }}
        />
      )}
      {screen === 'privacy' && <PrivacyPolicyPage />}
      {screen === 'security' && (
        <SecurityPage
          onCreate={() => pickRole('creator')}
          onVerify={() => pickRole('verifier')}
          onPrivacy={goPrivacy}
        />
      )}
      {screen === 'blog' && (
        <BlogPage
          key={typeof window !== 'undefined' ? window.location.pathname : '/blog'}
          path={typeof window !== 'undefined' ? window.location.pathname : '/blog'}
          onOpenIndex={() => goBlog()}
          onOpenPost={slug => goBlog(slug)}
          onPricing={goPricing}
        />
      )}
      {screen === 'agreements' && (
        <AgreementsPage
          token={wallet.token}
          address={wallet.address}
          connecting={wallet.connecting}
          connectMode={connectMode}
          onConnect={connectPreservingPath}
          onOpen={openAgreement}
          onCreate={startCreate}
        />
      )}
      {screen === 'not-found' && (
        <NotFoundPage
          path={typeof window !== 'undefined' ? window.location.pathname : null}
          onHome={goJourney}
        />
      )}

      {/* Keep journey mounted so in-progress state survives pricing/privacy/blog/security. */}
      <div hidden={screen !== 'journey'}>
        <div
          className={[
            'lr-view-blend',
            viewPhase === 'exit' ? 'lr-view-blend--exit' : '',
            viewPhase === 'enter' ? 'lr-view-blend--enter' : '',
            viewPhase === 'idle' ? 'lr-view-blend--idle' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {showHome && (
            <LandingHome
              token={wallet.token}
              address={wallet.address}
              onPickRole={pickRole}
              onOpenAgreement={openAgreement}
              onViewAllAgreements={goAgreements}
              onOpenBlogPost={slug => goBlog(slug)}
              onOpenBlogIndex={() => goBlog()}
            />
          )}
          {/* hidden (not unmounted) when home so DocumentJourney keep-alive works */}
          <div className="lr-track" hidden={!showTrack}>
            {trackMeta && TrackIcon && trackRole ? (
              <div
                className={`lr-header-track lr-header-track--${trackMeta.accent}`}
                aria-labelledby="lr-track-title"
              >
                <span className="lr-header-track-media" aria-hidden>
                  <img
                    className="lr-header-track-bg"
                    src={PATH_STILLS[trackRole]}
                    alt=""
                    width={1280}
                    height={720}
                    decoding="async"
                    style={{
                      objectPosition: formatObjectPosition(PATH_PLACEMENTS.track[trackRole]),
                    }}
                  />
                  <span className="lr-header-track-wash" />
                </span>
                <div className="lr-header-track-inner">
                  <div className="lr-header-track-copy">
                    <span className="lr-track-title-row">
                      <TrackIcon size={18} strokeWidth={PATH_ICON_STROKE} aria-hidden />
                      <h2 id="lr-track-title" className="lr-track-title">
                        {trackMeta.title}
                      </h2>
                    </span>
                    <p className="lr-track-detail">{trackMeta.detail}</p>
                  </div>
                </div>
              </div>
            ) : null}
            <DocumentJourney
              key={journeyEpoch}
              wallet={wallet}
              navEpoch={navEpoch}
              onPageMeta={handleJourneyPageMeta}
              onOpenAgreements={goAgreements}
              onHome={goJourney}
              /* Shell LandingHome owns the path picker — never double it under keep-alive. */
              suppressWelcome
            />
          </div>
        </div>
      </div>

      <footer className="lr-footer">
        <p className="lr-footer-tagline">
          Your wallet is your identity; the chain is the proof.
        </p>
        <div className="lr-footer-links">
          <button
            type="button"
            className={`lr-footer-link${screen === 'blog' ? ' lr-footer-link--active' : ''}`}
            onClick={() => goBlog()}
          >
            Blog
          </button>
          <button
            type="button"
            className={`lr-footer-link${screen === 'security' ? ' lr-footer-link--active' : ''}`}
            onClick={goSecurity}
          >
            Security
          </button>
          <button
            type="button"
            className={`lr-footer-link${screen === 'privacy' ? ' lr-footer-link--active' : ''}`}
            onClick={goPrivacy}
          >
            Privacy Policy
          </button>
        </div>
      </footer>
    </div>
  )
}
