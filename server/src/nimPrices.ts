export const FIAT_CURRENCIES = ['usd', 'eur', 'cad'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

export interface NimPrices {
  usd: number
  eur: number
  cad: number
  lastUpdatedAt: number | null
  source: 'coingecko'
}

const CACHE_TTL_MS = 60_000
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd,eur,cad&include_last_updated_at=true'

let cache: { data: NimPrices; fetchedAt: number } | null = null
let inflight: Promise<NimPrices> | null = null

function parseCoinGeckoResponse(payload: unknown): NimPrices {
  const root = payload as {
    'nimiq-2'?: {
      usd?: number
      eur?: number
      cad?: number
      last_updated_at?: number
    }
  }
  const nim = root['nimiq-2']
  if (!nim || typeof nim.usd !== 'number' || typeof nim.eur !== 'number' || typeof nim.cad !== 'number') {
    throw new Error('Unexpected CoinGecko response for NIM prices')
  }
  return {
    usd: nim.usd,
    eur: nim.eur,
    cad: nim.cad,
    lastUpdatedAt: typeof nim.last_updated_at === 'number' ? nim.last_updated_at : null,
    source: 'coingecko',
  }
}

async function fetchNimPricesFromCoinGecko(): Promise<NimPrices> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const apiKey = process.env.COINGECKO_API_KEY?.trim()
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey
  }

  const res = await fetch(COINGECKO_URL, { headers })
  if (!res.ok) {
    throw new Error(`CoinGecko request failed (${res.status})`)
  }
  return parseCoinGeckoResponse(await res.json())
}

export async function getNimPrices(): Promise<NimPrices> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data
  }

  if (!inflight) {
    inflight = fetchNimPricesFromCoinGecko()
      .then(data => {
        cache = { data, fetchedAt: Date.now() }
        return data
      })
      .finally(() => {
        inflight = null
      })
  }

  try {
    return await inflight
  } catch (err) {
    if (cache) {
      console.warn('[nim-prices] refresh failed, serving stale cache', err)
      return cache.data
    }
    throw err
  }
}