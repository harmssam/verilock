import { LogOut } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { formatDisplayAddress, shortAddress } from './addresses'
import { buildNimiqAddressExplorerUrl } from './explorer'
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
          <a
            className="wallet-menu-address"
            href={buildNimiqAddressExplorerUrl(address)}
            target="_blank"
            rel="noopener noreferrer"
            title={`View ${formatDisplayAddress(address)} on Nimiq`}
            onClick={onClose}
          >
            {formatDisplayAddress(address)}
          </a>
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