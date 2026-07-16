export const FIAT_CURRENCIES = ['usd', 'eur', 'cad'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

export interface NimPrices {
  usd: number
  eur: number
  cad: number
  lastUpdatedAt: number | null
  source: 'fastspot' | 'coingecko'
}

const CACHE_TTL_MS = 5 * 60_000
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

/** Fallback when Fastspot is unreachable (common on some local IPv6/TLS paths). */
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
  try {
    return await fetchNimPricesFromFastspot()
  } catch (err) {
    console.warn('[nim-prices] Fastspot failed, trying CoinGecko', err)
    return await fetchNimPricesFromCoingecko()
  }
}

export async function getNimPrices(): Promise<NimPrices> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data
  }

  if (!inflight) {
    inflight = fetchNimPricesFresh()
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
