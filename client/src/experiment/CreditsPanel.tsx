import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { Coins, CreditCard, LoaderCircle, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import {
  loadCreditsBalance,
  writeCreditsBalanceCache,
} from '../creditsBalanceCache'
import { formatSealFeeNim } from '../sealPricing'
import { buyCreditsWithNim } from './journeyCreditTopup'

const DEFAULT_PACKS = [10, 25, 50, 100]

interface PackQuote {
  pack: number
  creditNimCostTotal: number
  creditStripeUsdTotal: number
  totalUsdCents: number
  meetsStripeMinimum: boolean
}

interface CreditsPanelProps {
  token: string | null
  address?: string | null
  nimiq?: NimiqProvider | null
  setNimiq?: (p: NimiqProvider | null) => void
  refreshKey?: number
  compact?: boolean
  /** Called when balance changes after a purchase — not on every poll. */
  onBalanceChange?: (balance: number) => void
}

export function CreditsPanel({
  token,
  address = null,
  nimiq = null,
  setNimiq,
  refreshKey = 0,
  compact = false,
  onBalanceChange,
}: CreditsPanelProps) {
  const [enabled, setEnabled] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [balance, setBalance] = useState(0)
  const [packs, setPacks] = useState<number[]>(DEFAULT_PACKS)
  const [selectedPack, setSelectedPack] = useState(10)
  const [packQuotes, setPackQuotes] = useState<PackQuote[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastNotifiedBalance = useRef<number | null>(null)
  const onBalanceChangeRef = useRef(onBalanceChange)
  onBalanceChangeRef.current = onBalanceChange

  const selectedQuote = useMemo(
    () => packQuotes.find(p => p.pack === selectedPack) ?? null,
    [packQuotes, selectedPack],
  )

  const notifyBalance = useCallback((next: number) => {
    if (lastNotifiedBalance.current === next) return
    lastNotifiedBalance.current = next
    onBalanceChangeRef.current?.(next)
  }, [])

  const refresh = useCallback(
    async (force = false) => {
      if (!token) {
        setBalance(0)
        setEnabled(false)
        return
      }
      try {
        const data = await loadCreditsBalance(
          token,
          () => api.creditsBalance(token),
          { force },
        )
        setEnabled(data.enabled)
        setStripeEnabled(data.stripeEnabled)
        setBalance(data.balance)
        if (Array.isArray(data.packs) && data.packs.length > 0) {
          setPacks(data.packs)
          setSelectedPack(prev => (data.packs!.includes(prev) ? prev : data.packs![0]!))
        }
        // Do not notify parent on routine refresh — avoids refreshKey loops.
      } catch {
        // Keep last known UI state (e.g. 429)
      }
    },
    [token],
  )

  useEffect(() => {
    void refresh(refreshKey > 0)
  }, [refresh, refreshKey])

  useEffect(() => {
    const onTopup = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { ok: true; balance: number; creditsMinted: number }
        | { ok: false; message: string }
      if (detail.ok) {
        if (token) writeCreditsBalanceCache(token, detail.balance)
        setBalance(detail.balance)
        notifyBalance(detail.balance)
        setStatus(
          detail.creditsMinted > 0
            ? `Added ${detail.creditsMinted} credit${detail.creditsMinted === 1 ? '' : 's'}.`
            : null,
        )
        setError(null)
      } else {
        setError(detail.message || 'Credit top-up failed')
      }
      setBusy(false)
    }
    window.addEventListener('verilock:credits-topup', onTopup)
    return () => window.removeEventListener('verilock:credits-topup', onTopup)
  }, [notifyBalance, token])

  useEffect(() => {
    if (!token || !enabled) return
    let cancelled = false
    void (async () => {
      try {
        const catalog = await api.creditsPackQuotes()
        if (cancelled) return
        setPackQuotes(
          catalog.packs.map(p => ({
            pack: p.pack,
            creditNimCostTotal: p.creditNimCostTotal,
            creditStripeUsdTotal: p.creditStripeUsdTotal,
            totalUsdCents: p.totalUsdCents,
            meetsStripeMinimum: p.meetsStripeMinimum,
          })),
        )
      } catch {
        if (!cancelled) setPackQuotes([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, token])

  const buyWithNim = async () => {
    if (!token || !address) {
      setError('Connect your wallet first')
      return
    }
    setBusy(true)
    setError(null)
    setStatus(null)
    const result = await buyCreditsWithNim({
      token,
      address,
      credits: selectedPack,
      nimiq,
      setNimiq: setNimiq ?? (() => {}),
      onProgress: setStatus,
    })
    if (result.ok) {
      writeCreditsBalanceCache(token, result.balance)
      setBalance(result.balance)
      notifyBalance(result.balance)
      setStatus(
        result.alreadyClaimed
          ? 'Credits already claimed for that transaction.'
          : `Added ${result.creditsMinted} credit${result.creditsMinted === 1 ? '' : 's'}.`,
      )
      setBusy(false)
      return
    }
    if (result.redirecting) {
      setStatus(result.message)
      return
    }
    setError(result.message)
    setStatus(null)
    setBusy(false)
  }

  const buyWithCard = async () => {
    if (!token) return
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const { url } = await api.creditsCheckout(token, selectedPack)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className={`journey-credits${compact ? ' journey-credits--compact' : ''}`}>
        <div className="journey-credits-head">
          <Coins size={16} strokeWidth={2.25} aria-hidden />
          <span>Seal credits</span>
        </div>
        <p className="muted journey-credits-note" style={{ margin: 0, fontSize: '0.8rem' }}>
          Connect your wallet to buy packs. See{' '}
          <a href="/pricing" className="inline-link">
            Pricing
          </a>
          .
        </p>
      </div>
    )
  }

  if (!enabled) return null

  return (
    <div className={`journey-credits${compact ? ' journey-credits--compact' : ''}`}>
      <div className="journey-credits-head">
        <Coins size={16} strokeWidth={2.25} aria-hidden />
        <span>
          <strong>{balance}</strong> credit{balance === 1 ? '' : 's'}
        </span>
      </div>

      <div className="journey-credits-packs" role="group" aria-label="Credit pack size">
        {packs.map(pack => (
          <button
            key={pack}
            type="button"
            className={`journey-credits-pack${selectedPack === pack ? ' journey-credits-pack--active' : ''}`}
            disabled={busy}
            onClick={() => setSelectedPack(pack)}
          >
            <span className="journey-credits-pack-n">{pack}</span>
            <span className="muted journey-credits-pack-label">credits</span>
          </button>
        ))}
      </div>

      <div className="journey-credits-buy row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`btn btn-primary${busy ? ' btn--busy' : ''}`}
          disabled={busy || !address}
          onClick={() => void buyWithNim()}
          title={!address ? 'Connect wallet first' : undefined}
        >
          {busy ? (
            <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
          ) : (
            <Wallet size={16} strokeWidth={2.25} />
          )}
          Buy {selectedPack} with NIM
        </button>
        {stripeEnabled && (
          <button
            type="button"
            className={`btn btn-secondary${busy ? ' btn--busy' : ''}`}
            disabled={busy}
            onClick={() => void buyWithCard()}
          >
            {busy ? (
              <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
            ) : (
              <CreditCard size={16} strokeWidth={2.25} />
            )}
            Buy {selectedPack} with card
          </button>
        )}
      </div>

      {selectedQuote && (
        <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
          NIM {formatSealFeeNim(selectedQuote.creditNimCostTotal)}
          {stripeEnabled ? ` · Card ≈ $${selectedQuote.creditStripeUsdTotal.toFixed(2)}` : ''}
        </p>
      )}
      {status && (
        <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }} aria-live="polite">
          {status}
        </p>
      )}
      {error && (
        <p className="error" role="alert" style={{ margin: 0, fontSize: '0.85rem' }}>
          {error}
        </p>
      )}
    </div>
  )
}
