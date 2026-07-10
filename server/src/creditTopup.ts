import { normalizeAddress } from './addresses.js'
import { getMaxCreditsPerNimTopup } from './creditsConfig.js'
import { getCreditBalance, isTxHashUsedForCredits, isTxUsed } from './db.js'
import { mintCreditsFromNimTopup } from './credits.js'
import {
  decodeRecipientDataBytes,
  fetchTransaction,
  getExpectedAttestationRecipient,
  normalizeTxHash,
} from './nimiq-rpc.js'
import { getSealFeeLuna, getSealFeeNim } from './sealPricing.js'

/** Top-up payload: version=2, kind=1 (topup). Distinct from seal attestation version=1. */
export const TOPUP_PAYLOAD_VERSION = 2
export const TOPUP_PAYLOAD_KIND = 1
export const TOPUP_PAYLOAD_MIN_SIZE = 2

export function buildTopupPayloadBytes(): Buffer {
  const buf = Buffer.alloc(TOPUP_PAYLOAD_MIN_SIZE)
  buf[0] = TOPUP_PAYLOAD_VERSION
  buf[1] = TOPUP_PAYLOAD_KIND
  return buf
}

export function buildTopupPayloadHex(): string {
  return buildTopupPayloadBytes().toString('hex')
}

export function isTopupPayload(rawRecipientData: string): boolean {
  const bytes = decodeRecipientDataBytes(rawRecipientData)
  if (bytes.length < TOPUP_PAYLOAD_MIN_SIZE) return false
  return bytes[0] === TOPUP_PAYLOAD_VERSION && bytes[1] === TOPUP_PAYLOAD_KIND
}

export async function claimNimCreditTopup(
  txHash: string,
  walletAddress: string,
): Promise<{ balance: number; creditsMinted: number; alreadyClaimed: boolean; feeNim: number }> {
  const wallet = normalizeAddress(walletAddress)
  const cleanHash = normalizeTxHash(txHash)

  if (isTxUsed(cleanHash)) {
    throw new Error('Transaction already used as a seal attestation')
  }

  const tx = await fetchTransaction(cleanHash)
  if (!tx) {
    throw new Error('Transaction not found on-chain yet. Wait a few seconds and retry.')
  }
  if (tx.confirmations < Number(process.env.NIM_MIN_CONFIRMATIONS ?? 1)) {
    throw new Error(
      `Transaction pending (${tx.confirmations} confirmations). Retry shortly.`,
    )
  }
  if (!tx.executionResult) {
    throw new Error('Transaction failed on-chain')
  }

  if (normalizeAddress(tx.from) !== wallet) {
    throw new Error('Top-up transaction sender does not match your wallet')
  }

  const sink = getExpectedAttestationRecipient()
  if (!sink) {
    throw new Error('Attestation sink is not configured')
  }
  if (normalizeAddress(tx.to) !== sink) {
    throw new Error('Top-up must be sent to the VeriLock sink address')
  }

  if (!isTopupPayload(tx.recipientData)) {
    throw new Error('Top-up transaction must use the credit top-up payload (not a seal payload)')
  }

  const feeLuna = getSealFeeLuna()
  if (feeLuna <= 0 || tx.value % feeLuna !== 0) {
    throw new Error(
      `Top-up value must be an exact multiple of the current seal fee (${feeLuna} luna)`,
    )
  }

  const credits = tx.value / feeLuna
  const max = getMaxCreditsPerNimTopup()
  if (credits < 1 || credits > max) {
    throw new Error(`Top-up must mint between 1 and ${max} credits`)
  }

  if (isTxHashUsedForCredits(cleanHash)) {
    return {
      balance: getCreditBalance(wallet),
      creditsMinted: credits,
      alreadyClaimed: true,
      feeNim: getSealFeeNim(),
    }
  }

  const { balance, created } = mintCreditsFromNimTopup({
    walletAddress: wallet,
    credits,
    txHash: cleanHash,
    nimLuna: tx.value,
  })

  return {
    balance,
    creditsMinted: credits,
    alreadyClaimed: !created,
    feeNim: getSealFeeNim(),
  }
}
