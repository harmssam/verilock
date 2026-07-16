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
  /** Prefer showing card price on pack chips (pricing page). */
  preferCardPrice?: boolean
  /**
   * Balance only — hide pack selection and NIM/card purchase actions.
   * Use on the seal step when the user already has enough credits.
   */
  balanceOnly?: boolean
  /** Called when the known balance changes (load, top-up, purchase). */
  onBalanceChange?: (balance: number) => void
}

export function CreditsPanel({
  token,
  address = null,
  nimiq = null,
  setNimiq,
  refreshKey = 0,
  compact = false,
  preferCardPrice = false,
  balanceOnly = false,
  onBalanceChange,
}: CreditsPanelProps) {
  const [enabled, setEnabled] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(false)
  const [balance, setBalance] = useState(0)
  const [packs, setPacks] = useState<number[]>(DEFAULT_PACKS)
  const [selectedPack, setSelectedPack] = useState(10)
  const [packQuotes, setPackQuotes] = useState<PackQuote[]>([])
  const [busy, setBusy] = useState<'nim' | 'card' | null>(null)
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
        notifyBalance(0)
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
        notifyBalance(data.balance)
        if (Array.isArray(data.packs) && data.packs.length > 0) {
          setPacks(data.packs)
          setSelectedPack(prev => (data.packs!.includes(prev) ? prev : data.packs![0]!))
        }
      } catch {
        /* keep last known UI on 429 */
      }
    },
    [token, notifyBalance],
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
            ? `+${detail.creditsMinted} credit${detail.creditsMinted === 1 ? '' : 's'}`
            : null,
        )
        setError(null)
      } else {
        setError(detail.message || 'Purchase failed')
      }
      setBusy(null)
    }
    window.addEventListener('verilock:credits-topup', onTopup)
    return () => window.removeEventListener('verilock:credits-topup', onTopup)
  }, [notifyBalance, token])

  useEffect(() => {
    if (!token || !enabled || balanceOnly) return
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
  }, [enabled, token, balanceOnly])

  const packPriceLabel = (pack: number): string => {
    const q = packQuotes.find(p => p.pack === pack)
    if (!q) return '…'
    if (preferCardPrice && stripeEnabled) {
      return `≈$${q.creditStripeUsdTotal.toFixed(2)}`
    }
    return formatSealFeeNim(q.creditNimCostTotal)
  }

  const buyWithNim = async () => {
    if (!token || !address) {
      setError('Connect your wallet first')
      return
    }
    setBusy('nim')
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
          ? 'Already claimed'
          : `+${result.creditsMinted} credit${result.creditsMinted === 1 ? '' : 's'}`,
      )
      setBusy(null)
      return
    }
    if (result.redirecting) {
      setStatus(result.message)
      return
    }
    setError(result.message)
    setStatus(null)
    setBusy(null)
  }

  const buyWithCard = async () => {
    if (!token) return
    setBusy('card')
    setError(null)
    setStatus(null)
    try {
      const { url } = await api.creditsCheckout(token, selectedPack)
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setBusy(null)
    }
  }

  if (!token) {
    return (
      <div
        className={[
          'journey-credits',
          'journey-credits--guest',
          compact ? 'journey-credits--compact' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="journey-credits-top-label">
          <Coins size={15} strokeWidth={2.25} aria-hidden />
          Seal credits
        </div>
        <p className="muted journey-credits-guest-text">
          Connect your wallet to buy packs (10–100). 1 credit = 1 seal.
        </p>
      </div>
    )
  }

  if (!enabled) return null

  const busyAny = busy != null

  return (
    <div
      className={[
        'journey-credits',
        compact ? 'journey-credits--compact' : '',
        balanceOnly ? 'journey-credits--balance-only' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="journey-credits-top">
        <div className="journey-credits-top-label">
          <Coins size={15} strokeWidth={2.25} aria-hidden />
          Your balance
        </div>
        <div className="journey-credits-balance">
          <span className="journey-credits-balance-n">{balance}</span>
          <span className="journey-credits-balance-unit">
            credit{balance === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {!balanceOnly && (
        <>
          <div className="journey-credits-packs" role="radiogroup" aria-label="Pack size">
            {packs.map(pack => {
              const active = selectedPack === pack
              return (
                <button
                  key={pack}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`journey-credits-pack${active ? ' journey-credits-pack--active' : ''}`}
                  disabled={busyAny}
                  onClick={() => setSelectedPack(pack)}
                >
                  <span className="journey-credits-pack-n">{pack}</span>
                  <span className="journey-credits-pack-price">{packPriceLabel(pack)}</span>
                </button>
              )
            })}
          </div>

          <div
            className={[
              'journey-credits-actions',
              !stripeEnabled ? 'journey-credits-actions--single' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className={`btn btn-primary${busy === 'nim' ? ' btn--busy' : ''}`}
              disabled={busyAny || !address}
              onClick={() => void buyWithNim()}
            >
              {busy === 'nim' ? (
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
              ) : (
                <Wallet size={16} strokeWidth={2.25} />
              )}
              {selectedQuote
                ? `NIM · ${formatSealFeeNim(selectedQuote.creditNimCostTotal)}`
                : 'Pay with NIM'}
            </button>
            {stripeEnabled && (
              <button
                type="button"
                className={`btn btn-secondary${busy === 'card' ? ' btn--busy' : ''}`}
                disabled={busyAny}
                onClick={() => void buyWithCard()}
              >
                {busy === 'card' ? (
                  <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
                ) : (
                  <CreditCard size={16} strokeWidth={2.25} />
                )}
                {selectedQuote
                  ? `Card · $${selectedQuote.creditStripeUsdTotal.toFixed(2)}`
                  : 'Pay with card'}
              </button>
            )}
          </div>
        </>
      )}

      {status && (
        <p className="muted journey-credits-msg" aria-live="polite">
          {status}
        </p>
      )}
      {error && (
        <p className="journey-credits-msg journey-credits-msg--error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
