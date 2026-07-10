import Stripe from 'stripe'
import { normalizeAddress } from './addresses.js'
import {
  assertStripePackQuote,
  clawbackStripeCredits,
  mintCreditsFromStripe,
  quoteCredits,
} from './credits.js'
import { isStripeCreditsEnabled } from './creditsConfig.js'
import {
  getCreditBalance,
  getStripeCheckoutSession,
  isCreditAccountFlagged,
  listPendingStripeCheckoutsForWallet,
  updateStripeCheckoutStatus,
  upsertStripeCheckoutSession,
} from './db.js'

let stripeClient: Stripe | null = null

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  if (!stripeClient) {
    // Use account-default API version from the SDK package.
    stripeClient = new Stripe(key)
  }
  return stripeClient
}

function publicAppUrl(): string {
  const url = process.env.PUBLIC_APP_URL?.trim() || process.env.CORS_ORIGIN?.split(',')[0]?.trim()
  if (!url || url === '*') {
    return 'http://localhost:5176'
  }
  return url.replace(/\/$/, '')
}

/**
 * Card-statement suffix (appears after account prefix, e.g. YOURCO*VERILOCK).
 * Stripe allows up to 22 chars; strip characters banks reject.
 * Override with STRIPE_STATEMENT_DESCRIPTOR_SUFFIX (empty disables).
 */
export function stripeStatementDescriptorSuffix(): string | null {
  if (process.env.STRIPE_STATEMENT_DESCRIPTOR_SUFFIX !== undefined) {
    const raw = process.env.STRIPE_STATEMENT_DESCRIPTOR_SUFFIX.trim()
    if (!raw) return null
    return sanitizeStatementDescriptorSuffix(raw)
  }
  return sanitizeStatementDescriptorSuffix('VERILOCK')
}

function sanitizeStatementDescriptorSuffix(value: string): string {
  // Stripe: letters, numbers, spaces; no < > \ ' " *. Max 22.
  const cleaned = value
    .toUpperCase()
    .replace(/[<>\\'\"*]/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 22)
  return cleaned || 'VERILOCK'
}

export async function createCreditsCheckoutSession(input: {
  walletAddress: string
  credits: number
}): Promise<{ url: string; sessionId: string; quote: Awaited<ReturnType<typeof quoteCredits>> }> {
  if (!isStripeCreditsEnabled()) {
    throw new Error('Card purchases are not enabled')
  }

  const wallet = normalizeAddress(input.walletAddress)
  if (isCreditAccountFlagged(wallet)) {
    throw new Error('Card purchases are temporarily unavailable for this wallet')
  }

  const credits = Math.floor(Number(input.credits))
  const quote = await assertStripePackQuote(credits)
  if (quote.pricesStale) {
    throw new Error('NIM price quote is stale; try again in a moment')
  }

  const stripe = getStripe()
  const appUrl = publicAppUrl()
  const now = Date.now()
  const statementSuffix = stripeStatementDescriptorSuffix()

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      success_url: `${appUrl}/?credits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/?credits=cancel`,
      client_reference_id: wallet,
      metadata: {
        walletAddress: wallet,
        credits: String(credits),
        pack: String(credits),
        feeNim: String(quote.feeNim),
        nimUsd: String(quote.nimUsd),
        unitUsdCents: String(quote.unitUsdCents),
        totalUsdCents: String(quote.totalUsdCents),
        markup: String(quote.stripeMarkup),
        pricingVersion: '3-packs-min',
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: quote.totalUsdCents,
            product_data: {
              name: `VeriLock ${credits}-credit pack`,
              description: `${credits} seal credits · 1 credit = 1 document seal`,
            },
          },
        },
      ],
      // Card/Apple Pay bank line: {account_prefix}*VERILOCK (account prefix set in Dashboard).
      payment_intent_data: {
        description: `VeriLock ${credits}-credit pack`,
        ...(statementSuffix
          ? { statement_descriptor_suffix: statementSuffix }
          : {}),
      },
    },
    {
      idempotencyKey: `credits-pack:${wallet}:${credits}:${quote.totalUsdCents}:${Math.floor(now / 60_000)}`,
    },
  )

  if (!session.url) {
    throw new Error('Stripe did not return a checkout URL')
  }

  upsertStripeCheckoutSession({
    sessionId: session.id,
    walletAddress: wallet,
    credits,
    usdCents: quote.totalUsdCents,
    unitUsdCents: quote.unitUsdCents,
    feeNim: quote.feeNim,
    nimUsd: quote.nimUsd,
    markup: quote.stripeMarkup,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  })

  return { url: session.url, sessionId: session.id, quote }
}

function paymentIntentIdFromSession(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent
  if (!pi) return null
  return typeof pi === 'string' ? pi : pi.id
}

export function mintFromCheckoutSession(session: Stripe.Checkout.Session): {
  minted: boolean
  balance?: number
  credits?: number
  walletAddress?: string
  paymentStatus?: string
} {
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    updateStripeCheckoutStatus(session.id, session.payment_status ?? 'unpaid')
    return { minted: false, paymentStatus: session.payment_status ?? 'unpaid' }
  }

  const walletRaw = session.metadata?.walletAddress || session.client_reference_id
  if (!walletRaw) {
    console.error('[stripe] checkout session missing wallet metadata', session.id)
    return { minted: false, paymentStatus: session.payment_status }
  }
  const wallet = normalizeAddress(walletRaw)
  const credits = Number.parseInt(session.metadata?.credits ?? '', 10)
  if (!Number.isFinite(credits) || credits < 1) {
    console.error('[stripe] checkout session missing credits metadata', session.id)
    return { minted: false, walletAddress: wallet, paymentStatus: session.payment_status }
  }

  const feeNim = Number(session.metadata?.feeNim ?? 0)
  const nimUsd = Number(session.metadata?.nimUsd ?? 0)
  const usdCents =
    typeof session.amount_total === 'number' && session.amount_total > 0
      ? session.amount_total
      : Number(session.metadata?.unitUsdCents ?? 0) * credits

  const { balance, created } = mintCreditsFromStripe({
    walletAddress: wallet,
    credits,
    sessionId: session.id,
    paymentIntentId: paymentIntentIdFromSession(session),
    usdCents,
    feeNim: Number.isFinite(feeNim) ? feeNim : 0,
    nimUsd: Number.isFinite(nimUsd) ? nimUsd : 0,
  })

  updateStripeCheckoutStatus(session.id, 'paid')
  return {
    minted: created,
    balance,
    credits,
    walletAddress: wallet,
    paymentStatus: session.payment_status,
  }
}

/**
 * Client return-path fulfillment (success_url). Mirrors NIM claim:
 * re-fetch Checkout Session from Stripe and mint if paid.
 * Idempotent via ledger key topup_stripe:{sessionId}.
 */
export async function confirmCreditsCheckoutSession(input: {
  sessionId: string
  walletAddress: string
}): Promise<{
  balance: number
  creditsMinted: number
  alreadyClaimed: boolean
  paid: boolean
  sessionId: string
}> {
  if (!isStripeCreditsEnabled()) {
    throw new Error('Card purchases are not enabled')
  }

  const sessionId = input.sessionId.trim()
  if (!sessionId.startsWith('cs_')) {
    throw new Error('Invalid checkout session id')
  }

  const wallet = normalizeAddress(input.walletAddress)
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(sessionId)

  const sessionWalletRaw = session.metadata?.walletAddress || session.client_reference_id
  if (!sessionWalletRaw) {
    throw new Error('Checkout session is missing wallet metadata')
  }
  if (normalizeAddress(sessionWalletRaw) !== wallet) {
    throw new Error('Checkout session does not belong to this wallet')
  }

  const local = getStripeCheckoutSession(sessionId)
  if (!local) {
    // Session may predate a DB wipe or another instance; still mint from Stripe metadata.
    const credits = Number.parseInt(session.metadata?.credits ?? '', 10) || 0
    if (credits >= 1) {
      upsertStripeCheckoutSession({
        sessionId: session.id,
        walletAddress: wallet,
        credits,
        usdCents: session.amount_total ?? 0,
        unitUsdCents: Number(session.metadata?.unitUsdCents ?? 0) || 0,
        feeNim: Number(session.metadata?.feeNim ?? 0) || 0,
        nimUsd: Number(session.metadata?.nimUsd ?? 0) || 0,
        markup: Number(session.metadata?.markup ?? 0) || 0,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
  }

  const result = mintFromCheckoutSession(session)
  const balance = result.balance ?? getCreditBalance(wallet)
  const creditsMinted = result.credits ?? 0
  const paid =
    session.payment_status === 'paid' || session.payment_status === 'no_payment_required'

  if (!paid) {
    return {
      balance,
      creditsMinted: 0,
      alreadyClaimed: false,
      paid: false,
      sessionId,
    }
  }

  return {
    balance,
    creditsMinted: result.minted ? creditsMinted : 0,
    alreadyClaimed: !result.minted,
    paid: true,
    sessionId,
  }
}

/**
 * Recover paid-but-unminted packs when the user returns without session_id
 * (or webhook never arrived). Checks local pending rows against Stripe.
 */
export async function syncPendingStripeCheckoutsForWallet(walletAddress: string): Promise<{
  balance: number
  mintedTotal: number
  sessions: Array<{ sessionId: string; creditsMinted: number; alreadyClaimed: boolean; paid: boolean }>
}> {
  if (!isStripeCreditsEnabled()) {
    const wallet = normalizeAddress(walletAddress)
    return { balance: getCreditBalance(wallet), mintedTotal: 0, sessions: [] }
  }

  const wallet = normalizeAddress(walletAddress)
  const pending = listPendingStripeCheckoutsForWallet(wallet, 10)
  const sessions: Array<{
    sessionId: string
    creditsMinted: number
    alreadyClaimed: boolean
    paid: boolean
  }> = []
  let mintedTotal = 0

  for (const row of pending) {
    try {
      const confirmed = await confirmCreditsCheckoutSession({
        sessionId: row.sessionId,
        walletAddress: wallet,
      })
      if (confirmed.creditsMinted > 0) mintedTotal += confirmed.creditsMinted
      sessions.push({
        sessionId: confirmed.sessionId,
        creditsMinted: confirmed.creditsMinted,
        alreadyClaimed: confirmed.alreadyClaimed,
        paid: confirmed.paid,
      })
    } catch (err) {
      console.warn('[stripe] pending sync failed', {
        sessionId: row.sessionId,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { balance: getCreditBalance(wallet), mintedTotal, sessions }
}

export async function handleStripeWebhook(
  rawBody: Buffer,
  signature: string | undefined,
): Promise<{ received: true }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured')
  if (!signature) throw new Error('Missing Stripe-Signature header')

  const stripe = getStripe()
  const event = stripe.webhooks.constructEvent(rawBody, signature, secret)

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const session = event.data.object as Stripe.Checkout.Session
      const result = mintFromCheckoutSession(session)
      console.log('[stripe] checkout mint', {
        type: event.type,
        sessionId: session.id,
        ...result,
      })
      break
    }
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session
      updateStripeCheckoutStatus(session.id, 'failed')
      break
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge
      await clawbackFromCharge(stripe, charge, 'charge.refunded')
      break
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object as Stripe.Dispute
      const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id
      if (chargeId) {
        const charge = await stripe.charges.retrieve(chargeId)
        await clawbackFromCharge(stripe, charge, 'charge.dispute.created')
      }
      break
    }
    default:
      break
  }

  return { received: true }
}

async function clawbackFromCharge(
  stripe: Stripe,
  charge: Stripe.Charge,
  reason: string,
): Promise<void> {
  // Prefer checkout session metadata via payment_intent
  let wallet: string | null = null
  let credits = 0
  let sessionId: string | null = null

  const piId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id

  if (piId) {
    const sessions = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 })
    const session = sessions.data[0]
    if (session) {
      sessionId = session.id
      wallet = session.metadata?.walletAddress || session.client_reference_id || null
      credits = Number.parseInt(session.metadata?.credits ?? '', 10) || 0
      const local = getStripeCheckoutSession(session.id)
      if (local && credits < 1) credits = local.credits
    }
  }

  if (!wallet || credits < 1) {
    console.warn('[stripe] clawback skipped — could not resolve credits', {
      chargeId: charge.id,
      reason,
    })
    return
  }

  const result = clawbackStripeCredits({
    walletAddress: wallet,
    credits,
    chargeOrSessionId: sessionId ?? charge.id,
    reason,
  })
  console.log('[stripe] clawback', { chargeId: charge.id, wallet, credits, ...result })
}
