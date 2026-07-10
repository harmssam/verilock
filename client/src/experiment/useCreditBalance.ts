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

  const refresh = useCallback(async (force = false) => {
    if (!token) {
      setBalance(null)
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
      setBalance(data.enabled ? data.balance : null)
    } catch {
      // Keep last known balance on 429 / transient errors
    }
  }, [token])

  useEffect(() => {
    void refresh(false)
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
