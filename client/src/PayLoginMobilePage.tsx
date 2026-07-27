/**
 * Phone-side page for desktop "Login with Nimiq Pay" QR.
 * Opened as https://…/m/login/:id — deep-links into Pay when needed, then
 * completes Pay challenge/verify and binds the desktop QR room.
 */
import { Check, ExternalLink, LoaderCircle, Smartphone } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
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

export function PayLoginMobilePage() {
  const id = qrIdFromPath()
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const ranRef = useRef(false)

  const runPayLogin = useCallback(async () => {
    if (!id) {
      setPhase('error')
      setMessage('Invalid login link.')
      return
    }

    setPhase('connecting')
    setMessage('Approve each Nimiq Pay prompt when it appears…')

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
      await api.authQrComplete(id, sessionToken)
      setAddress(verified.address)
      setPhase('done')
      setMessage('Desktop is logged in. You can close this tab.')
    } catch (err) {
      if (isHubCancelError(err)) {
        setPhase('error')
        setMessage(LOGIN_CANCELED_MESSAGE)
        return
      }
      setPhase('error')
      setMessage(err instanceof Error ? err.message : 'Login failed')
    }
  }, [id])

  useEffect(() => {
    if (!id) {
      setPhase('error')
      setMessage('Invalid login link. Scan a fresh QR from the desktop Login sheet.')
      return
    }
    if (ranRef.current) return
    ranRef.current = true

    if (isNimiqPayHost()) {
      warmNimiqProvider()
      void runPayLogin()
      return
    }

    // Mobile browser: hand off into Nimiq Pay with this exact path.
    if (isMobileDevice()) {
      setPhase('open-pay')
      setMessage('Opening Nimiq Pay…')
      const appUrl = `${window.location.origin}/m/login/${encodeURIComponent(id)}`
      const result = launchNimiqPayMiniApp(appUrl)
      if (result === 'launched' || result === 'already-in-pay') {
        // If still here after a moment, show manual open + stores.
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
    if (!id) return
    const appUrl = `${window.location.origin}/m/login/${encodeURIComponent(id)}`
    launchNimiqPayMiniApp(appUrl)
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
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className="pay-login-mobile-body">
          <p className="pay-login-mobile-error" role="alert">
            {message}
          </p>
          {isNimiqPayHost() || isMobileDevice() ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                ranRef.current = false
                void runPayLogin()
              }}
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
