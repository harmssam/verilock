/**
 * Confirm + progress for paid on-chain data archive (signatures, initials, text).
 */
import { Database, Mail, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDataArchiveCredits } from '../dataArchivePricing'
import { FEATURES } from '../features'
import type { SealDocument } from '../types'
import { DataArchiveProgress } from './DataArchiveProgress'

export interface DataArchiveModalProps {
  document: SealDocument | null
  frameCount: number
  credits: number
  balance: number | null
  busy?: boolean
  /** API finished successfully (on-chain). */
  done?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: (options?: { notifyEmail?: string | null }) => void
  /** Navigate to pricing when balance is short. */
  onGetCredits?: () => void
  /** True when Resend can send completion mail (from /api/features). */
  emailNotifyAvailable?: boolean
}

export function DataArchiveModal({
  document: doc,
  frameCount,
  credits,
  balance,
  busy = false,
  done = false,
  error = null,
  onClose,
  onConfirm,
  onGetCredits,
  emailNotifyAvailable = false,
}: DataArchiveModalProps) {
  const titleId = useId()
  const descId = useId()
  const emailId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [wantEmail, setWantEmail] = useState(false)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)

  const showProgress = busy || done
  const showEmailUi = FEATURES.emailNotifyUi && emailNotifyAvailable

  useEffect(() => {
    if (!doc) return
    // Reset email UI when opening a new document
    setWantEmail(false)
    setEmail('')
    setEmailError(null)
  }, [doc?.id])

  useEffect(() => {
    if (!doc) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => {
      if (!showProgress) confirmRef.current?.focus()
    }, 20)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [doc, showProgress])

  useEffect(() => {
    if (!doc) return
    const onKey = (e: KeyboardEvent) => {
      // Allow Escape anytime — work continues on the server if already busy.
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, onClose])

  if (!doc) return null

  const shortOnCredits =
    balance != null && Number.isFinite(balance) && balance < credits
  const creditLabel = formatDataArchiveCredits(credits)

  const handleConfirm = () => {
    setEmailError(null)
    if (wantEmail && showEmailUi) {
      const cleaned = email.trim().toLowerCase()
      if (!cleaned || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
        setEmailError('Enter a valid email address')
        return
      }
      onConfirm({ notifyEmail: cleaned })
      return
    }
    onConfirm({ notifyEmail: null })
  }

  const node = (
    <div className="login-sheet-layer data-archive-layer" role="presentation">
      <button
        type="button"
        className="login-sheet-backdrop data-archive-backdrop"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        className={`data-archive-modal${showProgress ? ' data-archive-modal--progress' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        {!showProgress && (
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
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} strokeWidth={2.25} aria-hidden />
            </button>
          </header>
        )}

        {showProgress ? (
          <div id={descId} className="data-archive-progress-wrap">
            <button
              type="button"
              className="btn btn-ghost data-archive-close data-archive-close--progress"
              onClick={onClose}
              aria-label={busy ? 'Close and continue in background' : 'Close'}
            >
              <X size={18} strokeWidth={2.25} aria-hidden />
            </button>
            <DataArchiveProgress
              title={doc.title}
              credits={credits}
              frameCount={frameCount}
              done={done}
              notifyEmail={wantEmail && email.trim() ? email.trim().toLowerCase() : null}
              message={
                done
                  ? 'Stored forever on the Nimiq blockchain.'
                  : error
                    ? error
                    : null
              }
            />
            {error && !done && (
              <p className="data-archive-error" role="alert">
                {error}
              </p>
            )}
            <div className="data-archive-actions data-archive-actions--progress">
              {done ? (
                <button type="button" className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  Continue in background
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div id={descId} className="data-archive-body">
              <p className="data-archive-doc-title">
                <strong>{doc.title}</strong>
              </p>

              <ul className="data-archive-facts">
                <li>
                  <span className="data-archive-fact-label">Cost</span>
                  <span className="data-archive-fact-value data-archive-fact-value--cost">
                    {credits <= 0 ? 'Already paid — free resume' : creditLabel}
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
                are written to the Nimiq blockchain. You do not need to wait on
                this screen once it starts.
              </p>

              {showEmailUi && (
                <div className="data-archive-email">
                  <label className="data-archive-email-check">
                    <input
                      type="checkbox"
                      checked={wantEmail}
                      onChange={e => {
                        setWantEmail(e.target.checked)
                        setEmailError(null)
                      }}
                    />
                    <span>
                      <Mail size={15} strokeWidth={2.25} aria-hidden />
                      Email me when storage finishes
                    </span>
                  </label>
                  {wantEmail && (
                    <>
                      <label htmlFor={emailId} className="visually-hidden">
                        Email address
                      </label>
                      <input
                        id={emailId}
                        type="email"
                        className="data-archive-email-input"
                        placeholder="you@example.com"
                        autoComplete="email"
                        value={email}
                        onChange={e => {
                          setEmail(e.target.value)
                          setEmailError(null)
                        }}
                        aria-invalid={emailError ? true : undefined}
                      />
                      {emailError && (
                        <p className="data-archive-error" role="alert">
                          {emailError}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {error && (
                <p className="data-archive-error" role="alert">
                  {error}
                </p>
              )}
            </div>

            <footer className="data-archive-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Not now
              </button>
              {shortOnCredits && onGetCredits ? (
                <button type="button" className="btn btn-primary" onClick={onGetCredits}>
                  Get credits
                </button>
              ) : (
                <button
                  ref={confirmRef}
                  type="button"
                  className="btn btn-primary"
                  disabled={shortOnCredits}
                  onClick={handleConfirm}
                >
                  <Database size={16} strokeWidth={2.25} aria-hidden />
                  {credits <= 0
                    ? 'Resume storage (free)'
                    : `Store forever · ${creditLabel}`}
                </button>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
