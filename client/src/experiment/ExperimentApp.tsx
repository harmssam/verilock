import { useCallback, useEffect, useRef, useState } from 'react'
import { isPricingPath, isPrivacyPath, saveHubReturnPath } from '../hubReturnPath'
import { PricePage } from '../PricePage'
import { PrivacyPolicyPage } from '../PrivacyPolicyPage'
import { AccountMenu } from './AccountMenu'
import { DocumentJourney } from './DocumentJourney'
import {
  clearJourneyIntent,
  resolveIntentForConnect,
  saveJourneyIntent,
  syncIntentToUrl,
} from './journeyIntent'
import { useJourneyWallet } from './useJourneyWallet'

type ShellScreen = 'journey' | 'pricing' | 'privacy'

function screenFromPath(pathname: string): ShellScreen {
  if (isPricingPath(pathname)) return 'pricing'
  if (isPrivacyPath(pathname)) return 'privacy'
  return 'journey'
}

export function ExperimentApp() {
  const wallet = useJourneyWallet()
  const [screen, setScreen] = useState<ShellScreen>(() =>
    typeof window !== 'undefined' ? screenFromPath(window.location.pathname) : 'journey',
  )
  const journeyReturnPathRef = useRef('/')
  /** Bump to remount DocumentJourney when returning home (clears stuck signer path). */
  const [journeyEpoch, setJourneyEpoch] = useState(0)

  const rememberJourneyPath = useCallback(() => {
    if (typeof window === 'undefined') return
    const path = `${window.location.pathname}${window.location.search}`
    if (!isPricingPath(window.location.pathname) && !isPrivacyPath(window.location.pathname)) {
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

  useEffect(() => {
    const onPopState = () => {
      setScreen(screenFromPath(window.location.pathname))
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const connectPreservingPath = () => {
    // Prefer session intent only if already mid-path (do not rehydrate from sticky storage alone).
    const intent = resolveIntentForConnect(null)
    if (intent) {
      saveJourneyIntent(intent)
      syncIntentToUrl(intent)
    }
    saveHubReturnPath()
    void wallet.connect()
  }

  return (
    <div className="exp-app">
      <header className="exp-header">
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
          <button
            type="button"
            className={`exp-pricing-link${screen === 'pricing' ? ' exp-pricing-link--active' : ''}`}
            onClick={screen === 'pricing' ? goJourney : goPricing}
          >
            Pricing
          </button>
          <AccountMenu
            account={wallet.account}
            connecting={wallet.connecting}
            walletStatus={wallet.walletStatus}
            onConnect={connectPreservingPath}
            onDisconnect={wallet.disconnect}
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

      {(screen === 'pricing' || screen === 'privacy') && (
        <button type="button" className="exp-back-home" onClick={goJourney}>
          ← Back to home
        </button>
      )}
      {screen === 'pricing' && <PricePage />}
      {screen === 'privacy' && <PrivacyPolicyPage />}
      {/* Keep journey mounted so in-progress state survives pricing/privacy visits */}
      <div hidden={screen !== 'journey'}>
        <DocumentJourney key={journeyEpoch} wallet={wallet} />
      </div>

      <footer className="exp-footer">
        <p className="exp-footer-tagline">
          Your wallet is your identity; the chain is the proof.
        </p>
        <button
          type="button"
          className={`exp-footer-link${screen === 'privacy' ? ' exp-footer-link--active' : ''}`}
          onClick={goPrivacy}
        >
          Privacy Policy
        </button>
      </footer>
    </div>
  )
}
