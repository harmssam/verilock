/**
 * Branded confirmation modal. Use instead of window.confirm().
 */
import { useEffect, useRef } from 'react'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleClose = () => {
      // If dialog was closed via Esc, treat as cancel
      if (open) onCancel()
    }

    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [open, onCancel])

  // Auto-focus confirm button when opened
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        confirmBtnRef.current?.focus()
      })
    }
  }, [open])

  if (!open) return null

  return (
    <dialog ref={dialogRef} className="av2-dialog" aria-labelledby="av2-dialog-title">
      <div className="av2-dialog-content">
        <h2 id="av2-dialog-title" className="av2-dialog-title">{title}</h2>
        <p className="av2-dialog-message">{message}</p>
        <div className="av2-dialog-actions">
          <button
            type="button"
            className="av2-btn av2-btn-ghost"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`av2-btn${destructive ? ' av2-btn-danger' : ' av2-btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
