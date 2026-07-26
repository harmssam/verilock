/**
 * One-time redemption codes (AppSumo and other campaigns).
 * Redeeming mints seal credits onto a verified wallet.
 *
 * Storage form: uppercase A–Z / 0–9 only (no separators), 3–200 chars.
 * Buyers may paste with spaces or hyphens; we strip those before lookup.
 */
import { v4 as uuid } from 'uuid'
import { normalizeAddress } from './addresses.js'
import {
  applyCreditDelta,
  claimRedemptionCode,
  getCreditBalance,
  getRedemptionCode,
  isCreditAccountFlagged,
  runInTransaction,
  type CreditLedgerEntry,
} from './db.js'
import { assertCreditsEnabled } from './credits.js'
import { isCreditsEnabled } from './creditsConfig.js'

/** Default pack size for AppSumo LTDs (override with REDEEM_DEFAULT_CREDITS). */
export function getDefaultRedeemCredits(): number {
  const n = Number(process.env.REDEEM_DEFAULT_CREDITS ?? 500)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 500
}

const CODE_MIN_LEN = 3
const CODE_MAX_LEN = 200

/**
 * Normalize buyer / CSV input → storage key.
 * Uppercase, strip whitespace and separators (hyphen, underscore).
 */
export function normalizeRedeemCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

export function assertValidCodeShape(code: string): void {
  if (code.length < CODE_MIN_LEN || code.length > CODE_MAX_LEN) {
    throw new Error(`Code must be between ${CODE_MIN_LEN} and ${CODE_MAX_LEN} characters`)
  }
  if (!/^[A-Z0-9]+$/.test(code)) {
    throw new Error('Code contains invalid characters')
  }
}

export function getRedeemPublicInfo() {
  return {
    enabled: isCreditsEnabled(),
    defaultCredits: getDefaultRedeemCredits(),
    /** 1 credit = 1 document seal */
    creditsPerSeal: 1 as const,
  }
}

/**
 * Redeem a one-time code onto a verified wallet.
 * Atomic: claim code + mint credits in one transaction.
 */
export function redeemCodeForWallet(
  rawCode: string,
  walletAddress: string,
): {
  balance: number
  creditsMinted: number
  alreadyClaimed: boolean
  campaign: string
  code: string
  entry: CreditLedgerEntry
} {
  assertCreditsEnabled()
  const wallet = normalizeAddress(walletAddress)
  if (isCreditAccountFlagged(wallet)) {
    throw new Error('Redemption is temporarily unavailable for this wallet')
  }

  const code = normalizeRedeemCode(rawCode)
  if (!code) {
    throw new Error('Enter a redemption code')
  }
  assertValidCodeShape(code)

  const preview = getRedemptionCode(code)
  if (!preview) {
    throw new Error('Invalid or unknown code')
  }
  if (preview.status === 'redeemed') {
    throw new Error('This code has already been redeemed')
  }
  if (preview.status !== 'available') {
    throw new Error('This code is not available')
  }

  const credits = Math.floor(preview.credits)
  if (!Number.isFinite(credits) || credits < 1) {
    throw new Error('This code is misconfigured')
  }

  return runInTransaction(() => {
    const claimed = claimRedemptionCode(code, wallet)
    if (!claimed) {
      const again = getRedemptionCode(code)
      if (again?.status === 'redeemed') {
        throw new Error('This code has already been redeemed')
      }
      throw new Error('Invalid or unknown code')
    }

    const { balance, entry, created } = applyCreditDelta({
      id: uuid(),
      walletAddress: wallet,
      delta: credits,
      kind: 'topup_code',
      idempotencyKey: `redeem:${claimed.code}`,
      meta: JSON.stringify({
        campaign: claimed.campaign,
        code: claimed.code,
        batchId: claimed.batchId,
      }),
    })

    return {
      balance,
      creditsMinted: created ? credits : 0,
      alreadyClaimed: !created,
      campaign: claimed.campaign,
      code: claimed.code,
      entry,
    }
  })
}

/** Public helper for tests / scripts. */
export function peekBalance(walletAddress: string): number {
  return getCreditBalance(walletAddress)
}
