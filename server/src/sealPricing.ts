export {
  BASE_SEAL_FEE_NIM,
  getMinimumSealBalanceLuna,
  getSealFeeLuna,
  getSealFeeNim,
  getSealPricing,
  hasSufficientSealBalance,
  isJulyPromoActive,
  JULY_PROMO_DISCOUNT,
  LUNA_PER_NIM,
  SEAL_TX_FEE_BUFFER_LUNA,
  type SealPricing,
} from '../../shared/sealPricing.js'

import { getSealFeeLuna } from '../../shared/sealPricing.js'

/** Legacy seal fees from earlier pricing (luna). */
export const LEGACY_SEAL_FEE_LUNA = [0, 1, 100_000, 1_000_000] as const

export function isValidSealFeeLuna(value: number, now = new Date()): boolean {
  if (LEGACY_SEAL_FEE_LUNA.includes(value as (typeof LEGACY_SEAL_FEE_LUNA)[number])) {
    return true
  }
  return value === getSealFeeLuna(now)
}