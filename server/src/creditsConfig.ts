/** Feature flags and caps for the credit system. */

export function isCreditsEnabled(): boolean {
  const raw = process.env.CREDITS_ENABLED?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  // Default on in non-production so local dev works; require explicit enable in prod.
  if (process.env.NODE_ENV === 'production') {
    return raw === '1' || raw === 'true' || raw === 'on'
  }
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

export function isStripeCreditsEnabled(): boolean {
  if (!isCreditsEnabled()) return false
  const raw = process.env.CREDITS_STRIPE_ENABLED?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim())
}

/** Stripe unit price = sealFeeNim × nimUsd × markup (encourage direct NIM). */
export function getStripeMarkup(): number {
  const n = Number(process.env.CREDITS_STRIPE_MARKUP ?? 2)
  return Number.isFinite(n) && n >= 1 ? n : 2
}

export function getMaxCreditsPerCheckout(): number {
  const n = Number(process.env.CREDITS_MAX_PER_CHECKOUT ?? 100)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 100
}

export function getMaxCreditsPerNimTopup(): number {
  const n = Number(process.env.CREDITS_MAX_PER_NIM_TOPUP ?? 100)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 100
}

/**
 * Fixed credit packs for purchase UI (NIM + card).
 * Override with CREDITS_PACKS=10,25,50,100
 */
export function getCreditPacks(): number[] {
  const raw = process.env.CREDITS_PACKS?.trim()
  const parsed = raw
    ? raw
        .split(/[,\s]+/)
        .map(s => Number(s))
        .filter(n => Number.isFinite(n) && n >= 1)
        .map(n => Math.floor(n))
    : [10, 25, 50, 100]
  const max = getMaxCreditsPerCheckout()
  const unique = [...new Set(parsed.filter(n => n <= max))].sort((a, b) => a - b)
  return unique.length > 0 ? unique : [10, 25, 50, 100].filter(n => n <= max)
}

/** Stripe USD charges must be at least this many cents (Stripe floor is $0.50). */
export function getStripeMinChargeCents(): number {
  const n = Number(process.env.CREDITS_STRIPE_MIN_CENTS ?? 50)
  return Number.isFinite(n) && n >= 50 ? Math.floor(n) : 50
}

export function isCreditPack(credits: number): boolean {
  return getCreditPacks().includes(Math.floor(credits))
}

/** Hold reservation TTL before auto-release eligibility. */
export const CREDIT_RESERVATION_TTL_MS = 30 * 60_000

/** Minimal on-chain proof value for service-wallet credit seals (luna). */
export const CREDIT_PROOF_VALUE_LUNA = 1

/** Refuse Stripe checkout if NIM/USD quote older than this. */
export const NIM_PRICE_MAX_AGE_MS = 15 * 60_000
