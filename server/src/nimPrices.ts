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
 * How long we wait on production Fastspot before giving up.
 * As of 2026-07: api.go.fastspot.io completes TLS then never returns a body
 * (hangs ~60s+). Request shape is fine — api.test.fastspot.io answers in ~0.5s
 * with the same payload. Prefer CoinGecko for the hot path.
 */
const FASTSPOT_TIMEOUT_MS = Math.max(
  800,
  Number.parseInt(process.env.FASTSPOT_PRICE_TIMEOUT_MS ?? '3000', 10) || 3000,
)
const REFERENCE_NIM = 1000
const FASTSPOT_API_URL = process.env.FASTSPOT_API_URL?.trim() ?? 'https://api.go.fastspot.io/fast/v1'
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=USD&to=CAD'
const COINGECKO_URL =
  process.env.COINGECKO_NIM_PRICE_URL?.trim() ??
  'https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd,eur,cad'

let cache: { data: NimPrices; fetchedAt: number } | null = null
let inflight: Promise<NimPrices> | null = null
/** Last Fastspot error (for ops / logs); not user-facing. */
let lastFastspotError: string | null = null
let lastFastspotOkAt: number | null = null

type FastspotEstimate = {
  from?: Array<{ symbol?: string; amount?: string }>
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

/**
 * FAST estimate: POST /estimates
 * Docs: https://docs.fastspot.io/ — EstimateRequest does not require API key.
 * Body shape (validated against api.test.fastspot.io 2026-07):
 *   { "from": { "NIM": "1000" }, "to": "USDC", "includedFees": "required" }
 * Response: [{ from: [{symbol,amount}], to: [{symbol,amount}], ... }]
 */
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
    const detail = await res.text().catch(() => '')
    throw new Error(
      `Fastspot request failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    )
  }

  const payload = (await res.json()) as FastspotEstimate[]
  const row = Array.isArray(payload) ? payload[0] : null
  // Prefer matching the requested symbol if multiple `to` entries appear.
  const toSide =
    row?.to?.find(t => (t.symbol ?? '').toUpperCase() === asset) ?? row?.to?.[0]
  const amount = Number.parseFloat(toSide?.amount ?? '')
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Unexpected Fastspot estimate for NIM→${asset}: ${JSON.stringify(row ?? payload).slice(0, 240)}`,
    )
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

  const data: NimPrices = {
    usd,
    eur,
    cad: usd * usdToCad,
    lastUpdatedAt: Math.floor(Date.now() / 1000),
    source: 'fastspot',
  }
  lastFastspotOkAt = Date.now()
  lastFastspotError = null
  return data
}

/** Reliable public market rate (primary while go.fastspot.io is unresponsive). */
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

/**
 * Hot path: CoinGecko only (reliable, ~sub-second).
 * Opportunistic: try production Fastspot in the background; if it answers, upgrade
 * the in-memory cache so subsequent quotes use swap rates.
 *
 * Why not block on Fastspot: api.go.fastspot.io currently completes TLS then never
 * returns a response body (hangs 60s+). The same request shape works in ~0.5s on
 * api.test.fastspot.io — so this is an upstream go.fastspot outage, not a bad body.
 */
async function fetchNimPricesFresh(): Promise<NimPrices> {
  const data = await fetchNimPricesFromCoingecko()

  // Non-blocking: upgrade cache if production Fastspot recovers.
  void withTimeout(fetchNimPricesFromFastspot(), FASTSPOT_TIMEOUT_MS, 'Fastspot NIM prices')
    .then(fs => {
      cache = { data: fs, fetchedAt: Date.now() }
      console.log('[nim-prices] cache upgraded to Fastspot')
    })
    .catch(err => {
      lastFastspotError = err instanceof Error ? err.message : String(err)
      // Quiet after the first failure each process lifetime to avoid log spam.
      if (lastFastspotOkAt == null) {
        console.warn('[nim-prices] Fastspot still unavailable:', lastFastspotError)
      }
    })

  return data
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
 * - No cache: CoinGecko + opportunistic Fastspot
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

/** Ops helper (tests / debug endpoints). */
export function getNimPriceSourceDebug(): {
  cachedSource: NimPrices['source'] | null
  cacheAgeMs: number | null
  lastFastspotOkAt: number | null
  lastFastspotError: string | null
  fastspotApiUrl: string
} {
  const hit = readCache()
  return {
    cachedSource: hit?.data.source ?? null,
    cacheAgeMs: hit ? Date.now() - hit.fetchedAt : null,
    lastFastspotOkAt,
    lastFastspotError,
    fastspotApiUrl: FASTSPOT_API_URL,
  }
}
