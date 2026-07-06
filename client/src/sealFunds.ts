import {
  formatSealFeeNim,
  getMinimumSealBalanceLuna,
  getSealPricing,
  hasSufficientSealBalance,
  LUNA_PER_NIM,
  type SealPricing,
} from './sealPricing'

export interface SealFundsStatus {
  balanceLuna: number
  requiredLuna: number
  sufficient: boolean
  balanceNim: number
  pricing: SealPricing
}

export function evaluateSealFunds(balanceLuna: number, now = new Date()): SealFundsStatus {
  const pricing = getSealPricing(now)
  const requiredLuna = getMinimumSealBalanceLuna(now)
  return {
    balanceLuna,
    requiredLuna,
    sufficient: hasSufficientSealBalance(balanceLuna, now),
    balanceNim: balanceLuna / LUNA_PER_NIM,
    pricing,
  }
}

export function insufficientSealFundsMessage(status: SealFundsStatus): string {
  const have = formatSealFeeNim(status.balanceNim)
  const need = formatSealFeeNim(status.requiredLuna / LUNA_PER_NIM)
  return `Your wallet has ${have} but sealing requires at least ${need} (seal fee plus network fees). Add NIM to your wallet, then try again.`
}