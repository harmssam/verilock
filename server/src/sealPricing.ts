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
} from './shared/sealPricing.js'

import { getSealFeeLuna } from './shared/sealPricing.js'
import { CREDIT_PROOF_VALUE_LUNA } from './creditsConfig.js'

/**
 * Historical underpriced amounts — no longer accepted for *new* unpaid seals.
 * Kept only for reference / migration notes. Credit seals use CREDIT_PROOF_VALUE_LUNA
 * with an active reservation + service wallet (see verifyAttestation).
 */
export const LEGACY_SEAL_FEE_LUNA = [0, 1, 100_000, 1_000_000] as const

/** Direct-pay seals must transfer the current seal fee only. */
export function isValidDirectSealFeeLuna(value: number, now = new Date()): boolean {
  return value === getSealFeeLuna(now)
}

/** @deprecated Prefer isValidDirectSealFeeLuna — legacy free amounts are no longer accepted. */
export function isValidSealFeeLuna(value: number, now = new Date()): boolean {
  return isValidDirectSealFeeLuna(value, now)
}

export function isCreditProofValueLuna(value: number): boolean {
  return value === CREDIT_PROOF_VALUE_LUNA || value === 0
}