import { useCallback, useEffect, useRef, useState } from 'react'
import {
  isAgreementsPath,
  isBlogPath,
  isKnownAppPath,
  isPricingPath,
  isPrivacyPath,
  saveHubReturnPath,
} from '../hubReturnPath'
import { blogSlugFromPath, getPostBySlug } from '../blog'
import { applyPageMeta, blogPostMeta, journeyPathMeta, PAGE_META, type PageMeta } from '../seo'
import type { SealDocument } from '../types'
import { PricePage } from '../PricePage'
import { PrivacyPolicyPage } from '../PrivacyPolicyPage'
import { AccountMenu } from './AccountMenu'
import { AgreementsPage } from './AgreementsPage'
import { BlogPage } from './BlogPage'
import { DocumentJourney } from './DocumentJourney'
import { NotFoundPage } from './NotFoundPage'
import { useCreditBalance } from './useCreditBalance'
import {
  clearJourneyIntent,
  resolveIntentForConnect,
  saveJourneyIntent,
  syncIntentToUrl,
} from './journeyIntent'
import {
  journeyConnectOptions,
  resolveJourneyConnectMode,
} from './journeyConnectUi'
import { useJourneyWallet } from './useJourneyWallet'
import {
  clearStripeCheckoutReturnFromUrl,
  fulfillStripeCheckoutReturn,
  peekStripeCheckoutReturn,
} from './stripeCheckoutReturn'

type ShellScreen = 'journey' | 'pricing' | 'privacy' | 'agreements' | 'blog' | 'not-found'

function screenFromPath(pathname: string): ShellScreen {
  if (isPricingPath(pathname)) return 'pricing'
  if (isPrivacyPath(pathname)) return 'privacy'
  if (isAgreementsPath(pathname)) return 'agreements'
  if (isBlogPath(pathname)) return 'blog'
  // Unknown paths (e.g. /foo) — do not fall through to the path picker as “home”.
  if (!isKnownAppPath(pathname)) return 'not-found'
  return 'journey'
}

export function ExperimentApp() {
  const wallet = useJourneyWallet()
  const { balance: creditBalance, refresh: refreshCredits } = useCreditBalance(wallet.token)
  const [screen, setScreen] = useState<ShellScreen>(() =>
    typeof window !== 'undefined' ? screenFromPath(window.location.pathname) : 'journey',
  )
  const journeyReturnPathRef = useRef('/')
  /** Bump to remount DocumentJourney when returning home (clears stuck signer path). */
  const [journeyEpoch, setJourneyEpoch] = useState(0)
  /** Bumps on shell pushState so DocumentJourney re-reads /d/:slug deep links. */
  const [navEpoch, setNavEpoch] = useState(0)
  const [journeyMeta, setJourneyMeta] = useState<PageMeta | null>(null)

  const rememberJourneyPath = useCallback(() => {
    if (typeof window === 'undefined') return
    const path = `${window.location.pathname}${window.location.search}`
    if (
      !isPricingPath(window.location.pathname) &&
      !isPrivacyPath(window.location.pathname) &&
      !isAgreementsPath(window.location.pathname) &&
      !isBlogPath(window.location.pathname)
    ) {
      journeyReturnPathRef.current = path || '/'
    }
  }, [])

  const goJourney = useCallback(() => {
    setScreen('journey')
    // Logo home: drop sticky path intent so we don't bounce back to ?intent=signer
    clearJourneyIntent()
    journeyReturnPathRef.current = '/'
    setJourneyEpoch(n => n + 1)
    window.history.pushState({}, '', '/')
    setNavEpoch(n => n + 1)
  }, [])

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

  /** Open a wallet agreement inside Journey document flow. */
  const openAgreement = useCallback((doc: SealDocument, preferSeal = false) => {
    setScreen('journey')
    // preferSeal is applied after load via query flag consumed in DocumentJourney
    const q = preferSeal ? '?preferSeal=1' : ''
    window.history.pushState({}, '', `/d/${doc.slug}${q}`)
    setNavEpoch(n => n + 1)
  }, [])

  /** Start create path from agreements empty / new button. */
  const startCreate = useCallback(() => {
    clearJourneyIntent()
    saveJourneyIntent('creator')
    setScreen('journey')
    setJourneyEpoch(n => n + 1)
    window.history.pushState({}, '', '/?intent=creator')
    setNavEpoch(n => n + 1)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      setScreen(screenFromPath(window.location.pathname))
      setNavEpoch(n => n + 1)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  /** Stripe Checkout success/cancel return — mint credits client-side if webhook missed. */
  const walletToken = wallet.token
  const walletBootReady = wallet.bootReady
  const setWalletError = wallet.setError
  useEffect(() => {
    const ret = peekStripeCheckoutReturn()
    if (!ret.status) return

    if (ret.status === 'cancel') {
      clearStripeCheckoutReturnFromUrl()
      setWalletError('Card checkout was cancelled.')
      return
    }

    // Wait until wallet session is restored from localStorage after redirect.
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
      }
      // Refresh (with pending sync) whether mint happened here or earlier via webhook.
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

  const connectMode = resolveJourneyConnectMode({
    inNimiqPay: wallet.inNimiqPay,
    mobilePayConnect: wallet.mobilePayConnect,
    showOpenInPay: wallet.showOpenInPay,
  })

  const connectPreservingPath = () => {
    // Prefer session intent only if already mid-path (do not rehydrate from sticky storage alone).
    const intent = resolveIntentForConnect(null)
    if (intent) {
      saveJourneyIntent(intent)
      syncIntentToUrl(intent)
    }
    saveHubReturnPath()
    void wallet.connect(journeyConnectOptions(connectMode))
  }

  const wideShell =
    screen === 'blog' || screen === 'pricing' || screen === 'privacy' || screen === 'agreements'

  return (
    <div className={`exp-app${wideShell ? ' exp-app--wide' : ''}`}>
      <header className={`exp-header${wallet.account ? ' exp-header--connected' : ''}`}>
        <button type="button" className="exp-brand" onClick={goJourney} aria-label="VeriLock home">
          <img
            className="exp-brand-mark"
            src="/verilock-mark.png"
            alt=""
            width={70}
            height={70}
          />
          <div className="exp-brand-text">
            <h1>VeriLock</h1>
            <p>Sign together. Prove forever.</p>
          </div>
        </button>

        <div className="exp-header-actions">
          {wallet.account && (
            <button
              type="button"
              className={`exp-pricing-link exp-nav-link${screen === 'agreements' ? ' exp-pricing-link--active' : ''}`}
              onClick={screen === 'agreements' ? goJourney : goAgreements}
            >
              Agreements
            </button>
          )}
          {/* Credits chip already opens Pricing; keep the nav link for guests / credits-off. */}
          {!(wallet.account && creditBalance != null && Number.isFinite(creditBalance)) && (
            <button
              type="button"
              className={`exp-pricing-link exp-nav-link${screen === 'pricing' ? ' exp-pricing-link--active' : ''}`}
              onClick={screen === 'pricing' ? goJourney : goPricing}
            >
              Pricing
            </button>
          )}
          <button
            type="button"
            className={`exp-pricing-link exp-nav-link${screen === 'blog' ? ' exp-pricing-link--active' : ''}`}
            onClick={screen === 'blog' ? goJourney : () => goBlog()}
          >
            Blog
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
        screen === 'agreements' ||
        screen === 'blog' ||
        screen === 'not-found') && (
        <button type="button" className="exp-back-home" onClick={goJourney}>
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
      {screen === 'blog' && (
        <BlogPage
          key={typeof window !== 'undefined' ? window.location.pathname : '/blog'}
          path={typeof window !== 'undefined' ? window.location.pathname : '/blog'}
          onOpenIndex={() => goBlog()}
          onOpenPost={slug => goBlog(slug)}
          onHome={goJourney}
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
      {/* Keep journey mounted so in-progress state survives pricing/privacy/agreements/blog visits */}
      <div hidden={screen !== 'journey'}>
        <DocumentJourney
          key={journeyEpoch}
          wallet={wallet}
          navEpoch={navEpoch}
          onPageMeta={handleJourneyPageMeta}
          onOpenAgreements={goAgreements}
          onHome={goJourney}
        />
      </div>

      <footer className="exp-footer">
        <p className="exp-footer-tagline">
          Your wallet is your identity; the chain is the proof.
        </p>
        <div className="exp-footer-links">
          <button
            type="button"
            className={`exp-footer-link${screen === 'blog' ? ' exp-footer-link--active' : ''}`}
            onClick={() => goBlog()}
          >
            Blog
          </button>
          <button
            type="button"
            className={`exp-footer-link${screen === 'privacy' ? ' exp-footer-link--active' : ''}`}
            onClick={goPrivacy}
          >
            Privacy Policy
          </button>
        </div>
      </footer>
    </div>
  )
}
