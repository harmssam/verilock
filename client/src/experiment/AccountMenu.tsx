import { Check, ChevronDown, Copy, LogOut, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatDisplayAddress } from '../addresses'
import { journeyConnectLabels, type JourneyConnectMode } from './journeyConnectUi'
import type { JourneyAccount } from './types'

interface AccountMenuProps {
  account: JourneyAccount | null
  connecting: boolean
  walletStatus?: string | null
  /** Resolved single-button connect mode (desktop Hub / mobile Pay / fallback). */
  connectMode?: JourneyConnectMode
  onConnect: () => void
  onDisconnect: () => void
}

export function AccountMenu({
  account,
  connecting,
  walletStatus,
  connectMode = 'hub',
  onConnect,
  onDisconnect,
}: AccountMenuProps) {
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
        title={walletStatus ?? undefined}
      >
        <Wallet size={16} strokeWidth={2.25} aria-hidden />
        {connecting
          ? journeyConnectLabels(connectMode).busy
          : journeyConnectLabels(connectMode).idle}
      </button>
    )
  }

  return (
    <div className={`exp-account${open ? ' exp-account--open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="exp-account-trigger"
        aria-expanded={open}
        aria-hasPopup="menu"
        onClick={() => setOpen(v => !v)}
      >
        <span className="exp-account-dot" aria-hidden />
        <span className="exp-account-addr">{account.shortAddress}</span>
        <ChevronDown size={14} strokeWidth={2.5} className="exp-account-chevron" aria-hidden />
      </button>

      {open && (
        <div className="exp-account-menu" role="menu">
          <div className="exp-account-menu-head">
            <span className="exp-account-menu-label">Connected</span>
            <code className="exp-account-menu-full">{formatDisplayAddress(account.address)}</code>
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
