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
  getStripeCheckoutSession,
  isCreditAccountFlagged,
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
} {
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    updateStripeCheckoutStatus(session.id, session.payment_status ?? 'unpaid')
    return { minted: false }
  }

  const walletRaw = session.metadata?.walletAddress || session.client_reference_id
  if (!walletRaw) {
    console.error('[stripe] checkout session missing wallet metadata', session.id)
    return { minted: false }
  }
  const wallet = normalizeAddress(walletRaw)
  const credits = Number.parseInt(session.metadata?.credits ?? '', 10)
  if (!Number.isFinite(credits) || credits < 1) {
    console.error('[stripe] checkout session missing credits metadata', session.id)
    return { minted: false }
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
  return { minted: created, balance, credits }
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
