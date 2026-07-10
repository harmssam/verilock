import { v4 as uuid } from 'uuid'
import { normalizeAddress } from './addresses.js'
import {
  applyCreditDelta,
  getCreditBalance,
  getCreditReservation,
  getLedgerByIdempotencyKey,
  hasActiveCreditReservation,
  insertCreditReservation,
  isCreditAccountFlagged,
  listCreditLedger,
  setCreditAccountFlagged,
  updateCreditReservation,
  type CreditLedgerEntry,
  type CreditReservation,
} from './db.js'
import {
  CREDIT_RESERVATION_TTL_MS,
  getMaxCreditsPerCheckout,
  getMaxCreditsPerNimTopup,
  getStripeMarkup,
  isCreditsEnabled,
  isStripeCreditsEnabled,
  NIM_PRICE_MAX_AGE_MS,
} from './creditsConfig.js'
import { getNimPrices } from './nimPrices.js'
import { getSealFeeNim, getSealPricing } from './sealPricing.js'

export function assertCreditsEnabled(): void {
  if (!isCreditsEnabled()) {
    throw new Error('Credits are not enabled')
  }
}

export function getCreditsPublicConfig() {
  return {
    enabled: isCreditsEnabled(),
    stripeEnabled: isStripeCreditsEnabled(),
    stripeMarkup: getStripeMarkup(),
    maxPerCheckout: getMaxCreditsPerCheckout(),
    maxPerNimTopup: getMaxCreditsPerNimTopup(),
    creditsPerSeal: 1 as const,
  }
}

export function getBalanceForWallet(walletAddress: string): {
  balance: number
  flagged: boolean
  walletAddress: string
} {
  const wallet = normalizeAddress(walletAddress)
  return {
    walletAddress: wallet,
    balance: getCreditBalance(wallet),
    flagged: isCreditAccountFlagged(wallet),
  }
}

export function getLedgerForWallet(walletAddress: string, limit?: number): CreditLedgerEntry[] {
  return listCreditLedger(walletAddress, limit)
}

function roundUsd(amount: number): number {
  return Math.round(amount * 1e6) / 1e6
}

function usdToCents(usd: number): number {
  return Math.max(1, Math.round(usd * 100))
}

export interface CreditQuote {
  credits: number
  feeNim: number
  feeLuna: number
  promoActive: boolean
  creditNimCost: number
  creditNimCostTotal: number
  nimUsd: number
  stripeMarkup: number
  creditStripeUsd: number
  creditStripeUsdTotal: number
  unitUsdCents: number
  totalUsdCents: number
  stripeEnabled: boolean
  pricesAgeMs: number | null
  pricesStale: boolean
}

export async function quoteCredits(credits: number): Promise<CreditQuote> {
  assertCreditsEnabled()
  const n = Math.floor(Number(credits))
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('credits must be a positive integer')
  }
  const max = getMaxCreditsPerCheckout()
  if (n > max) {
    throw new Error(`Maximum ${max} credits per purchase`)
  }

  const pricing = getSealPricing()
  const feeNim = pricing.feeNim
  const feeLuna = pricing.feeLuna
  const prices = await getNimPrices()
  const ageMs =
    prices.lastUpdatedAt != null ? Date.now() - prices.lastUpdatedAt * 1000 : null
  const pricesStale = ageMs != null && ageMs > NIM_PRICE_MAX_AGE_MS

  const markup = getStripeMarkup()
  const creditStripeUsd = roundUsd(feeNim * prices.usd * markup)
  const unitUsdCents = usdToCents(creditStripeUsd)
  const totalUsdCents = unitUsdCents * n

  return {
    credits: n,
    feeNim,
    feeLuna,
    promoActive: pricing.promoActive,
    creditNimCost: feeNim,
    creditNimCostTotal: feeNim * n,
    nimUsd: prices.usd,
    stripeMarkup: markup,
    creditStripeUsd,
    creditStripeUsdTotal: roundUsd(creditStripeUsd * n),
    unitUsdCents,
    totalUsdCents,
    stripeEnabled: isStripeCreditsEnabled() && !pricesStale,
    pricesAgeMs: ageMs,
    pricesStale,
  }
}

function nextHoldIdempotencyKey(documentId: string): string {
  let i = 1
  while (getLedgerByIdempotencyKey(`hold:${documentId}:${i}`)) {
    i += 1
    if (i > 100) throw new Error('Too many credit reservation attempts for this document')
  }
  return `hold:${documentId}:${i}`
}

function latestHoldKey(documentId: string): string | null {
  let i = 1
  let last: string | null = null
  while (getLedgerByIdempotencyKey(`hold:${documentId}:${i}`)) {
    last = `hold:${documentId}:${i}`
    i += 1
  }
  return last
}

/** Debit 1 credit and create a held reservation for a document seal. */
export function reserveCreditForDocument(
  documentId: string,
  walletAddress: string,
): { balance: number; reservation: CreditReservation } {
  assertCreditsEnabled()
  const wallet = normalizeAddress(walletAddress)
  const now = Date.now()
  const existing = getCreditReservation(documentId)

  if (existing?.status === 'captured') {
    throw new Error('Credit already used for this document')
  }
  if (existing?.status === 'held' && existing.expiresAt >= now) {
    if (normalizeAddress(existing.walletAddress) !== wallet) {
      throw new Error('Credit reservation belongs to another wallet')
    }
    return { balance: getCreditBalance(wallet), reservation: existing }
  }

  // Expired hold still has a debit — release (refund) before taking a new hold.
  if (existing?.status === 'held' && existing.expiresAt < now) {
    releaseCreditReservation(documentId, 'reservation_expired')
  }

  const holdKey = nextHoldIdempotencyKey(documentId)
  const { balance } = applyCreditDelta({
    id: uuid(),
    walletAddress: wallet,
    delta: -1,
    kind: 'spend',
    idempotencyKey: holdKey,
    refDocumentId: documentId,
    feeNimAtEvent: getSealFeeNim(),
  })

  if (!existing) {
    insertCreditReservation({
      documentId,
      walletAddress: wallet,
      status: 'held',
      serviceTxHash: null,
      createdAt: now,
      expiresAt: now + CREDIT_RESERVATION_TTL_MS,
      resolvedAt: null,
    })
  } else {
    updateCreditReservation(documentId, {
      status: 'held',
      serviceTxHash: null,
      resolvedAt: null,
      expiresAt: now + CREDIT_RESERVATION_TTL_MS,
    })
  }

  const reservation = getCreditReservation(documentId)
  if (!reservation) throw new Error('Failed to create credit reservation')
  return { balance, reservation }
}

export function captureCreditReservation(documentId: string, serviceTxHash?: string): void {
  const res = getCreditReservation(documentId)
  if (!res) return
  if (res.status === 'captured') return
  updateCreditReservation(documentId, {
    status: 'captured',
    serviceTxHash: serviceTxHash ?? res.serviceTxHash,
    resolvedAt: Date.now(),
  })
}

/** Return 1 credit if reservation was held but seal failed. */
export function releaseCreditReservation(
  documentId: string,
  reason?: string,
): { released: boolean; balance: number | null } {
  const res = getCreditReservation(documentId)
  if (!res) return { released: false, balance: null }
  if (res.status === 'captured' || res.status === 'released') {
    return { released: false, balance: getCreditBalance(res.walletAddress) }
  }

  const holdKey = latestHoldKey(documentId)
  if (!holdKey) {
    updateCreditReservation(documentId, { status: 'released', resolvedAt: Date.now() })
    return { released: false, balance: getCreditBalance(res.walletAddress) }
  }

  const releaseKey = `release:${holdKey}`
  if (getLedgerByIdempotencyKey(releaseKey)) {
    updateCreditReservation(documentId, { status: 'released', resolvedAt: Date.now() })
    return { released: false, balance: getCreditBalance(res.walletAddress) }
  }

  const { balance } = applyCreditDelta({
    id: uuid(),
    walletAddress: res.walletAddress,
    delta: 1,
    kind: 'refund_release',
    idempotencyKey: releaseKey,
    refDocumentId: documentId,
    meta: reason ? JSON.stringify({ reason }) : null,
  })
  updateCreditReservation(documentId, { status: 'released', resolvedAt: Date.now() })
  return { released: true, balance }
}

export function setReservationServiceTx(documentId: string, txHash: string): void {
  updateCreditReservation(documentId, { serviceTxHash: txHash })
}

export function creditReservationAllowsMinimalProof(documentId: string): boolean {
  return hasActiveCreditReservation(documentId)
}

export function mintCreditsFromNimTopup(input: {
  walletAddress: string
  credits: number
  txHash: string
  nimLuna: number
}): { balance: number; created: boolean; entry: CreditLedgerEntry } {
  assertCreditsEnabled()
  const cleanHash = input.txHash.replace(/^0x/i, '').toLowerCase()
  return applyCreditDelta({
    id: uuid(),
    walletAddress: input.walletAddress,
    delta: input.credits,
    kind: 'topup_nim',
    idempotencyKey: `topup_nim:${cleanHash}`,
    refTxHash: cleanHash,
    nimLuna: input.nimLuna,
    feeNimAtEvent: getSealFeeNim(),
  })
}

export function mintCreditsFromStripe(input: {
  walletAddress: string
  credits: number
  sessionId: string
  paymentIntentId?: string | null
  usdCents: number
  feeNim: number
  nimUsd: number
}): { balance: number; created: boolean; entry: CreditLedgerEntry } {
  assertCreditsEnabled()
  return applyCreditDelta({
    id: uuid(),
    walletAddress: input.walletAddress,
    delta: input.credits,
    kind: 'topup_stripe',
    idempotencyKey: `topup_stripe:${input.sessionId}`,
    refStripeSessionId: input.sessionId,
    refStripePaymentIntent: input.paymentIntentId ?? null,
    usdCents: input.usdCents,
    feeNimAtEvent: input.feeNim,
    nimUsdAtEvent: input.nimUsd,
  })
}

/**
 * Claw back up to `credits` after refund/dispute. Flags account if shortfall.
 */
export function clawbackStripeCredits(input: {
  walletAddress: string
  credits: number
  chargeOrSessionId: string
  reason: string
}): { clawed: number; balance: number; shortfall: number; flagged: boolean } {
  const wallet = normalizeAddress(input.walletAddress)
  const want = Math.max(0, Math.floor(input.credits))
  const key = `clawback:${input.chargeOrSessionId}`
  const existing = getLedgerByIdempotencyKey(key)
  if (existing) {
    return {
      clawed: Math.abs(existing.delta),
      balance: getCreditBalance(wallet),
      shortfall: 0,
      flagged: isCreditAccountFlagged(wallet),
    }
  }

  const available = getCreditBalance(wallet)
  const clawed = Math.min(available, want)
  const shortfall = want - clawed

  if (clawed > 0) {
    applyCreditDelta({
      id: uuid(),
      walletAddress: wallet,
      delta: -clawed,
      kind: 'stripe_clawback',
      idempotencyKey: key,
      meta: JSON.stringify({ reason: input.reason, requested: want, shortfall }),
    })
  }

  let flagged = isCreditAccountFlagged(wallet)
  if (shortfall > 0 || (want > 0 && clawed === 0)) {
    setCreditAccountFlagged(wallet, true)
    flagged = true
  }

  return { clawed, balance: getCreditBalance(wallet), shortfall, flagged }
}
