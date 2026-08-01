/**
 * Keyboard shortcut reference modal — opened with ? key.
 */
import { useEffect, useRef } from 'react'
import './ShortcutModal.css'

interface ShortcutModalProps {
  open: boolean
  onClose: () => void
}

interface ShortcutEntry {
  keys: string
  description: string
}

const shortcuts: ShortcutEntry[] = [
  { keys: '?', description: 'Show/hide this shortcut reference' },
  { keys: 'g d', description: 'Go to Dashboard' },
  { keys: 'g i', description: 'Go to Inbox' },
  { keys: 'g s', description: 'Go to Support' },
  { keys: 'g t', description: 'Go to Stats' },
  { keys: 'g c', description: 'Go to Content' },
  { keys: 'g m', description: 'Go to Studio' },
  { keys: 'g e', description: 'Go to Settings' },
  { keys: '⌘ K / Ctrl K', description: 'Open search' },
  { keys: 'Esc', description: 'Close modals / deselect' },
]

export function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

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
      if (open) onClose()
    }
    dialog.addEventListener('close', handleClose)
    return () => dialog.removeEventListener('close', handleClose)
  }, [open, onClose])

  if (!open) return null

  return (
    <dialog ref={dialogRef} className="av2-shortcut-dialog" aria-labelledby="av2-shortcut-title">
      <div className="av2-shortcut-content">
        <div className="av2-shortcut-header">
          <h2 id="av2-shortcut-title" className="av2-shortcut-title">Keyboard Shortcuts</h2>
          <button type="button" className="av2-shortcut-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="av2-shortcut-list">
          {shortcuts.map(s => (
            <div key={s.keys} className="av2-shortcut-row">
              <kbd className="av2-shortcut-keys">{s.keys}</kbd>
              <span className="av2-shortcut-desc">{s.description}</span>
            </div>
          ))}
        </div>
        <p className="av2-shortcut-hint">
          Press <kbd>g</kbd> then a letter key to navigate tabs. Press <kbd>?</kbd> to close.
        </p>
      </div>
    </dialog>
  )
}
