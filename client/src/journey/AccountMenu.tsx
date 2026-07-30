import { Check, ChevronDown, Coins, Copy, Files, LogOut, Tag } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatDisplayAddress } from '../addresses'
import { buildNimiqAddressExplorerUrl } from '../explorer'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import {
  journeyLoginEntryLabels,
  journeyLoginNeedsSheet,
  type JourneyConnectMode,
  type JourneyConnectRequest,
} from './journeyConnectUi'
import { LoginSheet } from './LoginSheet'
import type { JourneyAccount } from './types'

interface AccountMenuProps {
  account: JourneyAccount | null
  connecting: boolean
  walletStatus?: string | null
  /** Wallet connect error (shown inside the Login sheet). */
  error?: string | null
  /** Resolved login surface (in-pay / mobile / desktop). */
  connectMode?: JourneyConnectMode
  /** Mobile: Pay deeplink failed — prefer Hub in the sheet. */
  showOpenInPay?: boolean
  /** Seal credit balance when credits are enabled (header chip). */
  creditBalance?: number | null
  /** True when the shell is on Pricing — matches Agreements `lr-nav--active`. */
  creditsActive?: boolean
  onConnect: (options?: JourneyConnectRequest) => void
  /** Desktop Pay QR success. */
  onSession?: (token: string, address: string) => void
  onDisconnect: () => void
  onAgreements?: () => void
  /** Open pricing / buy credits. */
  onCredits?: () => void
}

export function AccountMenu({
  account,
  connecting,
  walletStatus,
  error = null,
  connectMode = 'desktop',
  showOpenInPay = false,
  creditBalance = null,
  creditsActive = false,
  onConnect,
  onSession,
  onDisconnect,
  onAgreements,
  onCredits,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const loginRootRef = useRef<HTMLDivElement>(null)
  const needsSheet = journeyLoginNeedsSheet(connectMode)

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

  // Close login sheet once a session exists
  useEffect(() => {
    if (account) setLoginOpen(false)
  }, [account])

  if (!account) {
    const entry = journeyLoginEntryLabels()
    return (
      <div className="exp-login" ref={loginRootRef}>
        <button
          type="button"
          data-login-trigger
          className={`btn btn-primary exp-connect-btn${connecting ? ' btn--busy' : ''}`}
          onClick={() => {
            if (!needsSheet) {
              // Desktop Hub (and in-Pay native): skip the intermediate modal.
              onConnect()
              return
            }
            setLoginOpen(v => !v)
          }}
          disabled={connecting}
          title={walletStatus ?? 'Login with your Nimiq wallet'}
          aria-expanded={needsSheet ? loginOpen : undefined}
          aria-haspopup={needsSheet ? 'dialog' : undefined}
        >
          <NimiqHexagonIcon size={16} />
          {connecting ? entry.busy : entry.idle}
        </button>
        {needsSheet && (
          <LoginSheet
            open={loginOpen}
            connectMode={connectMode}
            connecting={connecting}
            walletStatus={walletStatus}
            error={error}
            showOpenInPay={showOpenInPay}
            onClose={() => setLoginOpen(false)}
            onProceed={onConnect}
            onSession={onSession}
            placement="popover"
          />
        )}
      </div>
    )
  }

  const showCredits = creditBalance != null && Number.isFinite(creditBalance)

  return (
    <div className="exp-account-cluster">
      {showCredits && (
        <button
          type="button"
          className={`lr-nav lr-nav--credits${creditsActive ? ' lr-nav--active' : ''}`}
          onClick={onCredits}
          title="Lock credits - buy more on Pricing"
          aria-label={`${creditBalance} lock credit${creditBalance === 1 ? '' : 's'}`}
          aria-current={creditsActive ? 'page' : undefined}
        >
          <Coins size={14} strokeWidth={2.25} aria-hidden />
          <span className="lr-nav-credits-n">{creditBalance}</span>
          <span className="lr-nav-credits-label">credits</span>
        </button>
      )}
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
              <a
                className="exp-account-menu-full"
                href={buildNimiqAddressExplorerUrl(account.address)}
                target="_blank"
                rel="noopener noreferrer"
                title={`View ${formatDisplayAddress(account.address)} on Nimiq Watch`}
              >
                {formatDisplayAddress(account.address)}
              </a>
            </div>
            {onCredits && (
              <button
                type="button"
                className="exp-account-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onCredits()
                }}
              >
                {showCredits ? (
                  <Coins size={15} strokeWidth={2.25} />
                ) : (
                  <Tag size={15} strokeWidth={2.25} />
                )}
                {showCredits
                  ? `${creditBalance} credit${creditBalance === 1 ? '' : 's'} - buy more`
                  : 'Pricing'}
              </button>
            )}
            {onAgreements && (
              <button
                type="button"
                className="exp-account-item"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onAgreements()
                }}
              >
                <Files size={15} strokeWidth={2.25} />
                My agreements
              </button>
            )}
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
    </div>
  )
}
