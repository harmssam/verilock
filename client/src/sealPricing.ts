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

export function formatSealFeeNim(feeNim: number): string {
  const formatted = Number.isInteger(feeNim) ? String(feeNim) : feeNim.toFixed(2)
  return `${formatted} NIM`
}

export function formatSealFeeSummary(pricing = getSealPricing()): string {
  if (pricing.promoActive) {
    return `${formatSealFeeNim(pricing.feeNim)} (was ${formatSealFeeNim(pricing.baseFeeNim)})`
  }
  return formatSealFeeNim(pricing.feeNim)
}