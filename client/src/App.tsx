/**
 * Production shell — light landing home + journey product flow.
 * DocumentJourney owns path stages after path pick / deep links.
 */
import { Fingerprint, ScanSearch, Users, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isAgreementsPath,
  isBlogPath,
  isKnownAppPath,
  isPdfLabPath,
  isPdfPath,
  isPricingPath,
  isPrivacyPath,
  isSecurityPath,
  isSignMobilePath,
  isSupportPath,
  saveHubReturnPath,
} from './hubReturnPath'
import { applyPageMeta, blogPostMeta, journeyPathMeta, PAGE_META, type PageMeta } from './seo'
import { blogSlugFromPath, getPostBySlug } from './blog'
import type { SealDocument } from './types'
import { PricePage } from './PricePage'
import { PrivacyPolicyPage } from './PrivacyPolicyPage'
import { SecurityPage } from './SecurityPage'
import { SupportPage } from './SupportPage'
import { AccountMenu } from './journey/AccountMenu'
import { AgreementsPage } from './journey/AgreementsPage'
import { BlogPage } from './journey/BlogPage'
import { DocumentJourney } from './journey/DocumentJourney'
import { DocumentJourney as PdfAnnotationJourney } from './experiment/DocumentJourney'
import { SignatureLab } from './experiment/SignatureLab'
import { NotFoundPage } from './journey/NotFoundPage'
import { useCreditBalance } from './journey/useCreditBalance'
import {
  clearJourneyIntent,
  resolveIntentForConnect,
  resolveJourneyIntent,
  saveJourneyIntent,
  syncIntentToUrl,
} from './journey/journeyIntent'
import {
  journeyConnectOptions,
  resolveJourneyConnectMode,
} from './journey/journeyConnectUi'
import { flushCreatePdfDraftIfNeeded } from './journey/journeyPdfDraft'
import { useJourneyWallet } from './journey/useJourneyWallet'
import {
  clearStripeCheckoutReturnFromUrl,
  fulfillStripeCheckoutReturn,
  peekStripeCheckoutReturn,
} from './journey/stripeCheckoutReturn'
import type { PathRole } from './journey/types'
import { LandingHome } from './landing/LandingHome'
import { PATH_PLACEMENTS, PATH_STILLS, placementImageStyle } from './landing/pathMedia'
import { api } from './api'
import { FEATURES } from './features'
import { LOGIN_CANCELED_MESSAGE } from './nimiq'
import { SignMobilePage } from './SignMobilePage'

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
    detail: 'Start an agreement, invite co-signers, lock a permanent proof',
    icon: Fingerprint,
    accent: 'creator',
  },
  signer: {
    title: 'I was invited',
    detail: 'Drop the shared document (or open your invite link), then sign',
    icon: Users,
    accent: 'signer',
  },
  verifier: {
    title: 'Verify a file',
    detail: 'Drop a file to check it still matches a sealed proof',
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
  | 'support'
  | 'agreements'
  | 'blog'
  | 'pdf'
  | 'pdf-lab'
  | 'sign-mobile'
  | 'not-found'

function screenFromPath(pathname: string, pdfLabEnabled = FEATURES.pdfAnnotationUi): ShellScreen {
  if (isSignMobilePath(pathname)) return 'sign-mobile'
  if (isPricingPath(pathname)) return 'pricing'
  if (isPrivacyPath(pathname)) return 'privacy'
  if (isSecurityPath(pathname)) return 'security'
  if (isSupportPath(pathname)) return 'support'
  if (isAgreementsPath(pathname)) return 'agreements'
  if (isBlogPath(pathname)) return 'blog'
  // PDF lab is parallel to seal — only mount when flag allows
  if (pdfLabEnabled && isPdfLabPath(pathname)) return 'pdf-lab'
  if (pdfLabEnabled && isPdfPath(pathname)) return 'pdf'
  if (!isKnownAppPath(pathname)) return 'not-found'
  // /pdf with lab disabled → 404 shell
  if (isPdfPath(pathname) || isPdfLabPath(pathname)) return 'not-found'
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

/** SPA screens keep scroll; always open path / shell views at the top. */
function scrollShellTop(): void {
  if (typeof window === 'undefined') return
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}

/**
 * Push a new history entry without replaceState-mutating the previous one.
 * Critical for path cards: Back must restore clean landing `/`, not a prior shell page.
 */
function pushShellUrl(next: string): void {
  if (typeof window === 'undefined') return
  const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (cur === next) {
    window.history.replaceState(window.history.state, '', next)
    return
  }
  window.history.pushState({}, '', next)
}

export function App() {
  const wallet = useJourneyWallet()
  const { balance: creditBalance, refresh: refreshCredits } = useCreditBalance(wallet.token)
  /** Runtime kill-switch from /api/features (PDF lab parallel to seal). */
  const [pdfLabEnabled, setPdfLabEnabled] = useState(FEATURES.pdfAnnotationUi)
  const [screen, setScreen] = useState<ShellScreen>(() =>
    typeof window !== 'undefined' ? screenFromPath(window.location.pathname) : 'journey',
  )

  useEffect(() => {
    let cancelled = false
    void api
      .features()
      .then(f => {
        if (cancelled) return
        if (typeof f.pdfAnnotationUi === 'boolean') {
          setPdfLabEnabled(f.pdfAnnotationUi)
          // Re-resolve screen if user is on /pdf while flag flips
          if (typeof window !== 'undefined') {
            setScreen(screenFromPath(window.location.pathname, f.pdfAnnotationUi))
          }
        }
      })
      .catch(() => {
        /* keep build-time FEATURES default */
      })
    return () => {
      cancelled = true
    }
  }, [])
  const journeyReturnPathRef = useRef('/')
  const [journeyEpoch, setJourneyEpoch] = useState(0)
  const [navEpoch, setNavEpoch] = useState(0)
  const [journeyMeta, setJourneyMeta] = useState<PageMeta | null>(null)
  /** Active path for track title (shell-owned; intent can lag after Back home). */
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
      !isSupportPath(window.location.pathname) &&
      !isAgreementsPath(window.location.pathname) &&
      !isBlogPath(window.location.pathname) &&
      !isPdfPath(window.location.pathname) &&
      !isPdfLabPath(window.location.pathname)
    ) {
      journeyReturnPathRef.current = path || '/'
    }
  }, [])

  const goJourney = useCallback(() => {
    setScreen('journey')
    clearJourneyIntent()
    journeyReturnPathRef.current = '/'
    // Push clean home — do not replaceState the track entry (that would break Back).
    pushShellUrl('/')
    setNavEpoch(n => n + 1)
    // Remount + clear title at blend mid so the current track fades out cleanly.
    blendToSurface('home', { clearTrackRole: true, remountJourney: true })
    scrollShellTop()
  }, [blendToSurface])

  const goPricing = useCallback(() => {
    rememberJourneyPath()
    setScreen('pricing')
    pushShellUrl('/pricing')
    scrollShellTop()
  }, [rememberJourneyPath])

  const goPrivacy = useCallback(() => {
    rememberJourneyPath()
    setScreen('privacy')
    pushShellUrl('/privacy')
    scrollShellTop()
  }, [rememberJourneyPath])

  const goSecurity = useCallback(() => {
    rememberJourneyPath()
    setScreen('security')
    pushShellUrl('/security')
    scrollShellTop()
  }, [rememberJourneyPath])

  const goSupport = useCallback(() => {
    rememberJourneyPath()
    setScreen('support')
    pushShellUrl('/support')
    scrollShellTop()
  }, [rememberJourneyPath])

  const goAgreements = useCallback(() => {
    rememberJourneyPath()
    setScreen('agreements')
    pushShellUrl('/agreements')
    scrollShellTop()
  }, [rememberJourneyPath])

  const goBlog = useCallback((slug?: string) => {
    rememberJourneyPath()
    setScreen('blog')
    const next = slug ? `/blog/${slug}` : '/blog'
    pushShellUrl(next)
    scrollShellTop()
  }, [rememberJourneyPath])

  const openAgreement = useCallback(
    (doc: SealDocument, preferSeal = false) => {
      setScreen('journey')
      setTrackRole(null)
      const q = preferSeal ? '?preferSeal=1' : ''
      pushShellUrl(`/d/${doc.slug}${q}`)
      setJourneyEpoch(n => n + 1)
      setNavEpoch(n => n + 1)
      blendToSurface('track')
      scrollShellTop()
    },
    [blendToSurface],
  )

  const startCreate = useCallback(() => {
    clearJourneyIntent()
    saveJourneyIntent('creator')
    // Do NOT syncIntentToUrl before push — replaceState would overwrite landing `/`.
    setTrackRole('creator')
    setScreen('journey')
    setJourneyEpoch(n => n + 1)
    pushShellUrl('/?intent=creator')
    setNavEpoch(n => n + 1)
    blendToSurface('track')
    scrollShellTop()
  }, [blendToSurface])

  /**
   * Enter a path track. Default remounts DocumentJourney (path picker).
   * `remount: false` keeps in-memory PDF (e.g. sealed → verify handoff).
   */
  const pickRole = useCallback(
    (role: PathRole, opts?: { remount?: boolean }) => {
      const remount = opts?.remount !== false
      saveJourneyIntent(role)
      // Single push of ?intent= only. syncIntentToUrl uses replaceState and was
      // destroying the clean landing history entry, so Back skipped home.
      setTrackRole(role)
      setScreen('journey')
      if (remount) setJourneyEpoch(n => n + 1)
      pushShellUrl(`/?intent=${role}`)
      setNavEpoch(n => n + 1)
      blendToSurface('track')
      scrollShellTop()
    },
    [blendToSurface],
  )

  const connectPreservingPath = useCallback(
    (options?: { useRedirect?: boolean }) => {
      const intent = resolveIntentForConnect(null)
      if (intent) {
        saveJourneyIntent(intent)
        // replaceState OK here: keep Hub return URL accurate without a new stack entry.
        syncIntentToUrl(intent)
      }
      saveHubReturnPath()
      // Explicit options from mobile chooser (Pay vs Hub); otherwise resolve from mode.
      // Flush create-path PDF + form fields before Hub remount (header Login path).
      void (async () => {
        await flushCreatePdfDraftIfNeeded()
        await wallet.connect(
          options !== undefined ? options : journeyConnectOptions(connectMode),
        )
      })()
    },
    [connectMode, wallet],
  )

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname
      const nextScreen = screenFromPath(path, pdfLabEnabled)
      setScreen(nextScreen)
      setNavEpoch(n => n + 1)
      if (nextScreen === 'journey') {
        // resolveJourneyIntent clears sticky session intent on clean `/`.
        const intent = resolveJourneyIntent()
        const deep = isDeepLinkPath(path)
        const showTrack = deep || Boolean(intent)
        setTrackRole(intent)
        if (showTrack) {
          blendToSurface('track')
        } else {
          blendToSurface('home', { clearTrackRole: true, remountJourney: true })
        }
      }
      scrollShellTop()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [blendToSurface, pdfLabEnabled])

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
    if (screen === 'support') {
      applyPageMeta({ ...PAGE_META.support })
      return
    }
    if (screen === 'agreements') {
      applyPageMeta({ ...PAGE_META.agreements })
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
      }
      applyPageMeta({ ...PAGE_META.blog })
      return
    }
    if (screen === 'pdf' || screen === 'pdf-lab') {
      applyPageMeta({
        ...PAGE_META.pdf,
        ...(screen === 'pdf-lab'
          ? {
              title: 'Signature encoding lab · VeriLock',
              path: '/pdf/lab',
              description:
                'Compare signature PNG vs simplified vector paths and estimated Nimiq frame counts.',
            }
          : {}),
      })
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
   * so mid-flow state survives pricing / privacy / security visits.
   */
  const showHome = screen === 'journey' && viewSurface === 'home'
  const showTrack = viewSurface === 'track'
  const trackMeta = trackRole ? TRACK_META[trackRole] : null
  const TrackIcon = trackMeta?.icon

  // Wider content shell (blog, privacy, security, support, etc.). Agreements matches landing (960px), not this.
  const wideShell =
    screen === 'pricing' ||
    screen === 'privacy' ||
    screen === 'security' ||
    screen === 'support' ||
    screen === 'blog' ||
    screen === 'pdf' ||
    screen === 'pdf-lab' ||
    screen === 'not-found'

  // Focused mobile ink capture — no shell chrome / wallet header.
  if (screen === 'sign-mobile') {
    return <SignMobilePage />
  }

  return (
    <div
      className={[
        'lr-app',
        'exp-app',
        wideShell ? 'exp-app--wide' : '',
        // Home, tracks, and agreements share one desktop content width.
        screen === 'journey' || screen === 'agreements' ? 'lr-app--landing' : '',
        // Pricing + Security: 960px shell (not the wider exp-app--wide content pages).
        screen === 'pricing' || screen === 'security' ? 'lr-app--pricing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >

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
            {/* Logged-in: Agreements nav. */}
            {wallet.account && (
              <button
                type="button"
                className={`lr-nav${screen === 'agreements' ? ' lr-nav--active' : ''}`}
                onClick={goAgreements}
                aria-current={screen === 'agreements' ? 'page' : undefined}
              >
                Agreements
              </button>
            )}
            {/*
              Credits chip (AccountMenu) already opens Pricing when balance is known.
              Hide Pricing nav when credits chip already covers it.
            */}
            {!(wallet.account && creditBalance != null && Number.isFinite(creditBalance)) && (
              <button
                type="button"
                className={`lr-nav${screen === 'pricing' ? ' lr-nav--active' : ''}`}
                onClick={goPricing}
                aria-current={screen === 'pricing' ? 'page' : undefined}
              >
                Pricing
              </button>
            )}
            <button
              type="button"
              className={`lr-nav lr-nav--blog${screen === 'blog' ? ' lr-nav--active' : ''}`}
              onClick={() => goBlog()}
              aria-current={screen === 'blog' ? 'page' : undefined}
            >
              Blog
            </button>
            {/* Desktop only: on narrow viewports Security lives in the footer (prod parity, less crowding). */}
            <button
              type="button"
              className={`lr-nav lr-nav--security${screen === 'security' ? ' lr-nav--active' : ''}`}
              onClick={goSecurity}
              aria-current={screen === 'security' ? 'page' : undefined}
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
          className={[
            'exp-status',
            wallet.error ? 'exp-status--error' : '',
            wallet.error === LOGIN_CANCELED_MESSAGE ? 'exp-status--ephemeral' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role={wallet.error ? 'alert' : 'status'}
        >
          {wallet.error ?? wallet.walletStatus}
        </p>
      )}

      {(screen === 'pricing' ||
        screen === 'privacy' ||
        screen === 'security' ||
        screen === 'support' ||
        screen === 'agreements' ||
        screen === 'blog' ||
        screen === 'pdf' ||
        screen === 'pdf-lab' ||
        screen === 'not-found') && (
        <button type="button" className="lr-back" onClick={goJourney}>
          ← Back to home
        </button>
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
      {screen === 'support' && <SupportPage />}
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
      {pdfLabEnabled && screen === 'pdf' && <PdfAnnotationJourney wallet={wallet} />}
      {pdfLabEnabled && screen === 'pdf-lab' && <SignatureLab />}
      {screen === 'not-found' && (
        <NotFoundPage
          path={typeof window !== 'undefined' ? window.location.pathname : null}
          onHome={goJourney}
        />
      )}

      {/* Keep journey mounted so in-progress state survives pricing/privacy/security. */}
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
              onPickRole={pickRole}
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
                    draggable={false}
                    style={placementImageStyle(PATH_PLACEMENTS.track[trackRole])}
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
              onHome={goJourney}
              onStartCreate={startCreate}
              onSwitchPath={role => pickRole(role, { remount: false })}
              /* Shell LandingHome owns the path picker — never double it under keep-alive. */
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
          <button
            type="button"
            className={`lr-footer-link${screen === 'support' ? ' lr-footer-link--active' : ''}`}
            onClick={goSupport}
          >
            Support
          </button>
        </div>
      </footer>
    </div>
  )
}
