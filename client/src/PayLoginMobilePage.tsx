/**
 * Phone-side page for desktop "Login with Nimiq Pay" QR.
 * Opened as https://…/m/login/:id — deep-links into Pay when needed, then
 * completes Pay challenge/verify and binds the desktop QR room.
 *
 * Important: each QR uses a new id. The mini-app WebView often reuses the
 * previous VeriLock entry - we must re-run when the id changes, clear any
 * stashed return path after success, and leave the one-shot login URL so the
 * next scan is not blocked by a finished page.
 */
import { Check, ExternalLink, LoaderCircle, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { clearPayReturnPath } from './hubReturnPath'
import { NimiqHexagonIcon } from './NimiqHexagonIcon'
import {
  connectNimiq,
  isHubCancelError,
  isMobileDevice,
  isNimiqPayHost,
  launchNimiqPayMiniApp,
  LOGIN_CANCELED_MESSAGE,
  NIMIQ_PAY_ANDROID_URL,
  NIMIQ_PAY_IOS_URL,
  probeNimiqPay,
  signChallenge,
  warmNimiqProvider,
} from './nimiq'
import { saveSession } from './session'
import './PayLoginMobilePage.css'

type Phase = 'loading' | 'open-pay' | 'connecting' | 'done' | 'error'

function qrIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/m\/login\/([^/]+)\/?$/)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

/** Leave the consumable login URL so a reused WebView cannot re-submit it. */
function retireLoginPath(): void {
  try {
    const next = '/m/login/done'
    if (window.location.pathname !== next) {
      window.history.replaceState(window.history.state, '', next)
    }
  } catch {
    /* ignore */
  }
}

export function PayLoginMobilePage() {
  const [id, setId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? qrIdFromPath() : null,
  )
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  /** Which QR id the auto-start effect already handled (not a once-forever flag). */
  const startedForIdRef = useRef<string | null>(null)
  /** Avoid overlapping connect runs for the same id. */
  const inFlightRef = useRef(false)

  const syncIdFromLocation = useCallback(() => {
    const next = qrIdFromPath()
    setId(prev => (prev === next ? prev : next))
    return next
  }, [])

  const runPayLogin = useCallback(async (loginId: string) => {
    if (!loginId || loginId === 'done') {
      setPhase('error')
      setMessage('Invalid login link. Scan a fresh QR from the desktop Login sheet.')
      return
    }
    if (inFlightRef.current) return
    inFlightRef.current = true

    setPhase('connecting')
    setMessage('Approve each Nimiq Pay prompt when it appears…')
    setAddress(null)

    try {
      await probeNimiqPay(30_000)
      const { token: sessionToken, nonce } = await api.challenge(null)
      const { nimiq } = await connectNimiq()
      const { publicKey, signature } = await signChallenge(nimiq, nonce)
      const verified = await api.verify(sessionToken, {
        publicKey,
        signature,
        authScheme: 'pay',
      })
      saveSession({ token: sessionToken, address: verified.address })
      await api.authQrComplete(loginId, sessionToken)
      // Critical: drop browser→Pay stash so the next scan cannot restore this id.
      clearPayReturnPath()
      setAddress(verified.address)
      setPhase('done')
      setMessage('Desktop is logged in. Close this VeriLock screen before scanning a new QR.')
      // Retire the one-shot URL after paint so a reused WebView is not still "on" this room.
      window.setTimeout(() => {
        retireLoginPath()
        setId('done')
      }, 400)
    } catch (err) {
      if (isHubCancelError(err)) {
        setPhase('error')
        setMessage(LOGIN_CANCELED_MESSAGE)
        return
      }
      const msg = err instanceof Error ? err.message : 'Login failed'
      setPhase('error')
      // Consumed / expired rooms are common when the previous page was reused.
      if (/already used|not found|expired|not available/i.test(msg)) {
        clearPayReturnPath()
        setMessage(
          'This login QR is no longer valid (it may be from a previous scan). Close this screen, then scan the new QR on desktop.',
        )
      } else {
        setMessage(msg)
      }
    } finally {
      inFlightRef.current = false
    }
  }, [])

  // Keep id in sync if Pay reuses the WebView and navigates to a new QR URL
  // without a full document reload (or after bfcache restore).
  useEffect(() => {
    const onMaybeNavigate = () => {
      const next = syncIdFromLocation()
      if (next && next !== startedForIdRef.current && next !== 'done') {
        // New QR id while this page is still mounted - allow auto-start again.
        inFlightRef.current = false
      }
    }
    window.addEventListener('popstate', onMaybeNavigate)
    window.addEventListener('pageshow', onMaybeNavigate)
    document.addEventListener('visibilitychange', onMaybeNavigate)
    // Some WebViews only update location; poll lightly while visible.
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') onMaybeNavigate()
    }, 1200)
    return () => {
      window.removeEventListener('popstate', onMaybeNavigate)
      window.removeEventListener('pageshow', onMaybeNavigate)
      document.removeEventListener('visibilitychange', onMaybeNavigate)
      window.clearInterval(poll)
    }
  }, [syncIdFromLocation])

  useEffect(() => {
    if (!id || id === 'done') {
      if (id === 'done') {
        setPhase(prev => (prev === 'done' ? prev : 'done'))
        setMessage(prev =>
          prev && /logged in|Desktop is logged in/i.test(prev)
            ? prev
            : 'Desktop is logged in. Close this VeriLock screen before scanning a new QR.',
        )
        return
      }
      setPhase('error')
      setMessage('Invalid login link. Scan a fresh QR from the desktop Login sheet.')
      return
    }

    // Already started (or finished) this exact QR id in this WebView session.
    if (startedForIdRef.current === id) return
    startedForIdRef.current = id

    if (isNimiqPayHost()) {
      warmNimiqProvider()
      void runPayLogin(id)
      return
    }

    // Mobile browser: hand off into Nimiq Pay with this exact path (+ cache-bust query).
    if (isMobileDevice()) {
      setPhase('open-pay')
      setMessage('Opening Nimiq Pay…')
      const appUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`
      const result = launchNimiqPayMiniApp(appUrl)
      if (result === 'launched' || result === 'already-in-pay') {
        window.setTimeout(() => {
          setPhase(prev => (prev === 'open-pay' ? 'open-pay' : prev))
          setMessage(
            'If Nimiq Pay did not open, install the app and tap Open in Nimiq Pay below.',
          )
        }, 2500)
        return
      }
      setMessage(
        'This browser cannot open Nimiq Pay. Install the app, then open this link from your phone.',
      )
      return
    }

    // Desktop accidentally opened the QR URL - tell them to scan with phone.
    setPhase('error')
    setMessage(
      'Open this link on your phone with Nimiq Pay (scan the QR from the desktop Login sheet).',
    )
  }, [id, runPayLogin])

  const handleOpenPay = () => {
    if (!id || id === 'done') return
    const appUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`
    launchNimiqPayMiniApp(appUrl)
  }

  const handleRetry = () => {
    const current = syncIdFromLocation()
    if (!current || current === 'done') {
      setPhase('error')
      setMessage('Scan a fresh QR from the desktop Login sheet.')
      return
    }
    startedForIdRef.current = null
    inFlightRef.current = false
    startedForIdRef.current = current
    void runPayLogin(current)
  }

  const handleCloseHint = () => {
    clearPayReturnPath()
    retireLoginPath()
    // Best-effort: leave the one-shot flow for a neutral surface inside Pay.
    try {
      window.location.replace(`${window.location.origin}/`)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="pay-login-mobile">
      <header className="pay-login-mobile-head">
        <NimiqHexagonIcon size={28} className="pay-login-mobile-mark" />
        <div>
          <p className="pay-login-mobile-kicker">VeriLock</p>
          <h1>Login with Nimiq Pay</h1>
        </div>
      </header>

      {phase === 'loading' || phase === 'connecting' ? (
        <div className="pay-login-mobile-status" role="status" aria-live="polite">
          <LoaderCircle className="btn-spinner" size={28} strokeWidth={2.25} aria-hidden />
          <p>{message ?? 'Preparing…'}</p>
        </div>
      ) : null}

      {phase === 'open-pay' ? (
        <div className="pay-login-mobile-body">
          <p className="muted">{message}</p>
          <button type="button" className="btn btn-primary btn-lg" onClick={handleOpenPay}>
            <Smartphone size={18} strokeWidth={2.25} aria-hidden />
            Open in Nimiq Pay
          </button>
          <p className="muted pay-login-mobile-stores-label">Don&apos;t have the app?</p>
          <div className="pay-login-mobile-stores">
            <a className="btn btn-secondary" href={NIMIQ_PAY_IOS_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={15} strokeWidth={2.25} aria-hidden />
              App Store
            </a>
            <a
              className="btn btn-secondary"
              href={NIMIQ_PAY_ANDROID_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={15} strokeWidth={2.25} aria-hidden />
              Google Play
            </a>
          </div>
        </div>
      ) : null}

      {phase === 'done' ? (
        <div className="pay-login-mobile-status pay-login-mobile-status--done" role="status">
          <Check size={28} strokeWidth={2.5} aria-hidden />
          <p>{message}</p>
          {address ? (
            <p className="muted mono pay-login-mobile-addr">{address}</p>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={handleCloseHint}>
            Close VeriLock
          </button>
          <p className="muted pay-login-mobile-close-hint">
            Leave this screen before scanning another desktop QR - otherwise the old login page
            can block the new one.
          </p>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="pay-login-mobile-body">
          <p className="pay-login-mobile-error" role="alert">
            {message}
          </p>
          {isNimiqPayHost() || isMobileDevice() ? (
            <>
              <button type="button" className="btn btn-primary" onClick={handleRetry}>
                Try again
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleCloseHint}>
                Close VeriLock
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
