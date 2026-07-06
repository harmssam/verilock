export const FIAT_CURRENCIES = ['USD', 'EUR', 'CAD'] as const
export type FiatCurrency = (typeof FIAT_CURRENCIES)[number]

export const FIAT_CURRENCY_STORAGE_KEY = 'verilock-fiat-currency'

export interface NimPrices {
  usd: number
  eur: number
  cad: number
  lastUpdatedAt: number | null
  source: 'coingecko'
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
  const fractionDigits = amount < 0.01 ? 4 : amount < 1 ? 3 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Math.min(fractionDigits, 2),
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}