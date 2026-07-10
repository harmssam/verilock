import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import {
  loadCreditsBalance,
  writeCreditsBalanceCache,
} from '../creditsBalanceCache'

/**
 * Credit balance for the signed-in wallet. Listens for top-up events so the
 * header badge stays in sync after NIM/Stripe purchases.
 */
export function useCreditBalance(token: string | null | undefined): {
  balance: number | null
  enabled: boolean
  refresh: () => Promise<void>
} {
  const [balance, setBalance] = useState<number | null>(null)
  const [enabled, setEnabled] = useState(false)

  const refresh = useCallback(async (force = false, options?: { syncStripe?: boolean }) => {
    if (!token) {
      setBalance(null)
      setEnabled(false)
      return
    }
    try {
      const data = await loadCreditsBalance(
        token,
        () => api.creditsBalance(token, { syncStripe: options?.syncStripe }),
        { force: force || options?.syncStripe },
      )
      setEnabled(data.enabled)
      setBalance(data.enabled ? data.balance : null)
      // If pending Stripe sessions minted credits, push a top-up event so panels update.
      const minted = data.stripeSynced?.mintedTotal
      if (minted && minted > 0) {
        writeCreditsBalanceCache(token, data.balance)
        window.dispatchEvent(
          new CustomEvent('verilock:credits-topup', {
            detail: { ok: true, balance: data.balance, creditsMinted: minted },
          }),
        )
      }
    } catch {
      // Keep last known balance on 429 / transient errors
    }
  }, [token])

  useEffect(() => {
    // First load after connect: sync any paid-but-unminted Stripe checkouts
    // (webhook may have missed). Later refreshes stay cheap.
    void refresh(true, { syncStripe: true })
  }, [refresh])

  useEffect(() => {
    const onTopup = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { ok?: boolean; balance?: number }
      if (detail?.ok && typeof detail.balance === 'number' && token) {
        writeCreditsBalanceCache(token, detail.balance)
        setBalance(detail.balance)
        setEnabled(true)
      } else {
        void refresh(true)
      }
    }
    window.addEventListener('verilock:credits-topup', onTopup)
    return () => window.removeEventListener('verilock:credits-topup', onTopup)
  }, [refresh, token])

  return {
    balance,
    enabled,
    refresh: () => refresh(true),
  }
}
