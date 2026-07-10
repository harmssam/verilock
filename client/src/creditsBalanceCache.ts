/**
 * Short-lived cache so header + CreditsPanel don't stampede /api/credits/balance.
 */
type CacheEntry = {
  balance: number
  enabled: boolean
  stripeEnabled: boolean
  packs?: number[]
  stripeMarkup?: number
  stripeMinChargeCents?: number
  maxPerCheckout?: number
  maxPerNimTopup?: number
  creditsPerSeal?: number
  fetchedAt: number
}

const TTL_MS = 8_000
let cache: { token: string; entry: CacheEntry } | null = null
let inflight: { token: string; promise: Promise<CacheEntry> } | null = null

export function invalidateCreditsBalanceCache(): void {
  cache = null
  inflight = null
}

export function peekCreditsBalanceCache(token: string): CacheEntry | null {
  if (!cache || cache.token !== token) return null
  if (Date.now() - cache.entry.fetchedAt > TTL_MS) return null
  return cache.entry
}

export async function loadCreditsBalance(
  token: string,
  fetchFn: () => Promise<{
    balance: number
    enabled: boolean
    stripeEnabled: boolean
    packs?: number[]
    stripeMarkup?: number
    stripeMinChargeCents?: number
    maxPerCheckout?: number
    maxPerNimTopup?: number
    creditsPerSeal?: number
  }>,
  options?: { force?: boolean },
): Promise<CacheEntry> {
  if (!options?.force) {
    const hit = peekCreditsBalanceCache(token)
    if (hit) return hit
    if (inflight && inflight.token === token) return inflight.promise
  }

  const promise = (async () => {
    const data = await fetchFn()
    const entry: CacheEntry = {
      balance: data.balance,
      enabled: data.enabled,
      stripeEnabled: data.stripeEnabled,
      packs: data.packs,
      stripeMarkup: data.stripeMarkup,
      stripeMinChargeCents: data.stripeMinChargeCents,
      maxPerCheckout: data.maxPerCheckout,
      maxPerNimTopup: data.maxPerNimTopup,
      creditsPerSeal: data.creditsPerSeal,
      fetchedAt: Date.now(),
    }
    cache = { token, entry }
    return entry
  })().finally(() => {
    if (inflight?.promise === promise) inflight = null
  })

  inflight = { token, promise }
  return promise
}

export function writeCreditsBalanceCache(token: string, balance: number): void {
  if (cache && cache.token === token) {
    cache = {
      token,
      entry: { ...cache.entry, balance, fetchedAt: Date.now() },
    }
  } else {
    cache = {
      token,
      entry: {
        balance,
        enabled: true,
        stripeEnabled: true,
        fetchedAt: Date.now(),
      },
    }
  }
}
