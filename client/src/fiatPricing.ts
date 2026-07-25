export const FIAT_CURRENCIES = ['USD', 'EUR', 'CAD'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

export const FIAT_CURRENCY_STORAGE_KEY = 'verilock-fiat-currency'

export interface NimPrices {
  usd: number
  eur: number
  cad: number
  lastUpdatedAt: number | null
  source: 'fastspot' | 'coingecko'
}

export function isFiatCurrency(value: string): value is FiatCurrency {
  return (FIAT_CURRENCIES as readonly string[]).includes(value)
}

export function readStoredFiatCurrency(): FiatCurrency {
  if (typeof window === 'undefined') return 'USD'
  const stored = window.localStorage.getItem(FIAT_CURRENCY_STORAGE_KEY)
  return stored && isFiatCurrency(stored) ? stored : 'USD'
}

export function storeFiatCurrency(currency: FiatCurrency): void {
  window.localStorage.setItem(FIAT_CURRENCY_STORAGE_KEY, currency)
}

export function nimToFiat(nim: number, currency: FiatCurrency, prices: NimPrices): number {
  const rateKey = currency.toLowerCase() as keyof Pick<NimPrices, 'usd' | 'eur' | 'cad'>
  return nim * prices[rateKey]
}

export function formatFiatAmount(amount: number, currency: FiatCurrency): string {
  if (!Number.isFinite(amount)) return 'n/a'
  const abs = Math.abs(amount)
  // Sub-dollar live rates need extra precision; whole dollars stay at 2.
  const maximumFractionDigits = abs > 0 && abs < 0.01 ? 4 : abs > 0 && abs < 1 ? 3 : 2
  const minimumFractionDigits = Math.min(2, maximumFractionDigits)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(amount)
  } catch {
    // Rare engine quirks with currency + fraction options.
    const fixed = amount.toFixed(maximumFractionDigits)
    if (currency === 'USD') return `$${fixed}`
    if (currency === 'EUR') return `€${fixed}`
    return `CA$${fixed}`
  }
}