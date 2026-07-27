import { ChevronLeft, ExternalLink, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import { IPhoneIcon } from '../IPhoneIcon'
import {
  isLoopbackAppOrigin,
  isMobileDevice,
  isNimiqPayHost,
  NIMIQ_PAY_ANDROID_URL,
  NIMIQ_PAY_IOS_URL,
  payLoginQrPayload,
} from '../nimiq'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import { qrDataUrl } from '../signatureHandoff/qr'
import {
  journeyConnectLabels,
  journeyDesktopChoiceLabels,
  journeyLoginSheetCopy,
  journeyMobileChoiceLabels,
  type JourneyConnectMode,
  type JourneyConnectRequest,
} from './journeyConnectUi'

interface LoginSheetProps {
  open: boolean
  connectMode: JourneyConnectMode
  connecting: boolean
  /** Optional status line under the proceed button */
  walletStatus?: string | null
  onClose?: () => void
  /**
   * Start connect. Pass `{ useRedirect: true }` for Hub,
   * `{ useRedirect: false }` for Nimiq Pay deeplink on mobile.
   */
  onProceed: (options?: JourneyConnectRequest) => void
  /**
   * Desktop Pay QR success - parent applies session (same as Hub/Pay verify).
   */
  onSession?: (token: string, address: string) => void
  /** Anchor under a header Login button vs full-width in a page card */
  placement?: 'popover' | 'inline'
  /** Hide the X control (e.g. forced open on the connect step). */
  showClose?: boolean
}

const QR_POLL_MS = 1600

type QrPhase = 'idle' | 'loading' | 'waiting' | 'error'

/**
 * Explains Nimiq + how to connect, then runs the real wallet connect on proceed.
 *
 * Mobile (`pay-open` / `hub-fallback`): dual choice - Nimiq Pay app or Hub in browser.
 * Desktop (`desktop-choice`): dual choice - Pay QR or Hub.
 */
export function LoginSheet({
  open,
  connectMode,
  connecting,
  walletStatus,
  onClose,
  onProceed,
  onSession,
  placement = 'popover',
  showClose,
}: LoginSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const copy = journeyLoginSheetCopy(connectMode)
  const labels = journeyConnectLabels(connectMode)
  const mobileChoice = journeyMobileChoiceLabels()
  const desktopChoice = journeyDesktopChoiceLabels()
  const canClose = showClose ?? placement === 'popover'
  /**
   * Hard gate: real phones never use the desktop QR path (that broke mobile Pay
   * when a device was mis-classified as desktop-choice). Mobile browser = deeplink
   * chooser; desktop only = Hub + Pay QR.
   */
  const forceMobileChooser =
    typeof window !== 'undefined' && isMobileDevice() && !isNimiqPayHost()
  const isMobileChoice =
    forceMobileChooser ||
    connectMode === 'pay-open' ||
    connectMode === 'hub-fallback'
  const isDesktopChoice = !forceMobileChooser && connectMode === 'desktop-choice'
  const isChoice = isMobileChoice || isDesktopChoice
  /** Localhost / 127.0.0.1 - phone cannot reach this machine; Pay QR is prod-only. */
  const payQrUnavailableLocal = isLoopbackAppOrigin()
  /**
   * Hub primary: desktop default, or mobile after Pay deeplink failed.
   * Never demote mobile “Open in Nimiq Pay” just because origin is loopback.
   */
  const hubPreferred = isDesktopChoice || connectMode === 'hub-fallback'
  const [pendingChoice, setPendingChoice] = useState<'pay' | 'hub' | null>(null)

  const [qrPhase, setQrPhase] = useState<QrPhase>('idle')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const qrIdRef = useRef<string | null>(null)
  const pollSecretRef = useRef<string | null>(null)

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const resetQr = useCallback(() => {
    clearPoll()
    qrIdRef.current = null
    pollSecretRef.current = null
    setQrPhase('idle')
    setQrImage(null)
    setQrError(null)
    setQrExpiresAt(null)
    setPendingChoice(null)
  }, [clearPoll])

  useEffect(() => {
    if (!connecting) setPendingChoice(prev => (prev === 'hub' ? null : prev))
  }, [connecting])

  useEffect(() => {
    if (!open) {
      resetQr()
    }
  }, [open, resetQr])

  useEffect(() => {
    return () => clearPoll()
  }, [clearPoll])

  const startPayQr = useCallback(async () => {
    if (payQrUnavailableLocal) {
      setQrError(
        'Nimiq Pay QR login does not work on localhost - your phone cannot open this machine. Use Nimiq Hub below (or test on production).',
      )
      setQrPhase('error')
      return
    }
    if (!onSession) {
      setQrError('Pay QR login is not available here.')
      setQrPhase('error')
      return
    }
    clearPoll()
    setPendingChoice('pay')
    setQrPhase('loading')
    setQrError(null)
    setQrImage(null)

    try {
      const { id, pollSecret, expiresAt } = await api.authQrStart()
      qrIdRef.current = id
      pollSecretRef.current = pollSecret
      const payload = payLoginQrPayload(id)
      if (payload.loopback) {
        setQrPhase('error')
        setQrError(
          'Nimiq Pay QR login does not work on localhost - your phone cannot open this machine. Use Nimiq Hub below (or test on production).',
        )
        setPendingChoice(null)
        return
      }
      setQrExpiresAt(expiresAt)
      // nimiqpay:// so the camera can open Pay; embedded URL must be public (prod).
      // pollSecret is never encoded in the QR — only held in this tab for polling.
      const dataUrl = await qrDataUrl(payload.qrText, 200)
      setQrImage(dataUrl)
      setQrPhase('waiting')

      pollTimerRef.current = window.setInterval(() => {
        const sid = qrIdRef.current
        const secret = pollSecretRef.current
        if (!sid || !secret) return
        void (async () => {
          try {
            const status = await api.authQrStatus(sid, secret)
            if (status.status === 'ready' && status.token && status.address) {
              clearPoll()
              onSession(status.token, status.address)
              resetQr()
              onClose?.()
              return
            }
            if (status.status === 'expired' || status.status === 'consumed') {
              clearPoll()
              setQrPhase('error')
              setQrError(
                status.status === 'expired'
                  ? 'QR expired. Generate a new one to try again.'
                  : 'This QR was already used. Generate a new one.',
              )
              setPendingChoice(null)
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : ''
            if (/expired|not found|already used|poll secret|401|429/i.test(msg)) {
              clearPoll()
              setQrPhase('error')
              setQrError(
                /429|too many/i.test(msg)
                  ? 'Too many poll attempts - wait a moment and try a new QR.'
                  : msg || 'QR login failed',
              )
              setPendingChoice(null)
            }
          }
        })()
      }, QR_POLL_MS)
    } catch (err) {
      setQrPhase('error')
      setQrError(err instanceof Error ? err.message : 'Could not start QR login')
      setPendingChoice(null)
    }
  }, [clearPoll, onClose, onSession, payQrUnavailableLocal, resetQr])

  useEffect(() => {
    if (!open || !canClose || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !connecting && qrPhase !== 'waiting' && qrPhase !== 'loading') {
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, connecting, onClose, canClose, qrPhase])

  useEffect(() => {
    if (!open || placement !== 'popover' || !onClose) return
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-login-trigger]')) return
      if (!connecting && qrPhase !== 'waiting' && qrPhase !== 'loading') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, placement, connecting, onClose, qrPhase])

  useEffect(() => {
    if (!open || placement !== 'popover') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open, placement])

  if (!open) return null

  const payBtnClass = hubPreferred ? 'btn btn-secondary' : 'btn btn-primary'
  const hubBtnClass = hubPreferred ? 'btn btn-primary' : 'btn btn-secondary'
  const showingPayQr =
    isDesktopChoice && (qrPhase === 'loading' || qrPhase === 'waiting')

  const expiresLabel =
    qrExpiresAt != null
      ? `Expires ${new Date(qrExpiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null

  const panel = (
    <div
      ref={panelRef}
      className={[
        'login-sheet',
        `login-sheet--${placement}`,
        isChoice && !showingPayQr ? 'login-sheet--choice' : '',
        showingPayQr ? 'login-sheet--qr-only' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="dialog"
      aria-modal={placement === 'popover' ? true : undefined}
      aria-labelledby={titleId}
    >
      {showingPayQr ? (
        <div className="login-sheet-qr" role="status" aria-live="polite">
          <button
            type="button"
            className="btn btn-ghost login-sheet-qr-back"
            onClick={() => resetQr()}
          >
            <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
            Back
          </button>
          <h3 id={titleId} className="login-sheet-sr-only">
            Scan with Nimiq Pay
          </h3>
          {qrImage ? (
            <img
              className="login-sheet-qr-img"
              src={qrImage}
              alt="Scan with Nimiq Pay on your phone"
              width={200}
              height={200}
            />
          ) : (
            <div className="login-sheet-qr-placeholder">
              <LoaderCircle className="btn-spinner" size={24} strokeWidth={2.5} aria-hidden />
            </div>
          )}
          <p className="muted login-sheet-qr-hint">{desktopChoice.payHint}</p>
          <p className="login-sheet-qr-wait">
            {qrPhase === 'loading' ? 'Generating QR…' : desktopChoice.payBusy}
          </p>
          {expiresLabel && <p className="muted login-sheet-qr-expires">{expiresLabel}</p>}
        </div>
      ) : (
        <>
          <header className="login-sheet-head">
            <div className="login-sheet-title-row">
              <NimiqHexagonIcon size={22} className="login-sheet-mark" />
              <div>
                <h3 id={titleId}>{copy.title}</h3>
              </div>
            </div>
            {canClose && onClose && (
              <button
                type="button"
                className="login-sheet-close"
                onClick={() => {
                  resetQr()
                  onClose()
                }}
                disabled={connecting && pendingChoice === 'hub'}
                aria-label="Close login"
              >
                <X size={18} strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </header>

          <p className="login-sheet-about">{copy.about}</p>

          {copy.steps.length > 0 && (
            <ol className="login-sheet-steps">
              {copy.steps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}

          {isDesktopChoice ? (
            <div className="login-sheet-choices">
              <div className="login-sheet-choice">
                <button
                  type="button"
                  className={`${hubBtnClass} login-sheet-proceed${pendingChoice === 'hub' ? ' btn--busy' : ''}`}
                  onClick={() => {
                    resetQr()
                    setPendingChoice('hub')
                    onProceed({ useRedirect: true })
                  }}
                  disabled={connecting}
                >
                  {pendingChoice === 'hub' && connecting ? (
                    <>
                      <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                      {desktopChoice.hubBusy}
                    </>
                  ) : (
                    <>
                      <NimiqHexagonIcon size={16} />
                      {desktopChoice.hubIdle}
                    </>
                  )}
                </button>
                <p className="muted login-sheet-choice-hint">{desktopChoice.hubHint}</p>
              </div>

              <div className="login-sheet-choice-divider" role="presentation">
                <span>or</span>
              </div>

              <div className="login-sheet-choice">
                <button
                  type="button"
                  className={`${payBtnClass} login-sheet-proceed`}
                  onClick={() => void startPayQr()}
                  disabled={connecting}
                >
                  <IPhoneIcon size={16} strokeWidth={2.25} />
                  {desktopChoice.payIdle}
                </button>
                {payQrUnavailableLocal && (
                  <p className="muted login-sheet-choice-hint">
                    Nimiq Pay QR is not available on localhost - use Hub above, or try this on
                    production.
                  </p>
                )}
                {qrError && (
                  <p className="login-sheet-qr-error" role="alert">
                    {qrError}
                  </p>
                )}
              </div>
            </div>
          ) : isMobileChoice ? (
            <div className="login-sheet-choices">
              <div className="login-sheet-choice">
                <button
                  type="button"
                  className={`${payBtnClass} login-sheet-proceed${pendingChoice === 'pay' ? ' btn--busy' : ''}`}
                  onClick={() => {
                    setPendingChoice('pay')
                    onProceed({ useRedirect: false })
                  }}
                  disabled={connecting}
                >
                  {pendingChoice === 'pay' ? (
                    <>
                      <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                      {mobileChoice.payBusy}
                    </>
                  ) : (
                    <>
                      <IPhoneIcon size={16} strokeWidth={2.25} />
                      {mobileChoice.payIdle}
                    </>
                  )}
                </button>
                <p className="muted login-sheet-choice-hint">{mobileChoice.payHint}</p>
                <div className="login-sheet-store-row">
                  <a
                    className="btn btn-ghost login-sheet-store-link"
                    href={NIMIQ_PAY_IOS_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} strokeWidth={2.25} aria-hidden />
                    App Store
                  </a>
                  <a
                    className="btn btn-ghost login-sheet-store-link"
                    href={NIMIQ_PAY_ANDROID_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} strokeWidth={2.25} aria-hidden />
                    Google Play
                  </a>
                </div>
              </div>

              <div className="login-sheet-choice-divider" role="presentation">
                <span>or</span>
              </div>

              <div className="login-sheet-choice">
                <button
                  type="button"
                  className={`${hubBtnClass} login-sheet-proceed${pendingChoice === 'hub' ? ' btn--busy' : ''}`}
                  onClick={() => {
                    setPendingChoice('hub')
                    onProceed({ useRedirect: true })
                  }}
                  disabled={connecting}
                >
                  {pendingChoice === 'hub' ? (
                    <>
                      <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                      {mobileChoice.hubBusy}
                    </>
                  ) : (
                    <>
                      <NimiqHexagonIcon size={16} />
                      {mobileChoice.hubIdle}
                    </>
                  )}
                </button>
                <p className="muted login-sheet-choice-hint">{mobileChoice.hubHint}</p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`btn btn-primary login-sheet-proceed${connecting ? ' btn--busy' : ''}`}
              onClick={() => onProceed()}
              disabled={connecting}
            >
              {connecting ? (
                <>
                  <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                  {labels.busy}
                </>
              ) : (
                <>
                  <NimiqHexagonIcon size={16} />
                  {labels.idle}
                </>
              )}
            </button>
          )}

          {walletStatus && (
            <p className="login-sheet-status" role="status">
              {walletStatus}
            </p>
          )}
        </>
      )}
    </div>
  )

  if (placement === 'popover') {
    return createPortal(
      <div className="login-sheet-layer">
        <button
          type="button"
          className="login-sheet-backdrop"
          aria-label="Dismiss login"
          disabled={connecting || qrPhase === 'waiting' || qrPhase === 'loading'}
          onClick={() => {
            if (!connecting && qrPhase !== 'waiting' && qrPhase !== 'loading') {
              resetQr()
              onClose?.()
            }
          }}
        />
        {panel}
      </div>,
      document.body,
    )
  }

  return panel
}
