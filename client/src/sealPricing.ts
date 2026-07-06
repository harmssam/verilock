import {
  getSealPricing as resolveSealPricing,
  type SealPricing,
} from './shared/sealPricing'

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
} from './shared/sealPricing'

export function formatSealFeeNim(feeNim: number): string {
  const formatted = Number.isInteger(feeNim) ? String(feeNim) : feeNim.toFixed(2)
  return `${formatted} NIM`
}

export function formatSealFeeSummary(pricing: SealPricing = resolveSealPricing()): string {
  if (pricing.promoActive) {
    return `${formatSealFeeNim(pricing.feeNim)} (was ${formatSealFeeNim(pricing.baseFeeNim)})`
  }
  return formatSealFeeNim(pricing.feeNim)
}