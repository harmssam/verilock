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
   * Balance only - hide pack selection and NIM/card purchase actions.
   * Use on the seal step when the user already has enough credits.
   */
  balanceOnly?: boolean
  /** Called when the known balance changes (load, top-up, purchase). */
  onBalanceChange?: (balance: number) => void
  /**
   * Guest buy path: open wallet login. Packs stay visible without signing in;
   * purchase buttons call this when there is no session yet.
   */
  onRequestLogin?: () => void
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
  onRequestLogin,
}: CreditsPanelProps) {
  const signedIn = Boolean(token)
  const [enabled, setEnabled] = useState(true)
  const [configReady, setConfigReady] = useState(false)
  const [stripeEnabled, setStripeEnabled] = useState(preferCardPrice)
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

  // Public: pack sizes + Stripe flag (no wallet).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const cfg = await api.creditsConfig()
        if (cancelled) return
        setEnabled(cfg.enabled)
        setStripeEnabled(cfg.stripeEnabled)
        if (Array.isArray(cfg.packs) && cfg.packs.length > 0) {
          setPacks(cfg.packs)
          setSelectedPack(prev => (cfg.packs.includes(prev) ? prev : cfg.packs[0]!))
        }
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setConfigReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Public: live pack prices (no wallet).
  useEffect(() => {
    if (balanceOnly) return
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
        if (catalog.packs.length > 0) {
          setPacks(catalog.packs.map(p => p.pack))
          setSelectedPack(prev =>
            catalog.packs.some(p => p.pack === prev)
              ? prev
              : catalog.packs[0]!.pack,
          )
        }
        if (typeof catalog.stripeMarkup === 'number') {
          /* stripe flag comes from config; pack catalog confirms Stripe pricing exists */
        }
      } catch {
        if (!cancelled) setPackQuotes([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [balanceOnly])

  const refreshBalance = useCallback(
    async (force = false) => {
      if (!token) {
        setBalance(0)
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
    void refreshBalance(refreshKey > 0)
  }, [refreshBalance, refreshKey])

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

  const packPriceLabel = (pack: number): string => {
    const q = packQuotes.find(p => p.pack === pack)
    if (!q) return '…'
    // Default path is Stripe; preferCardPrice forces card figures even before stripe flag loads.
    if ((preferCardPrice || stripeEnabled) && q.creditStripeUsdTotal > 0) {
      return `≈$${q.creditStripeUsdTotal.toFixed(2)}`
    }
    return formatSealFeeNim(q.creditNimCostTotal)
  }

  const requireLogin = (): boolean => {
    if (token && address) return false
    setError(null)
    if (onRequestLogin) {
      onRequestLogin()
      return true
    }
    setError('Connect your wallet to buy')
    return true
  }

  const buyWithNim = async () => {
    if (requireLogin()) return
    if (!token || !address) return
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
    if (requireLogin()) return
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

  if (configReady && !enabled) return null

  // Balance-only guests have nothing to show.
  if (balanceOnly && !signedIn) return null

  const busyAny = busy != null
  const showCard = stripeEnabled || preferCardPrice

  return (
    <div
      className={[
        'journey-credits',
        compact ? 'journey-credits--compact' : '',
        balanceOnly ? 'journey-credits--balance-only' : '',
        !signedIn ? 'journey-credits--guest' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="journey-credits-top">
        <div className="journey-credits-top-label">
          <Coins size={15} strokeWidth={2.25} aria-hidden />
          {signedIn ? 'Your balance' : 'Credit packs'}
        </div>
        {signedIn ? (
          <div className="journey-credits-balance">
            <span className="journey-credits-balance-n">{balance}</span>
            <span className="journey-credits-balance-unit">
              credit{balance === 1 ? '' : 's'}
            </span>
          </div>
        ) : (
          <p className="muted journey-credits-guest-text">
            Pick a pack. Connect only when you buy.
          </p>
        )}
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
              !showCard ? 'journey-credits-actions--single' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {showCard && (
              <button
                type="button"
                className={`btn btn-primary${busy === 'card' ? ' btn--busy' : ''}`}
                disabled={busyAny}
                onClick={() => void buyWithCard()}
              >
                {busy === 'card' ? (
                  <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
                ) : (
                  <CreditCard size={16} strokeWidth={2.25} />
                )}
                {selectedQuote
                  ? `Credit card · $${selectedQuote.creditStripeUsdTotal.toFixed(2)}`
                  : 'Credit card'}
              </button>
            )}
            <button
              type="button"
              className={`btn ${showCard ? 'btn-secondary' : 'btn-primary'}${
                busy === 'nim' ? ' btn--busy' : ''
              }`}
              disabled={busyAny}
              onClick={() => void buyWithNim()}
            >
              {busy === 'nim' ? (
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} />
              ) : (
                <Wallet size={16} strokeWidth={2.25} />
              )}
              {selectedQuote
                ? `NIM · ${formatSealFeeNim(selectedQuote.creditNimCostTotal)}`
                : 'NIM'}
            </button>
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
