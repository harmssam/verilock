/**
 * Confirm paid on-chain data archive (signatures, initials, text).
 * User-facing copy stays plain; pricing math stays server-side.
 */
import { Database, LoaderCircle, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { formatDataArchiveCredits } from '../dataArchivePricing'
import type { SealDocument } from '../types'

export interface DataArchiveModalProps {
  document: SealDocument | null
  frameCount: number
  credits: number
  balance: number | null
  busy?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
  /** Navigate to pricing when balance is short. */
  onGetCredits?: () => void
}

export function DataArchiveModal({
  document: doc,
  frameCount: _frameCount,
  credits,
  balance,
  busy = false,
  error = null,
  onClose,
  onConfirm,
  onGetCredits,
}: DataArchiveModalProps) {
  const titleId = useId()
  const descId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!doc) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => confirmRef.current?.focus(), 20)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [doc])

  useEffect(() => {
    if (!doc) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, busy, onClose])

  if (!doc) return null

  const shortOnCredits =
    balance != null && Number.isFinite(balance) && balance < credits
  const creditLabel = formatDataArchiveCredits(credits)

  const node = (
    <div className="login-sheet-layer data-archive-layer" role="presentation">
      <button
        type="button"
        className="login-sheet-backdrop data-archive-backdrop"
        aria-label="Dismiss"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        className="data-archive-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <header className="data-archive-head">
          <div className="data-archive-icon" aria-hidden>
            <Database size={22} strokeWidth={2} />
          </div>
          <div className="data-archive-head-text">
            <h2 id={titleId}>Store data forever on the Nimiq blockchain</h2>
            <p className="muted data-archive-subtitle">
              Your fingerprint is already locked. Optionally store signatures,
              initials, and field text permanently on the Nimiq blockchain too.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost data-archive-close"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <div id={descId} className="data-archive-body">
          <p className="data-archive-doc-title">
            <strong>{doc.title}</strong>
          </p>

          <ul className="data-archive-facts">
            <li>
              <span className="data-archive-fact-label">Cost</span>
              <span className="data-archive-fact-value data-archive-fact-value--cost">
                {creditLabel}
              </span>
            </li>
            {balance != null && (
              <li>
                <span className="data-archive-fact-label">Your balance</span>
                <span className="data-archive-fact-value">
                  {formatDataArchiveCredits(balance)}
                </span>
              </li>
            )}
          </ul>

          <p className="muted data-archive-note">
            The PDF never leaves your devices. Only signatures and form fields
            are written to the Nimiq blockchain.
          </p>

          {error && (
            <p className="data-archive-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="data-archive-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onClose}
          >
            Not now
          </button>
          {shortOnCredits && onGetCredits ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={onGetCredits}
            >
              Get credits
            </button>
          ) : (
            <button
              ref={confirmRef}
              type="button"
              className={`btn btn-primary${busy ? ' btn--busy' : ''}`}
              disabled={busy || shortOnCredits}
              onClick={onConfirm}
            >
              {busy ? (
                <>
                  <LoaderCircle
                    className="btn-spinner"
                    size={16}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  Writing to blockchain…
                </>
              ) : (
                <>
                  <Database size={16} strokeWidth={2.25} aria-hidden />
                  Store forever · {creditLabel}
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
