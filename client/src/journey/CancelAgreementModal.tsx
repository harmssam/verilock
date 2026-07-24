/**
 * Confirm cancel (draft) or purge server copy (fully on-chain backed-up).
 * Portaled dialog — replaces native window.confirm.
 */
import { AlertTriangle, Database, LoaderCircle, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { shortHash } from '../pdf/hashPdf'
import { documentTypeLabel, type SealDocument } from '../types'

export type CancelAgreementMode = 'cancel' | 'purge'

export interface CancelAgreementModalProps {
  document: SealDocument | null
  /** cancel = draft before signatures; purge = remove VeriLock metadata after on-chain backup */
  mode?: CancelAgreementMode
  busy?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
}

export function CancelAgreementModal({
  document: doc,
  mode = 'cancel',
  busy = false,
  error = null,
  onClose,
  onConfirm,
}: CancelAgreementModalProps) {
  const titleId = useId()
  const descId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!doc) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus primary destructive action so keyboard users see the risk immediately.
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

  const isPurge = mode === 'purge'
  const filename = doc.originalFilename?.trim() || null
  const hashPreview = shortHash(doc.originalSha256)

  const node = (
    <div className="login-sheet-layer cancel-agreement-layer" role="presentation">
      <button
        type="button"
        className="login-sheet-backdrop cancel-agreement-backdrop"
        aria-label="Dismiss"
        disabled={busy}
        onClick={() => {
          if (!busy) onClose()
        }}
      />
      <div
        ref={panelRef}
        className={`cancel-agreement-modal${isPurge ? ' cancel-agreement-modal--purge' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <header className="cancel-agreement-head">
          <div
            className={`cancel-agreement-icon${isPurge ? ' cancel-agreement-icon--purge' : ''}`}
            aria-hidden
          >
            {isPurge ? (
              <Database size={20} strokeWidth={2.25} />
            ) : (
              <AlertTriangle size={20} strokeWidth={2.25} />
            )}
          </div>
          <div className="cancel-agreement-head-text">
            <h2 id={titleId} className="cancel-agreement-title">
              {isPurge ? 'Remove from VeriLock?' : 'Cancel this agreement?'}
            </h2>
            <p id={descId} className="muted cancel-agreement-lead">
              {isPurge
                ? 'Deletes VeriLock’s server copy of this agreement. Your fingerprint and stored data stay permanently on the Nimiq blockchain.'
                : 'This permanently removes the draft from VeriLock. Only possible before anyone signs.'}
            </p>
          </div>
          <button
            type="button"
            className="cancel-agreement-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <div className="cancel-agreement-card">
          <div className="cancel-agreement-card-row">
            <strong className="cancel-agreement-doc-title">{doc.title}</strong>
            <span className="cancel-agreement-type">{documentTypeLabel(doc.type)}</span>
          </div>
          {filename && (
            <p className="muted cancel-agreement-filename">
              File <span className="cancel-agreement-filename-value">{filename}</span>
            </p>
          )}
          <p className="muted cancel-agreement-meta">
            Fingerprint <code className="mono">{hashPreview}</code>
            {doc.signingProgress.required > 0 ? (
              <>
                {' · '}
                {doc.signingProgress.signed}/{doc.signingProgress.required} signed
              </>
            ) : null}
          </p>
        </div>

        <ul className="cancel-agreement-bullets">
          {isPurge ? (
            <>
              <li>On-chain fingerprint lock remains public on Nimiq.</li>
              <li>On-chain signatures and field data (if stored) remain on Nimiq.</li>
              <li>VeriLock list entry, invites, and server metadata are removed.</li>
              <li>Your local PDF is not deleted — only our app record.</li>
            </>
          ) : (
            <>
              <li>Co-signer invite links for this draft will stop working.</li>
              <li>Your local document file is not deleted — only the VeriLock record.</li>
              <li>This cannot be undone.</li>
            </>
          )}
        </ul>

        {error && (
          <p className="cancel-agreement-error" role="alert">
            {error}
          </p>
        )}

        <div className="cancel-agreement-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {isPurge ? 'Keep on VeriLock' : 'Keep agreement'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`btn btn-danger cancel-agreement-confirm${busy ? ' btn--busy' : ''}`}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                {isPurge ? 'Removing…' : 'Cancelling…'}
              </>
            ) : (
              <>
                <Trash2 size={16} strokeWidth={2.25} aria-hidden />
                {isPurge ? 'Remove from VeriLock' : 'Yes, cancel agreement'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
