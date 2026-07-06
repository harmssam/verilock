import { LogOut } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { shortAddress } from './addresses'
import './WalletMenu.css'

interface WalletMenuProps {
  address: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSignOut: () => void
}

export function WalletMenu({ address, open, onToggle, onClose, onSignOut }: WalletMenuProps) {
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onClose()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  return (
    <div className="wallet-menu" ref={rootRef}>
      <button
        type="button"
        className={`wallet-pill wallet-menu-trigger${open ? ' wallet-menu-trigger--open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={menuId}
      >
        {shortAddress(address)}
      </button>
      {open && (
        <div className="wallet-menu-dropdown" id={menuId} role="menu">
          <p className="wallet-menu-label">Connected wallet</p>
          <p className="wallet-menu-address" title={address}>
            {address}
          </p>
          <button
            type="button"
            className="wallet-menu-signout"
            role="menuitem"
            onClick={() => {
              onClose()
              onSignOut()
            }}
          >
            <LogOut size={15} strokeWidth={2.25} aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}