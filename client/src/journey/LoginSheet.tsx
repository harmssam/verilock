import { ExternalLink, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { blogPostUrl } from '../blogPublicUrl'
import { IPhoneIcon } from '../IPhoneIcon'
import { isLoopbackAppOrigin, NIMIQ_PAY_ANDROID_URL, NIMIQ_PAY_IOS_URL } from '../nimiq'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import { DesktopPayQrPanel } from './DesktopPayQrPanel'
import {
  asLoginSurface,
  journeyConnectLabels,
  journeyDesktopChoiceLabels,
  journeyHubPreferred,
  journeyLoginSheetCopy,
  journeyMobileChoiceLabels,
  type JourneyConnectMode,
  type JourneyConnectRequest,
} from './journeyConnectUi'

/** Blog: wallet-as-account (no email / site password). */
const EMAIL_LOGIN_FAQ_URL = blogPostUrl('no-email-no-password-nimiq-accounts')

interface LoginSheetProps {
  open: boolean
  connectMode: JourneyConnectMode
  connecting: boolean
  walletStatus?: string | null
  /** Wallet connect error — must show inside the sheet (banner can be hidden behind the modal). */
  error?: string | null
  onClose?: () => void
  /**
   * Start connect. `{ useRedirect: true }` = Hub;
   * `{ useRedirect: false }` = Nimiq Pay deeplink on mobile.
   */
  onProceed: (options?: JourneyConnectRequest) => void
  /** Desktop Pay QR success. */
  onSession?: (token: string, address: string) => void
  placement?: 'popover' | 'inline'
  showClose?: boolean
  /** Mobile: Pay deeplink failed — prefer Hub button. */
  showOpenInPay?: boolean
}

/**
 * Login chooser sheet.
 * - mobile: Open in Nimiq Pay (primary) vs Hub; after failed Pay check, Hub is promoted
 * - desktop: Hub vs Pay QR (QR is a nested panel)
 * - in-pay: simple proceed (usually skipped by needsSheet)
 */
export function LoginSheet({
  open,
  connectMode,
  connecting,
  walletStatus,
  error = null,
  onClose,
  onProceed,
  onSession,
  placement = 'popover',
  showClose,
  showOpenInPay = false,
}: LoginSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const surface = asLoginSurface(connectMode)
  const copy = journeyLoginSheetCopy(connectMode)
  const labels = journeyConnectLabels(connectMode)
  const mobileChoice = journeyMobileChoiceLabels()
  const desktopChoice = journeyDesktopChoiceLabels()
  const canClose = showClose ?? placement === 'popover'
  const hubPreferred = journeyHubPreferred(connectMode, showOpenInPay)
  const payQrUnavailableLocal = isLoopbackAppOrigin()

  const [pendingChoice, setPendingChoice] = useState<'pay' | 'hub' | null>(null)
  const [desktopQrOpen, setDesktopQrOpen] = useState(false)

  useEffect(() => {
    if (!connecting) setPendingChoice(null)
  }, [connecting])

  useEffect(() => {
    if (!open) {
      setDesktopQrOpen(false)
      setPendingChoice(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !canClose || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !connecting && !desktopQrOpen) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, connecting, onClose, canClose, desktopQrOpen])

  useEffect(() => {
    if (!open || placement !== 'popover' || !onClose) return
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-login-trigger]')) return
      if (!connecting && !desktopQrOpen) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, placement, connecting, onClose, desktopQrOpen])

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

  const panel = (
    <div
      ref={panelRef}
      className={[
        'login-sheet',
        `login-sheet--${placement}`,
        surface !== 'in-pay' && !desktopQrOpen ? 'login-sheet--choice' : '',
        desktopQrOpen ? 'login-sheet--qr-only' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="dialog"
      aria-modal={placement === 'popover' ? true : undefined}
      aria-labelledby={titleId}
    >
      {desktopQrOpen && onSession ? (
        <DesktopPayQrPanel
          onSession={onSession}
          onBack={() => setDesktopQrOpen(false)}
          onClose={onClose}
        />
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
                onClick={onClose}
                disabled={connecting && pendingChoice === 'hub'}
                aria-label="Close login"
              >
                <X size={18} strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </header>

          {/* Miss panel has its own copy — skip the default lead. */}
          {!(surface === 'mobile' && showOpenInPay) && (
            <>
              <p className="login-sheet-about">{copy.about}</p>
              <p className="login-sheet-email-help">
                <a
                  className="login-sheet-email-help-link"
                  href={EMAIL_LOGIN_FAQ_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Why can&apos;t I use my email?
                </a>
              </p>
            </>
          )}

          {copy.steps.length > 0 && !(surface === 'mobile' && showOpenInPay) && (
            <ol className="login-sheet-steps">
              {copy.steps.map(step => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}

          {surface === 'desktop' ? (
            <div className="login-sheet-choices login-sheet-choices--side">
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
                  onClick={() => {
                    if (!onSession) return
                    if (payQrUnavailableLocal) {
                      return
                    }
                    setDesktopQrOpen(true)
                  }}
                  disabled={connecting || !onSession || payQrUnavailableLocal}
                >
                  <IPhoneIcon size={16} strokeWidth={2.25} />
                  {desktopChoice.payIdle}
                </button>
                <p className="muted login-sheet-choice-hint">
                  {payQrUnavailableLocal
                    ? 'Nimiq Pay QR is not available on localhost — use Hub, or try this on production.'
                    : desktopChoice.payHint}
                </p>
              </div>
            </div>
          ) : surface === 'mobile' ? (
            showOpenInPay ? (
              /* Pay app not detected — visual recovery: install or Hub */
              <div className="login-sheet-pay-miss">
                <div className="login-sheet-pay-miss-badge" aria-hidden>
                  <IPhoneIcon size={22} strokeWidth={2.1} />
                </div>
                <p className="login-sheet-pay-miss-title">Nimiq Pay was not detected</p>
                <p className="login-sheet-pay-miss-copy">
                  This browser could not open the Nimiq Pay app. Install it, then try again — or
                  continue with Nimiq Hub in this browser.
                </p>
                <button
                  type="button"
                  className={`btn btn-primary login-sheet-proceed${pendingChoice === 'hub' ? ' btn--busy' : ''}`}
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
                <p className="login-sheet-pay-miss-or muted" role="presentation">
                  or install Nimiq Pay
                </p>
                <div className="login-sheet-store-row login-sheet-store-row--miss">
                  <a
                    className="btn btn-secondary login-sheet-store-link"
                    href={NIMIQ_PAY_IOS_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} strokeWidth={2.25} aria-hidden />
                    App Store
                  </a>
                  <a
                    className="btn btn-secondary login-sheet-store-link"
                    href={NIMIQ_PAY_ANDROID_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={13} strokeWidth={2.25} aria-hidden />
                    Google Play
                  </a>
                </div>
                <button
                  type="button"
                  className={`btn btn-ghost login-sheet-proceed${pendingChoice === 'pay' ? ' btn--busy' : ''}`}
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
                      <IPhoneIcon size={15} strokeWidth={2.25} aria-hidden />
                      Try Nimiq Pay again
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="login-sheet-choices">
                {/* Pay primary on mobile */}
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
            )
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

          {/* Pay-miss panel already explains detection failure — avoid duplicate alert. */}
          {error && !(surface === 'mobile' && showOpenInPay) && (
            <p className="login-sheet-status login-sheet-status--error" role="alert">
              {error}
            </p>
          )}
          {!error && walletStatus && (
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
          disabled={connecting || desktopQrOpen}
          onClick={() => {
            if (!connecting && !desktopQrOpen) onClose?.()
          }}
        />
        {panel}
      </div>,
      document.body,
    )
  }

  return panel
}
