import { useEffect, useState } from 'react'
import { api } from './api'
import type { NimPrices } from './fiatPricing'

export function useNimPrices() {
  const [prices, setPrices] = useState<NimPrices | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    api
      .nimPrices()
      .then(data => {
        if (!cancelled) {
          setPrices(data)
          setError(null)
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load NIM prices')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { prices, loading, error }
}