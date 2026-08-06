/**
 * "Save your document key" - shown exactly once, right after a guest create
 * succeeds (`docs/guest-signing-plan.md` Task 3). The raw key never comes
 * back from the server after this moment, so this modal cannot be dismissed
 * without the user acknowledging they saved it - no backdrop click-to-close,
 * no visible X button (unlike the other journey modals in this file's
 * family, e.g. `CancelAgreementModal` / `DataArchiveModal`).
 */
import { Check, Copy, Download, KeyRound } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadBlob } from '../shareInvite'

export interface GuestDocumentKeyModalProps {
  /** Raw document key, or `null` when the modal is closed. */
  documentKey: string | null
  savedAck: boolean
  onSavedAckChange: (checked: boolean) => void
  /** Document title/slug used only to name the downloaded .txt file. */
  documentTitle?: string
  onContinue: () => void
}

export function GuestDocumentKeyModal({
  documentKey,
  savedAck,
  onSavedAckChange,
  documentTitle,
  onContinue,
}: GuestDocumentKeyModalProps) {
  const titleId = useId()
  const descId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!documentKey) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [documentKey])

  // Deliberately no Escape-to-close listener - the key is gone forever once
  // this modal closes, so closing must go through the explicit Continue button.

  if (!documentKey) return null

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(documentKey)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      inputRef.current?.select()
    }
  }

  const downloadKey = () => {
    const safeName = (documentTitle || 'agreement')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
    const blob = new Blob(
      [
        `VeriLock document key\n\n${documentKey}\n\nKeep this safe - it is the only way to get back into "${
          documentTitle || 'this agreement'
        }" without a Nimiq wallet. VeriLock cannot recover it for you.\n`,
      ],
      { type: 'text/plain' },
    )
    downloadBlob(blob, `verilock-document-key-${safeName || 'agreement'}.txt`)
  }

  const node = (
    <div className="login-sheet-layer guest-key-modal-layer" role="presentation">
      <div className="login-sheet-backdrop guest-key-modal-backdrop" />
      <div
        className="guest-key-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <header className="guest-key-modal-head">
          <div className="guest-key-modal-icon" aria-hidden>
            <KeyRound size={22} strokeWidth={2} />
          </div>
          <div className="guest-key-modal-head-text">
            <h2 id={titleId}>Save your document key</h2>
          </div>
        </header>

        <p id={descId} className="muted guest-key-modal-body">
          This is <strong>not</strong> a Nimiq wallet key, and it does not encrypt your PDF. It
          proves you are the organizer of this agreement. You will need it to get back in from a
          new device or browser, or if you clear this one.
        </p>

        <div className="guest-key-modal-key-row">
          <input
            ref={inputRef}
            type="text"
            readOnly
            value={documentKey}
            className="guest-key-modal-input mono"
            onFocus={e => e.currentTarget.select()}
            aria-label="Document key"
          />
          <button type="button" className="btn btn-secondary" onClick={() => void copyKey()}>
            {copied ? (
              <>
                <Check size={16} strokeWidth={2.25} aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy size={16} strokeWidth={2.25} aria-hidden />
                Copy
              </>
            )}
          </button>
        </div>

        <button type="button" className="btn btn-ghost guest-key-modal-download" onClick={downloadKey}>
          <Download size={15} strokeWidth={2.25} aria-hidden />
          Download as .txt
        </button>

        <footer className="guest-key-modal-footer">
          <label className="guest-key-modal-ack">
            <input
              type="checkbox"
              checked={savedAck}
              onChange={e => onSavedAckChange(e.target.checked)}
            />
            <span>I saved my document key</span>
          </label>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!savedAck}
            onClick={onContinue}
          >
            Continue
          </button>
        </footer>
      </div>
    </div>
  )

  return createPortal(node, document.body)
}
