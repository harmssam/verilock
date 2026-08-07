/**
 * Confirm "Clear this device" - removes this browser's guest access to
 * agreements without deleting anything from VeriLock. Portaled dialog,
 * same pattern as CancelAgreementModal.
 */
import { LogOut, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ClearDeviceModalProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}

export function ClearDeviceModal({ open, onClose, onConfirm }: ClearDeviceModalProps) {
  const titleId = useId()
  const descId = useId()
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
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const node = (
    <div className="login-sheet-layer cancel-agreement-layer" role="presentation">
      <button
        type="button"
        className="login-sheet-backdrop cancel-agreement-backdrop"
        aria-label="Dismiss"
        onClick={onClose}
      />
      <div
        className="cancel-agreement-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <header className="cancel-agreement-head">
          <div className="cancel-agreement-icon cancel-agreement-icon--neutral" aria-hidden>
            <LogOut size={20} strokeWidth={2.25} />
          </div>
          <div className="cancel-agreement-head-text">
            <h2 id={titleId} className="cancel-agreement-title">
              Clear this device?
            </h2>
            <p id={descId} className="muted cancel-agreement-lead">
              Removes this agreement’s access from this browser. Nothing is deleted from VeriLock.
            </p>
          </div>
          <button
            type="button"
            className="cancel-agreement-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        </header>

        <ul className="cancel-agreement-bullets cancel-agreement-bullets--neutral">
          <li>
            The agreement stays on VeriLock — anyone with the document key or an invite link can
            still reach it.
          </li>
          <li>Use this on shared or public computers so the agreement isn’t left behind.</li>
          <li>Keep your document key if you may want to get back in later.</li>
          <li>Wallet logins on this browser are not affected.</li>
        </ul>

        <div className="cancel-agreement-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Keep access
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
          >
            <LogOut size={16} strokeWidth={2.25} aria-hidden />
            Clear this device
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
