import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { Coins, CreditCard, LoaderCircle, Wallet } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { formatSealFeeNim } from '../sealPricing'
import { buyCreditsWithNim } from './journeyCreditTopup'

interface CreditsPanelProps {
  token: string | null
  address?: string | null
  nimiq?: NimiqProvider | null
  setNimiq?: (p: NimiqProvider | null) => void
  /** Bump to force a refresh (e.g. after seal). */
  refreshKey?: number
  compact?: boolean
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
  const [qty, setQty] = useState(1)
  const [quoteLabel, setQuoteLabel] = useState<string | null>(null)
  const [nimCostLabel, setNimCostLabel] = useState<string | null>(null)
  const [markup, setMarkup] = useState(2)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [maxCheckout, setMaxCheckout] = useState(20)
  const [maxNimTopup, setMaxNimTopup] = useState(50)

  const refresh = useCallback(async () => {
    if (!token) {
      setBalance(0)
      setEnabled(false)
      return
    }
    try {
      const data = await api.creditsBalance(token)
      setEnabled(data.enabled)
      setStripeEnabled(data.stripeEnabled)
      setBalance(data.balance)
      setMarkup(data.stripeMarkup)
      setMaxCheckout(data.maxPerCheckout)
      if (typeof (data as { maxPerNimTopup?: number }).maxPerNimTopup === 'number') {
        setMaxNimTopup((data as { maxPerNimTopup: number }).maxPerNimTopup)
      }
      onBalanceChange?.(data.balance)
    } catch {
      setEnabled(false)
    }
  }, [token, onBalanceChange])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  // Hub redirect return for credit top-up
  useEffect(() => {
    const onTopup = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as
        | { ok: true; balance: number; creditsMinted: number }
        | { ok: false; message: string }
      if (detail.ok) {
        setBalance(detail.balance)
        onBalanceChange?.(detail.balance)
        setStatus(`Added ${detail.creditsMinted} credit${detail.creditsMinted === 1 ? '' : 's'}.`)
        setError(null)
        void refresh()
      } else {
        setError(detail.message || 'Credit top-up failed')
      }
      setBusy(false)
    }
    window.addEventListener('verilock:credits-topup', onTopup)
    return () => window.removeEventListener('verilock:credits-topup', onTopup)
  }, [onBalanceChange, refresh])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void (async () => {
      try {
        const q = await api.creditsQuote(qty)
        if (cancelled) return
        setNimCostLabel(
          `${formatSealFeeNim(q.creditNimCostTotal)} NIM (${formatSealFeeNim(q.creditNimCost)} each)`,
        )
        setQuoteLabel(
          `≈ $${q.creditStripeUsdTotal.toFixed(2)} USD (${q.stripeMarkup}× NIM market)`,
        )
        setStripeEnabled(q.stripeEnabled)
      } catch {
        if (!cancelled) {
          setQuoteLabel(null)
          setNimCostLabel(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, qty])

  const maxQty = Math.max(1, Math.min(maxCheckout, maxNimTopup))

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
      credits: qty,
      nimiq,
      setNimiq: setNimiq ?? (() => {}),
      onProgress: setStatus,
    })
    if (result.ok) {
      setBalance(result.balance)
      onBalanceChange?.(result.balance)
      setStatus(
        result.alreadyClaimed
          ? 'Credits already claimed for that transaction.'
          : `Added ${result.creditsMinted} credit${result.creditsMinted === 1 ? '' : 's'}.`,
      )
      setBusy(false)
      void refresh()
      return
    }
    if (result.redirecting) {
      setStatus(result.message)
      // Leave busy — page navigates to Hub
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
      const { url } = await api.creditsCheckout(token, qty)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(false)
    }
  }

  if (!token || !enabled) return null

  return (
    <div className={`journey-credits${compact ? ' journey-credits--compact' : ''}`}>
      <div className="journey-credits-head">
        <Coins size={16} strokeWidth={2.25} aria-hidden />
        <span>
          <strong>{balance}</strong> seal credit{balance === 1 ? '' : 's'}
        </span>
      </div>
      <p className="muted journey-credits-note" style={{ margin: 0, fontSize: '0.8rem' }}>
        1 credit = 1 seal. Buy with NIM at the seal price (best rate), or card at {markup}× live
        NIM market. Credits never convert back to NIM.
      </p>

      <div className="journey-credits-buy row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <label className="muted" style={{ fontSize: '0.85rem' }}>
          Qty{' '}
          <input
            type="number"
            min={1}
            max={maxQty}
            value={qty}
            disabled={busy}
            onChange={e => setQty(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))}
            style={{ width: '4rem' }}
          />
        </label>
        <button
          type="button"
          className={`btn btn-primary${busy ? ' btn--busy' : ''}`}
          disabled={busy || !address}
          onClick={() => void buyWithNim()}
          title={!address ? 'Connect wallet first' : nimCostLabel ?? undefined}
        >
          {busy ? (
            <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
          ) : (
            <Wallet size={16} strokeWidth={2.25} />
          )}
          Buy with NIM
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
            Buy with card
          </button>
        )}
      </div>

      {nimCostLabel && (
        <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
          NIM: {nimCostLabel} → {qty} credit{qty === 1 ? '' : 's'} (1× seal price)
        </p>
      )}
      {quoteLabel && stripeEnabled && (
        <p className="muted" style={{ margin: 0, fontSize: '0.75rem' }}>
          Card: {quoteLabel}
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
