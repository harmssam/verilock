import { ExternalLink, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { NIMIQ_PAY_ANDROID_URL, NIMIQ_PAY_IOS_URL } from '../nimiq'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import {
  journeyConnectLabels,
  journeyLoginSheetCopy,
  type JourneyConnectMode,
} from './journeyConnectUi'

interface LoginSheetProps {
  open: boolean
  connectMode: JourneyConnectMode
  connecting: boolean
  /** Optional status line under the proceed button */
  walletStatus?: string | null
  onClose?: () => void
  onProceed: () => void
  /** Anchor under a header Login button vs full-width in a page card */
  placement?: 'popover' | 'inline'
  /** Hide the X control (e.g. forced open on the connect step). */
  showClose?: boolean
}

/**
 * Explains Nimiq + how to connect, then runs the real wallet connect on proceed.
 * Entry points should use a short “Login” label; this sheet carries the long copy.
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
  const canClose = showClose ?? placement === 'popover'

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

  if (!open) return null

  const showPayStores = connectMode === 'pay-open' || connectMode === 'hub-fallback'

  return (
    <div
      ref={panelRef}
      className={`login-sheet login-sheet--${placement}`}
      role="dialog"
      aria-modal={placement === 'popover' ? true : undefined}
      aria-labelledby={titleId}
    >
      <header className="login-sheet-head">
        <div className="login-sheet-title-row">
          <NimiqHexagonIcon size={22} className="login-sheet-mark" />
          <div>
            <p className="login-sheet-kicker">Nimiq wallet</p>
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

      <ol className="login-sheet-steps">
        {copy.steps.map(step => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <button
        type="button"
        className={`btn btn-primary login-sheet-proceed${connecting ? ' btn--busy' : ''}`}
        onClick={onProceed}
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

      {walletStatus && (
        <p className="login-sheet-status" role="status">
          {walletStatus}
        </p>
      )}

      {showPayStores && (
        <div className="login-sheet-stores">
          <p className="muted login-sheet-stores-label">Need Nimiq Pay?</p>
          <div className="login-sheet-store-row">
            <a className="btn btn-secondary" href={NIMIQ_PAY_IOS_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={14} strokeWidth={2.25} aria-hidden />
              App Store
            </a>
            <a
              className="btn btn-secondary"
              href={NIMIQ_PAY_ANDROID_URL}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} strokeWidth={2.25} aria-hidden />
              Google Play
            </a>
          </div>
        </div>
      )}

      <p className="login-sheet-foot muted">
        VeriLock never holds your keys. Login only proves which Nimiq address you control.
      </p>
    </div>
  )
}
