import { ExternalLink, LoaderCircle, Smartphone, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NIMIQ_PAY_ANDROID_URL, NIMIQ_PAY_IOS_URL } from '../nimiq'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import {
  journeyConnectLabels,
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
   * Start connect. Pass `{ useRedirect: true }` for Hub in browser,
   * `{ useRedirect: false }` (or `{}`) for Nimiq Pay deeplink on mobile.
   */
  onProceed: (options?: JourneyConnectRequest) => void
  /** Anchor under a header Login button vs full-width in a page card */
  placement?: 'popover' | 'inline'
  /** Hide the X control (e.g. forced open on the connect step). */
  showClose?: boolean
}

/**
 * Explains Nimiq + how to connect, then runs the real wallet connect on proceed.
 *
 * Mobile (`pay-open` / `hub-fallback`): dual choice — Nimiq Pay app or Hub in browser.
 * Desktop Hub path usually skips this sheet entirely (see AccountMenu / login gates).
 */
export function LoginSheet({
  open,
  connectMode,
  connecting,
  walletStatus,
  onClose,
  onProceed,
  placement = 'popover',
  showClose,
}: LoginSheetProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const copy = journeyLoginSheetCopy(connectMode)
  const labels = journeyConnectLabels(connectMode)
  const mobileChoice = journeyMobileChoiceLabels()
  const canClose = showClose ?? placement === 'popover'
  const isMobileChoice = connectMode === 'pay-open' || connectMode === 'hub-fallback'
  /** After Pay deeplink fails, prefer Hub as the primary action. */
  const hubPreferred = connectMode === 'hub-fallback'
  const [pendingChoice, setPendingChoice] = useState<'pay' | 'hub' | null>(null)

  useEffect(() => {
    if (!connecting) setPendingChoice(null)
  }, [connecting])

  useEffect(() => {
    if (!open || !canClose || !onClose) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !connecting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, connecting, onClose, canClose])

  useEffect(() => {
    if (!open || placement !== 'popover' || !onClose) return
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      // Ignore clicks on the Login trigger (parent handles toggle)
      const t = e.target as HTMLElement | null
      if (t?.closest?.('[data-login-trigger]')) return
      if (!connecting) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, placement, connecting, onClose])

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
      className={`login-sheet login-sheet--${placement}${isMobileChoice ? ' login-sheet--choice' : ''}`}
      role="dialog"
      aria-modal={placement === 'popover' ? true : undefined}
      aria-labelledby={titleId}
    >
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
            disabled={connecting}
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

      {isMobileChoice ? (
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
                  <Smartphone size={16} strokeWidth={2.25} aria-hidden />
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
    </div>
  )

  // Portal popovers to body so header `backdrop-filter` / sticky stacking
  // does not trap `position: fixed` and push the dialog off-screen on mobile.
  if (placement === 'popover') {
    return createPortal(
      <div className="login-sheet-layer">
        <button
          type="button"
          className="login-sheet-backdrop"
          aria-label="Dismiss login"
          disabled={connecting}
          onClick={() => {
            if (!connecting) onClose?.()
          }}
        />
        {panel}
      </div>,
      document.body,
    )
  }

  return panel
}
