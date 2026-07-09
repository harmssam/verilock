import { Check, ChevronDown, Copy, LogOut, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DemoAccount } from './types'

interface AccountMenuProps {
  account: DemoAccount | null
  connecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function AccountMenu({ account, connecting, onConnect, onDisconnect }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!account) {
    return (
      <button
        type="button"
        className={`btn btn-primary exp-connect-btn${connecting ? ' btn--busy' : ''}`}
        onClick={onConnect}
        disabled={connecting}
      >
        <Wallet size={16} strokeWidth={2.25} aria-hidden />
        {connecting ? 'Connecting…' : 'Connect wallet'}
      </button>
    )
  }

  return (
    <div className={`exp-account${open ? ' exp-account--open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="exp-account-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(v => !v)}
      >
        <span className="exp-account-dot" aria-hidden />
        <span className="exp-account-addr">{account.shortAddress}</span>
        <ChevronDown size={14} strokeWidth={2.5} className="exp-account-chevron" aria-hidden />
      </button>

      {open && (
        <div className="exp-account-menu" role="menu">
          <div className="exp-account-menu-head">
            <span className="exp-account-menu-label">Connected (demo)</span>
            <code className="exp-account-menu-full">{account.address}</code>
          </div>
          <button
            type="button"
            className="exp-account-item"
            role="menuitem"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(account.address)
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              } catch {
                /* ignore */
              }
            }}
          >
            {copied ? <Check size={15} strokeWidth={2.5} /> : <Copy size={15} strokeWidth={2.25} />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            type="button"
            className="exp-account-item exp-account-item--danger"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onDisconnect()
            }}
          >
            <LogOut size={15} strokeWidth={2.25} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
