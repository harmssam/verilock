export const LUNA_PER_NIM = 100_000
export const BASE_SEAL_FEE_NIM = 1000
export const JULY_PROMO_DISCOUNT = 0.95

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
    promoLabel: promoActive ? '95% off — July only' : null,
    promoEndsLabel: promoActive ? 'Promo ends August 1' : null,
  }
}

/** Extra luna reserved for the Nimiq network fee on top of the seal transfer. */
export const SEAL_TX_FEE_BUFFER_LUNA = 1_000_000

export function getMinimumSealBalanceLuna(now = new Date()): number {
  return getSealFeeLuna(now) + SEAL_TX_FEE_BUFFER_LUNA
}

export function hasSufficientSealBalance(balanceLuna: number, now = new Date()): boolean {
  return balanceLuna >= getMinimumSealBalanceLuna(now)
}