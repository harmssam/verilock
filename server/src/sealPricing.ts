export const LUNA_PER_NIM = 100_000
export const BASE_SEAL_FEE_NIM = 10
export const JULY_PROMO_DISCOUNT = 0.9

export interface SealPricing {
  feeNim: number
  feeLuna: number
  baseFeeNim: number
  promoActive: boolean
  promoLabel: string | null
  promoEndsLabel: string | null
}

export function isJulyPromoActive(now = new Date()): boolean {
  return now.getMonth() === 6
}

export function getSealFeeNim(now = new Date()): number {
  if (isJulyPromoActive(now)) {
    return BASE_SEAL_FEE_NIM * (1 - JULY_PROMO_DISCOUNT)
  }
  return BASE_SEAL_FEE_NIM
}

export function getSealFeeLuna(now = new Date()): number {
  return Math.round(getSealFeeNim(now) * LUNA_PER_NIM)
}

export function getSealPricing(now = new Date()): SealPricing {
  const promoActive = isJulyPromoActive(now)
  const feeNim = getSealFeeNim(now)
  return {
    feeNim,
    feeLuna: getSealFeeLuna(now),
    baseFeeNim: BASE_SEAL_FEE_NIM,
    promoActive,
    promoLabel: promoActive ? '90% off — July only' : null,
    promoEndsLabel: promoActive ? 'Promo ends August 1' : null,
  }
}

/** Legacy seals before paid sealing (self-send or 1-luna Hub checkout). */
export const LEGACY_SEAL_FEE_LUNA = [0, 1] as const

export function isValidSealFeeLuna(value: number, now = new Date()): boolean {
  if (LEGACY_SEAL_FEE_LUNA.includes(value as (typeof LEGACY_SEAL_FEE_LUNA)[number])) {
    return true
  }
  return value === getSealFeeLuna(now)
}