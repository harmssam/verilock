import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import { evaluateSealFunds, type SealFundsStatus } from './sealFunds'

export function useSealFunds(token: string | null, enabled: boolean) {
  const [status, setStatus] = useState<SealFundsStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!token || !enabled) {
      setStatus(null)
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const result = await api.walletBalance(token)
      setStatus(evaluateSealFunds(result.balanceLuna))
    } catch (err) {
      setStatus(null)
      setError(err instanceof Error ? err.message : 'Could not check wallet balance')
    } finally {
      setLoading(false)
    }
  }, [token, enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, loading, error, refresh }
}