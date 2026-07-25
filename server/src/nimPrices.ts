export const FIAT_CURRENCIES = ['usd', 'eur', 'cad'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

export interface NimPrices {
  usd: number
  eur: number
  cad: number
  lastUpdatedAt: number | null
  source: 'fastspot' | 'coingecko'
}

/** Fresh window: use cache without revalidating. */
const CACHE_TTL_MS = 5 * 60_000
/**
 * How long Fastspot is allowed to block a cold request before CoinGecko.
 * Fastspot can hang ~60s on some hosts; display quotes must stay snappy.
 */
const FASTSPOT_TIMEOUT_MS = Math.max(
  800,
  Number.parseInt(process.env.FASTSPOT_PRICE_TIMEOUT_MS ?? '2500', 10) || 2500,
)
const REFERENCE_NIM = 1000
const FASTSPOT_API_URL = process.env.FASTSPOT_API_URL?.trim() ?? 'https://api.go.fastspot.io/fast/v1'
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=CAD'
const COINGECKO_URL =
  process.env.COINGECKO_NIM_PRICE_URL?.trim() ??
  'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd,eur,cad'

let cache: { data: NimPrices; fetchedAt: number } | null = null
let inflight: Promise<NimPrices> | null = null

type FastspotEstimate = {
  to?: Array<{ symbol?: string; amount?: string }>
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function fetchNimToAssetRate(asset: 'EUR' | 'USDC'): Promise<number> {
  const res = await fetch(`${FASTSPOT_API_URL}/estimates`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { NIM: String(REFERENCE_NIM) },
      to: asset,
      includedFees: 'required',
    }),
  })

  if (!res.ok) {
    throw new Error(`Fastspot request failed (${res.status})`)
  }

  const payload = (await res.json()) as FastspotEstimate[]
  const amount = Number.parseFloat(payload[0]?.to?.[0]?.amount ?? '')
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Unexpected Fastspot estimate for NIM→${asset}`)
  }

  return amount / REFERENCE_NIM
}

async function fetchUsdToCadRate(): Promise<number> {
  const res = await fetch(FRANKFURTER_URL, {
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  })

  if (!res.ok) {
    throw new Error(`Frankfurter request failed (${res.status})`)
  }

  const payload = (await res.json()) as { rates?: { CAD?: number } }
  const rate = payload.rates?.CAD
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error('Unexpected Frankfurter USD→CAD response')
  }

  return rate
}

async function fetchNimPricesFromFastspot(): Promise<NimPrices> {
  const [usd, eur, usdToCad] = await Promise.all([
    fetchNimToAssetRate('USDC'),
    fetchNimToAssetRate('EUR'),
    fetchUsdToCadRate(),
  ])

  return {
    usd,
    eur,
    cad: usd * usdToCad,
    lastUpdatedAt: Math.floor(Date.now() / 1000),
    source: 'fastspot',
  }
}

/** Fallback when Fastspot is slow or unreachable (common on some hosts). */
async function fetchNimPricesFromCoingecko(): Promise<NimPrices> {
  const res = await fetch(COINGECKO_URL, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`CoinGecko request failed (${res.status})`)
  }
  const payload = (await res.json()) as {
    'nimiq-2'?: { usd?: number; eur?: number; cad?: number }
  }
  const row = payload['nimiq-2']
  const usd = Number(row?.usd)
  const eur = Number(row?.eur)
  let cad = Number(row?.cad)
  if (!Number.isFinite(usd) || usd <= 0) {
    throw new Error('Unexpected CoinGecko NIM USD price')
  }
  if (!Number.isFinite(eur) || eur <= 0) {
    throw new Error('Unexpected CoinGecko NIM EUR price')
  }
  if (!Number.isFinite(cad) || cad <= 0) {
    try {
      cad = usd * (await fetchUsdToCadRate())
    } catch {
      cad = usd
    }
  }

  return {
    usd,
    eur,
    cad,
    lastUpdatedAt: Math.floor(Date.now() / 1000),
    source: 'coingecko',
  }
}

async function fetchNimPricesFresh(): Promise<NimPrices> {
  // Start CoinGecko in parallel so a hung Fastspot does not add full timeout latency.
  const coingecko = fetchNimPricesFromCoingecko()
  try {
    return await withTimeout(
      fetchNimPricesFromFastspot(),
      FASTSPOT_TIMEOUT_MS,
      'Fastspot NIM prices',
    )
  } catch (err) {
    console.warn('[nim-prices] Fastspot failed/timed out, using CoinGecko', err)
    return await coingecko
  }
}

function startBackgroundRefresh(): void {
  if (inflight) return
  inflight = fetchNimPricesFresh()
    .then(data => {
      cache = { data, fetchedAt: Date.now() }
      return data
    })
    .catch(err => {
      if (cache) {
        console.warn('[nim-prices] background refresh failed, keeping stale cache', err)
        return cache.data
      }
      throw err
    })
    .finally(() => {
      inflight = null
    })
}

function readCache(): { data: NimPrices; fetchedAt: number } | null {
  return cache
}

/**
 * Live NIM fiat rates with in-memory cache.
 * - Fresh cache (< 5 min): instant
 * - Expired cache: return last value immediately (stale-while-revalidate)
 * - No cache: fetch with Fastspot timeout then CoinGecko
 */
export async function getNimPrices(): Promise<NimPrices> {
  const now = Date.now()
  const hit = readCache()

  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data
  }

  // Stale-while-revalidate: never block the request path on a slow refresh.
  if (hit) {
    startBackgroundRefresh()
    return hit.data
  }

  if (!inflight) {
    startBackgroundRefresh()
  }

  try {
    return await inflight!
  } catch (err) {
    // Another request may have filled cache while we awaited.
    const stale = readCache()
    if (stale) {
      console.warn('[nim-prices] refresh failed, serving stale cache', err)
      return stale.data
    }
    throw err
  }
}

/** Optional: warm cache on process boot so the first pricing hit is instant. */
export function warmNimPricesCache(): void {
  void getNimPrices().catch(err => {
    console.warn('[nim-prices] warm cache failed', err instanceof Error ? err.message : err)
  })
}
