/**
 * "Save to your wallet" - the claim UI from `docs/guest-signing-plan.md` Task 6.
 * Binds a Nimiq wallet as the owner of a guest-created agreement so it can be
 * managed under My agreements and locked with credits. Does not rewrite any
 * signatures already made as a guest - they stay attributed the way they were
 * signed.
 *
 * Two sub-flows, both driven by the parent (`DocumentJourney.tsx`):
 * - No wallet connected yet: shows the same `LoginSheet` used inline elsewhere
 *   in the journey, `placement="inline"`.
 * - Wallet connected + a live guest creator session matches this document:
 *   a one-line confirm (no key prompt - the session already proves ownership).
 * - Wallet connected, no matching guest session (new device/browser, or the
 *   session expired): a document key input.
 */
import { LoaderCircle, Wallet, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import type { JourneyConnectMode, JourneyConnectRequest } from './journeyConnectUi'
import { LoginSheet } from './LoginSheet'
import type { JourneyAccount } from './types'

export interface ClaimAgreementModalProps {
  open: boolean
  documentTitle?: string
  /** Wallet already connected (in-memory session, this render). */
  account: JourneyAccount | null
  /** A live guest CREATOR session exists for this exact document. */
  hasGuestSession: boolean
  documentKeyInput: string
  onDocumentKeyInputChange: (value: string) => void
  busy: boolean
  error: string | null
  onClose: () => void
  onClaim: () => void
  /** LoginSheet passthrough - identical prop shapes to other inline usages in DocumentJourney.tsx. */
  connectMode: JourneyConnectMode
  connecting: boolean
  walletStatus?: string | null
  walletError?: string | null
  showOpenInPay?: boolean
  loginNeedsSheet: boolean
  loginSheetOpen: boolean
  onRequestLogin: () => void
  onCloseLoginSheet: () => void
  onProceedLogin: (options?: JourneyConnectRequest) => void
  onSession: (token: string, address: string) => void
}

export function ClaimAgreementModal({
  open,
  documentTitle,
  account,
  hasGuestSession,
  documentKeyInput,
  onDocumentKeyInputChange,
  busy,
  error,
  onClose,
  onClaim,
  connectMode,
  connecting,
  walletStatus,
  walletError,
  showOpenInPay,
  loginNeedsSheet,
  loginSheetOpen,
  onRequestLogin,
  onCloseLoginSheet,
  onProceedLogin,
  onSession,
}: ClaimAgreementModalProps) {
  const titleId = useId()
  const descId = useId()
  const keyInputId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => confirmRef.current?.focus(), 20)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const canSubmit = Boolean(account) && (hasGuestSession || documentKeyInput.trim().length > 0)

  const node = (
    <div className="login-sheet-layer claim-agreement-layer" role="presentation">
      <button
        type="button"
        className="login-sheet-backdrop claim-agreement-backdrop"
        aria-label="Dismiss"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        className="claim-agreement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <header className="claim-agreement-head">
          <div className="claim-agreement-icon" aria-hidden>
            <Wallet size={20} strokeWidth={2.25} />
          </div>
          <div className="claim-agreement-head-text">
            <h2 id={titleId} className="claim-agreement-title">
              Save to your wallet
            </h2>
            <p id={descId} className="muted claim-agreement-lead">
              {documentTitle
                ? `Connect a Nimiq wallet to manage and lock "${documentTitle}" going forward.`
                : 'Connect a Nimiq wallet to manage and lock this agreement going forward.'}
            </p>
          </div>
          <button
            type="button"
            className="claim-agreement-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <p className="muted claim-agreement-honesty">
          This does not change anything already signed - existing signatures stay attributed
          the way they were made. It only adds wallet-based ownership so this agreement shows
          up under My agreements and can be locked on-chain with credits.
        </p>

        {!account ? (
          loginNeedsSheet && loginSheetOpen ? (
            <LoginSheet
              open
              connectMode={connectMode}
              connecting={connecting}
              walletStatus={walletStatus}
              error={walletError}
              showOpenInPay={showOpenInPay}
              onClose={onCloseLoginSheet}
              onProceed={onProceedLogin}
              onSession={onSession}
              placement="inline"
            />
          ) : (
            <button
              type="button"
              className={`btn btn-primary claim-agreement-connect${connecting ? ' btn--busy' : ''}`}
              disabled={connecting}
              onClick={onRequestLogin}
            >
              {connecting ? (
                <>
                  <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                  Connecting…
                </>
              ) : (
                <>
                  <NimiqHexagonIcon size={16} />
                  Connect Nimiq wallet
                </>
              )}
            </button>
          )
        ) : hasGuestSession ? (
          <div className="claim-agreement-body">
            <p className="claim-agreement-connected">
              Connected as <strong>{account.shortAddress}</strong>
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Save this agreement to this wallet? This is a one-way action - once saved, this
              wallet is the agreement's owner going forward.
            </p>
          </div>
        ) : (
          <div className="claim-agreement-body">
            <p className="claim-agreement-connected">
              Connected as <strong>{account.shortAddress}</strong>
            </p>
            <label className="claim-agreement-key-label" htmlFor={keyInputId}>
              Document key
            </label>
            <input
              id={keyInputId}
              type="text"
              className="claim-agreement-input mono"
              value={documentKeyInput}
              onChange={e => onDocumentKeyInputChange(e.target.value)}
              placeholder="Paste your document key"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="muted claim-agreement-key-hint">
              No saved session for this agreement on this browser. Enter the document key you
              saved when it was created.
            </p>
          </div>
        )}

        {error && (
          <p className="claim-agreement-error" role="alert">
            {error}
          </p>
        )}

        {account && (
          <div className="claim-agreement-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Not now
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={`btn btn-primary claim-agreement-confirm${busy ? ' btn--busy' : ''}`}
              onClick={onClaim}
              disabled={busy || !canSubmit}
              aria-busy={busy}
            >
              {busy ? (
                <>
                  <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                  Saving…
                </>
              ) : (
                <>
                  <Wallet size={16} strokeWidth={2.25} aria-hidden />
                  {hasGuestSession ? 'Save to wallet' : 'Claim agreement'}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
