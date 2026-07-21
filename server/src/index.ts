import { loadEnvFile } from './loadEnv.js'
loadEnvFile()

console.log('[seal] boot', {
  node: process.version,
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  dataDir: process.env.DATA_DIR,
})

import express from 'express'
import cors from 'cors'
import { existsSync } from 'node:fs'
import { v4 as uuid } from 'uuid'
import { publicKeyBindingResult } from './auth-wallet.js'
import { normalizeAddress } from './addresses.js'
import {
  createSession,
  findDocumentsByHash,
  getSession,
  getSignatureForDocument,
  getSignatureImage,
  markSessionVerified,
} from './db.js'
import {
  addSignature,
  assertSealBroadcastAllowed,
  beginLock,
  configureDocumentCosigners,
  configureSigningRoster,
  createDocument,
  deleteDocument,
  getDocumentPublic,
  getMyDocuments,
  prepareLock,
  setCreatorNotifyEmail,
  viewerMayAccessSignatureImage,
} from './documents.js'
import { emailFeaturesPublic } from './email/config.js'
import { sendPartyInviteEmail } from './email/inviteSigner.js'
import { verifyHubSignedMessage } from './hub-signature.js'
import { rateLimit } from './rate-limit.js'
import {
  clientIpFromRequest,
  deliverSupportContact,
  sanitizeSupportContact,
  supportContactPublicFeatures,
  verifyTurnstileToken,
  type SupportContactBody,
} from './supportContact.js'
import {
  annotationsForPublic,
  getStreamByHash,
  isAnnotationStreamBroadcastEnabled,
  publishAnnotationStream,
  reconstructFromStoredOrChain,
} from './annotationStream.js'
import {
  appendFillBatch,
  getPlanPublic,
  lockPlan as lockPlacementPlan,
  saveDraftPlan,
  unlockPlan as unlockPlacementPlan,
} from './placementPlans.js'
import {
  isPdfAnnotationUiEnabled,
  pdfAnnotationFeaturesPublic,
} from './pdfAnnotationConfig.js'
import { isServiceWalletConfigured } from './serviceWallet.js'
import { broadcastRawTransaction, normalizeRawTransactionHex, verifySignature } from './nimiq-rpc.js'
import {
  assertSafeBootConfig,
  resolveCorsOrigin,
  sanitizeDisplayName,
  sanitizeNotifyEmail,
} from './security.js'
import { buildCertificate } from './certificate.js'
import { hashSignatureImage, parseSignatureImageBase64 } from './signature-image.js'
import { getClientDistDir, getDataDir, getDatabasePath } from './paths.js'
import { attachClientStatic } from './static.js'
import {
  getAttestationStatus,
  resolveAttestation,
  startAttestationPoller,
  submitAttestation,
} from './attestations.js'
import { applySecurityHeaders } from './http-headers.js'
import { getNimPrices } from './nimPrices.js'
import { getWalletBalanceLuna } from './nimiq-rpc.js'
import { getMinimumSealBalanceLuna, getSealPricing, hasSufficientSealBalance } from './sealPricing.js'
import { startSessionCleanup } from './session-cleanup.js'
import { attachLocalStudios } from './localStudios.js'
import * as sigHandoff from './sigHandoff.js'

assertSafeBootConfig()

const PORT = Number(process.env.PORT ?? 3002)
const HOST = process.env.HOST ?? '0.0.0.0'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CORS_ORIGIN = resolveCorsOrigin()
const SKIP_CHAIN_VERIFY = process.env.SKIP_CHAIN_VERIFY === 'true'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const app = express()
applySecurityHeaders(app)
app.use(cors({ origin: CORS_ORIGIN }))

// Stripe webhooks need the raw body for signature verification — register before json parser.
const stripeWebhookLimit = rateLimit(60, 60_000)
app.post(
  '/api/stripe/webhook',
  stripeWebhookLimit,
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const { handleStripeWebhook } = await import('./stripeCredits.js')
      const signature = req.headers['stripe-signature']
      const sig = Array.isArray(signature) ? signature[0] : signature
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '')
      const result = await handleStripeWebhook(rawBody, sig)
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Webhook error'
      console.error('[stripe] webhook', message)
      res.status(400).json({ error: message })
    }
  },
)

app.use(express.json({ limit: '2mb' }))

const authChallengeLimit = rateLimit(12, 60_000)
const authVerifyLimit = rateLimit(24, 60_000)
const docLimit = rateLimit(30, 60_000)
const attestLimit = rateLimit(24, 60_000)
const walletBalanceLimit = rateLimit(30, 60_000)
/** Mutations / checkout — keep tight. */
const creditsLimit = rateLimit(30, 60_000)
/** Cheap SQLite balance reads — header + panel may both load. */
const creditsBalanceLimit = rateLimit(120, 60_000)
const publicReadLimit = rateLimit(60, 60_000)
/** Multi-tx annotation stream broadcast — tight (service wallet cost). */
const annotationStreamLimit = rateLimit(6, 60_000)
// Hash verify is read-only and easy to double-fire from UI retries; allow a higher burst.
const verifyHashLimit = rateLimit(60, 60_000)
/** Public contact form — tight limit against spam floods. */
const supportContactLimit = rateLimit(5, 15 * 60_000)
/** Per-person invite emails via Resend. */
const inviteEmailLimit = rateLimit(12, 60_000)

function lockErrorStatus(message: string): number {
  if (message === 'Only the creator can seal this agreement') return 403
  if (message === 'Document not found') return 404
  return 400
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) {
    res.status(401).json({ error: 'Missing session token' })
    return
  }
  const session = getSession(token)
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }
  res.locals.address = session.address
  res.locals.token = token
  next()
}

/**
 * Optional session for public reads — never 401s.
 * Only returns an address for a *verified* wallet login (challenge alone is not enough),
 * so private fields (names, ink images, placement fill frames) cannot be unlocked by
 * POSTing /auth/challenge as a public creator/signer address.
 * When SKIP_CHAIN_VERIFY is on (non-production only), any live session counts.
 */
function optionalViewerAddress(req: express.Request): string | null {
  const token = req.headers.authorization?.replace('Bearer ', '')?.trim()
  if (!token) return null
  const session = getSession(token)
  if (!session) return null
  if (!session.verified && !SKIP_CHAIN_VERIFY) return null
  return session.address
}

function requireVerifiedWallet(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (!SKIP_CHAIN_VERIFY) {
    const session = getSession(res.locals.token as string)
    if (!session?.verified) {
      res.status(401).json({ error: 'Wallet signature not verified. Complete login first.' })
      return
    }
  }
  next()
}

app.get('/api/health', (_req, res) => {
  if (IS_PRODUCTION) {
    res.json({ ok: true })
    return
  }
  res.json({
    ok: true,
    app: 'verilock',
    chainVerify: !SKIP_CHAIN_VERIFY,
    production: IS_PRODUCTION,
    dataDir: getDataDir(),
    database: getDatabasePath(),
    storageMode: 'hash-only',
    clientBundled: existsSync(`${getClientDistDir()}/index.html`),
  })
})

app.get('/api/seal-pricing', (_req, res) => {
  res.json(getSealPricing())
})

app.get('/api/nim-prices', async (_req, res) => {
  try {
    const prices = await getNimPrices()
    res.json(prices)
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Could not fetch NIM prices',
    })
  }
})

app.get('/api/wallet-balance', authMiddleware, requireVerifiedWallet, walletBalanceLimit, async (_req, res) => {
  try {
    const address = res.locals.address as string
    const balanceLuna = await getWalletBalanceLuna(address)
    const requiredLuna = getMinimumSealBalanceLuna()
    res.json({
      address,
      balanceLuna,
      requiredLuna,
      sufficient: hasSufficientSealBalance(balanceLuna),
    })
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Could not fetch wallet balance',
    })
  }
})

// ── Credits ────────────────────────────────────────────────────────────────

app.get('/api/credits/config', creditsLimit, (_req, res) => {
  void import('./credits.js').then(({ getCreditsPublicConfig }) => {
    res.json(getCreditsPublicConfig())
  })
})

app.get('/api/credits/balance', authMiddleware, requireVerifiedWallet, creditsBalanceLimit, async (req, res) => {
  try {
    const { getBalanceForWallet, getCreditsPublicConfig } = await import('./credits.js')
    const address = res.locals.address as string
    // Optional recovery: ?syncStripe=1 re-checks pending Checkout Sessions with Stripe
    // (covers missing webhooks / lost success_url). Cheap no-op when nothing pending.
    const sync =
      req.query.syncStripe === '1' ||
      req.query.syncStripe === 'true' ||
      req.query.sync === '1'
    let stripeSynced: { mintedTotal: number } | undefined
    if (sync) {
      try {
        const { syncPendingStripeCheckoutsForWallet } = await import('./stripeCredits.js')
        const result = await syncPendingStripeCheckoutsForWallet(address)
        if (result.mintedTotal > 0) {
          console.log('[stripe] balance sync minted', {
            wallet: address,
            mintedTotal: result.mintedTotal,
            sessions: result.sessions.length,
          })
        }
        stripeSynced = { mintedTotal: result.mintedTotal }
      } catch (err) {
        console.warn(
          '[stripe] balance sync skipped',
          err instanceof Error ? err.message : String(err),
        )
      }
    }
    res.json({
      ...getBalanceForWallet(address),
      ...getCreditsPublicConfig(),
      ...(stripeSynced ? { stripeSynced } : {}),
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not load credits' })
  }
})

app.get('/api/credits/quote', creditsLimit, async (req, res) => {
  try {
    const { quoteCredits, quoteCreditPacks } = await import('./credits.js')
    if (req.query.packs === '1' || req.query.packs === 'true') {
      const catalog = await quoteCreditPacks()
      res.json(catalog)
      return
    }
    const credits = Number(req.query.credits ?? 10)
    const quote = await quoteCredits(credits)
    res.json(quote)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Quote failed' })
  }
})

app.get('/api/credits/ledger', authMiddleware, requireVerifiedWallet, creditsLimit, async (req, res) => {
  try {
    const { getLedgerForWallet } = await import('./credits.js')
    const address = res.locals.address as string
    const limit = Number(req.query.limit ?? 50)
    res.json({ entries: getLedgerForWallet(address, limit) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Ledger failed' })
  }
})

app.post(
  '/api/credits/topups/nim',
  authMiddleware,
  requireVerifiedWallet,
  creditsLimit,
  async (req, res) => {
    try {
      const { claimNimCreditTopup } = await import('./creditTopup.js')
      const { txHash } = req.body as { txHash?: string }
      if (!txHash?.trim()) {
        res.status(400).json({ error: 'txHash required' })
        return
      }
      const address = res.locals.address as string
      const result = await claimNimCreditTopup(txHash, address)
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Top-up claim failed'
      res.status(lockErrorStatus(message)).json({ error: message })
    }
  },
)

app.get('/api/credits/topup-payload', creditsLimit, async (_req, res) => {
  try {
    const { buildTopupPayloadHex } = await import('./creditTopup.js')
    const { getSealFeeLuna, getSealFeeNim, getSealPricing } = await import('./sealPricing.js')
    const { getExpectedAttestationRecipient } = await import('./nimiq-rpc.js')
    res.json({
      payloadHex: buildTopupPayloadHex(),
      recipient: getExpectedAttestationRecipient(),
      feeNim: getSealFeeNim(),
      feeLuna: getSealFeeLuna(),
      pricing: getSealPricing(),
    })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Top-up info failed' })
  }
})

app.post(
  '/api/credits/checkout',
  authMiddleware,
  requireVerifiedWallet,
  creditsLimit,
  async (req, res) => {
    try {
      const { createCreditsCheckoutSession } = await import('./stripeCredits.js')
      const { credits } = req.body as { credits?: number }
      const address = res.locals.address as string
      const result = await createCreditsCheckoutSession({
        walletAddress: address,
        credits: credits ?? 1,
      })
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed'
      res.status(400).json({ error: message })
    }
  },
)

/**
 * Fulfill Stripe Checkout after success_url redirect (and recovery if webhook missed).
 * Body: { sessionId: "cs_..." }. Idempotent.
 */
app.post(
  '/api/credits/checkout/confirm',
  authMiddleware,
  requireVerifiedWallet,
  creditsLimit,
  async (req, res) => {
    try {
      const { confirmCreditsCheckoutSession } = await import('./stripeCredits.js')
      const { sessionId } = req.body as { sessionId?: string }
      if (!sessionId?.trim()) {
        res.status(400).json({ error: 'sessionId required' })
        return
      }
      const address = res.locals.address as string
      const result = await confirmCreditsCheckoutSession({
        sessionId: sessionId.trim(),
        walletAddress: address,
      })
      if (!result.paid) {
        res.status(402).json({
          error: 'Payment not completed yet',
          ...result,
        })
        return
      }
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout confirm failed'
      res.status(400).json({ error: message })
    }
  },
)

app.post(
  '/api/documents/:id/pay-with-credit',
  attestLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    try {
      const { payWithCreditAndSeal } = await import('./payWithCredit.js')
      const { finalSha256 } = req.body as { finalSha256?: string }
      const address = res.locals.address as string
      const result = await payWithCreditAndSeal(routeParam(req.params.id), address, finalSha256)
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pay with credit failed'
      res.status(lockErrorStatus(message)).json({ error: message })
    }
  },
)

app.post('/api/auth/challenge', authChallengeLimit, (req, res) => {
  const { address } = req.body as { address?: string }
  if (!address) {
    res.status(400).json({ error: 'Address required' })
    return
  }
  const normalized = normalizeAddress(address)
  const nonce = `VeriLock sign-in:${uuid()}:${Date.now()}`
  const token = uuid()
  createSession(token, normalized, nonce, SESSION_TTL_MS)
  res.json({ token, nonce, address: normalized })
})

app.post('/api/auth/verify', authVerifyLimit, authMiddleware, async (req, res) => {
  const { publicKey, signature, authScheme } = req.body as {
    publicKey?: string
    signature?: string
    authScheme?: 'hub' | 'pay'
  }
  if (!publicKey || !signature) {
    res.status(400).json({ error: 'publicKey and signature required' })
    return
  }

  const token = res.locals.token as string
  const session = getSession(token)
  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return
  }

  if (session.verified) {
    res.json({ ok: true, address: session.address, verified: true })
    return
  }

  try {
    const valid = SKIP_CHAIN_VERIFY
      ? true
      : authScheme === 'hub'
        ? verifyHubSignedMessage(session.nonce, publicKey, signature)
        : await verifySignature(session.nonce, publicKey, signature, false)
    if (!valid) {
      res.status(401).json({ error: 'Invalid signature' })
      return
    }
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Signature verification failed',
    })
    return
  }

  const binding = publicKeyBindingResult(publicKey, session.address)
  if (binding === 'mismatch') {
    res.status(401).json({ error: 'Public key does not match the wallet address for this session' })
    return
  }
  if (binding === 'invalid' && !SKIP_CHAIN_VERIFY) {
    res.status(401).json({ error: 'Invalid public key' })
    return
  }

  markSessionVerified(token, publicKey)
  res.json({ ok: true, address: session.address, verified: true })
})

app.get('/api/me', authMiddleware, (req, res) => {
  const address = res.locals.address as string
  res.json({ address, documents: getMyDocuments(address) })
})

app.get('/api/features', (_req, res) => {
  res.json({
    ...emailFeaturesPublic(),
    ...supportContactPublicFeatures(),
    ...pdfAnnotationFeaturesPublic(),
  })
})

app.post('/api/support/contact', supportContactLimit, async (req, res) => {
  const body = (req.body ?? {}) as SupportContactBody
  const sanitized = sanitizeSupportContact(body)

  if (!sanitized.ok) {
    if ('silent' in sanitized && sanitized.silent) {
      // Honeypot / too-fast bots: fake success so scrapers don't learn the rules.
      res.json({ ok: true })
      return
    }
    if ('error' in sanitized) {
      res.status(sanitized.status).json({ error: sanitized.error })
      return
    }
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  const remoteIp = clientIpFromRequest(req)
  const turnstile = await verifyTurnstileToken(sanitized.turnstileToken, remoteIp)
  if (!turnstile.ok) {
    res.status(400).json({ error: turnstile.error })
    return
  }

  const delivered = await deliverSupportContact({
    name: sanitized.name,
    email: sanitized.email,
    subject: sanitized.subject,
    message: sanitized.message,
  })

  if (!delivered.ok) {
    res.status(delivered.status).json({ error: delivered.error })
    return
  }

  res.json({ ok: true })
})

app.post('/api/documents', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const body = req.body as {
    title?: string
    originalFileName?: string
    type?: string
    originalSha256?: string
    pageCount?: number
    metadata?: Record<string, unknown>
    parties?: Array<{ role: string; displayName: string; walletAddress?: string; required?: boolean }>
    requiredSignatures?: number
    creatorRole?: string
    creatorDisplayName?: string
    creatorNotifyEmail?: string
    /** Client PDF overlays only — never PDF file bytes. */
    annotations?: unknown
  }

  if (!body.originalSha256 || !/^[a-f0-9]{64}$/i.test(body.originalSha256)) {
    res.status(400).json({ error: 'Valid originalSha256 required' })
    return
  }

  // Reject accidental PDF byte fields (privacy: file never uploaded).
  const pdfByteKeys = ['pdf', 'pdfBytes', 'file', 'fileBytes', 'documentBytes', 'content'] as const
  for (const key of pdfByteKeys) {
    if (key in body && (body as Record<string, unknown>)[key] != null) {
      res.status(400).json({ error: 'PDF file bytes are not accepted — send hash + annotations only' })
      return
    }
  }

  const address = res.locals.address as string

  const isDirect = (body.requiredSignatures ?? 2) === 0
  if (!body.creatorDisplayName?.trim() && !isDirect) {
    res.status(400).json({ error: 'Your name is required' })
    return
  }

  let creatorNotifyEmail: string | null = null
  try {
    creatorNotifyEmail = sanitizeNotifyEmail(body.creatorNotifyEmail)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid email' })
    return
  }

  try {
    const { document: doc, hashWarning } = createDocument({
      title: body.title ?? 'Untitled agreement',
      originalFileName: body.originalFileName,
      type: body.type ?? 'rental',
      creatorAddress: address,
      creatorRole: body.creatorRole,
      creatorDisplayName: body.creatorDisplayName,
      originalSha256: body.originalSha256,
      pageCount: Number(body.pageCount ?? 1),
      metadata: body.metadata,
      parties: body.parties,
      requiredSignatures: body.requiredSignatures,
      creatorNotifyEmail,
      annotations: body.annotations,
    })

    res.status(201).json({ document: doc, ...(hashWarning ? { hashWarning } : {}) })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Create failed'
    res.status(400).json({ error: message })
  }
})

/**
 * Creator-only: rebuild parties from construction people.
 * Body: { parties: [{ displayName, role? }], creatorSignsAsIndex: number | null }
 */
app.put(
  '/api/documents/:id/signing-roster',
  docLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const body = req.body as {
      parties?: Array<{ displayName?: string; role?: string; walletAddress?: string | null }>
      creatorSignsAsIndex?: number | null
    }
    const address = res.locals.address as string
    try {
      const parties = Array.isArray(body.parties)
        ? body.parties.map(p => ({
            displayName: typeof p?.displayName === 'string' ? p.displayName : '',
            role: typeof p?.role === 'string' ? p.role : undefined,
            walletAddress:
              typeof p?.walletAddress === 'string'
                ? p.walletAddress
                : p?.walletAddress === null
                  ? null
                  : undefined,
          }))
        : []
      const creatorSignsAsIndex =
        body.creatorSignsAsIndex === null || body.creatorSignsAsIndex === undefined
          ? null
          : Number(body.creatorSignsAsIndex)
      const document = configureSigningRoster(routeParam(req.params.id), address, {
        parties,
        creatorSignsAsIndex: Number.isFinite(creatorSignsAsIndex as number)
          ? (creatorSignsAsIndex as number)
          : null,
      })
      res.json({ document })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed'
      const status =
        message === 'Document not found'
          ? 404
          : message.includes('Only the creator')
            ? 403
            : 400
      res.status(status).json({ error: message })
    }
  },
)

/** Creator-only: set total required signatures + optional co-signer names (share step). */
app.patch(
  '/api/documents/:id/cosigners',
  docLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const body = req.body as {
      requiredSignatures?: number
      coSignerNames?: string[]
    }
    const address = res.locals.address as string
    if (
      body.requiredSignatures == null ||
      !Number.isFinite(body.requiredSignatures) ||
      body.requiredSignatures < 1 ||
      body.requiredSignatures > 10
    ) {
      res.status(400).json({ error: 'requiredSignatures must be between 1 and 10' })
      return
    }
    try {
      const document = configureDocumentCosigners(routeParam(req.params.id), address, {
        requiredSignatures: Math.floor(body.requiredSignatures),
        coSignerNames: Array.isArray(body.coSignerNames)
          ? body.coSignerNames.map(n => (typeof n === 'string' ? n : ''))
          : undefined,
      })
      res.json({ document })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed'
      const status =
        message === 'Document not found'
          ? 404
          : message.includes('Only the creator')
            ? 403
            : 400
      res.status(status).json({ error: message })
    }
  },
)

/** Creator-only: set/clear optional ready-to-seal notification email. */
app.patch(
  '/api/documents/:id/notify-email',
  docLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const body = req.body as { email?: string | null }
    const address = res.locals.address as string
    try {
      const email = sanitizeNotifyEmail(body.email ?? null)
      setCreatorNotifyEmail(routeParam(req.params.id), address, email)
      res.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Update failed'
      const status =
        message === 'Only the creator can modify this agreement' ||
        message.includes('Only the creator')
          ? 403
          : message === 'Document not found'
            ? 404
            : 400
      res.status(status).json({ error: message })
    }
  },
)

/**
 * Creator-only: email one party a branded invite with their personal ?party= link.
 * Never attaches the PDF.
 */
app.post(
  '/api/documents/:id/invite-email',
  inviteEmailLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    const body = req.body as { partyId?: string; to?: string }
    const address = res.locals.address as string
    if (!body.partyId || typeof body.partyId !== 'string') {
      res.status(400).json({ error: 'partyId required' })
      return
    }
    const result = await sendPartyInviteEmail({
      documentId: routeParam(req.params.id),
      creatorAddress: address,
      partyId: body.partyId.trim(),
      to: typeof body.to === 'string' ? body.to : '',
    })
    if (!result.ok) {
      res.status(result.status).json({ error: result.error })
      return
    }
    res.status(201).json({
      ok: true,
      id: result.id,
      to: result.to,
      partyId: result.partyId,
    })
  },
)

app.get('/api/documents/:id', publicReadLimit, (req, res) => {
  const viewer = optionalViewerAddress(req)
  const doc = getDocumentPublic(routeParam(req.params.id), viewer)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({ document: doc })
})

app.delete('/api/documents/:id', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const address = res.locals.address as string
  try {
    deleteDocument(routeParam(req.params.id), address)
    res.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed'
    const status =
      message === 'Only the creator can delete this agreement' ? 403 : message === 'Document not found' ? 404 : 400
    res.status(status).json({ error: message })
  }
})

app.post('/api/documents/:id/signatures', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const { partyId, signatureType, clientSha256, displayName, signatureImage } = req.body as {
    partyId?: string
    signatureType?: string
    clientSha256?: string
    displayName?: string
    signatureImage?: string
  }

  if (!partyId || !signatureType || !clientSha256) {
    res.status(400).json({ error: 'partyId, signatureType, and clientSha256 required' })
    return
  }

  const address = res.locals.address as string
  const docId = routeParam(req.params.id)

  try {
    let imageBuffer: Buffer | undefined
    let imageSha256: string | undefined
    if (signatureImage) {
      imageBuffer = parseSignatureImageBase64(signatureImage)
      imageSha256 = hashSignatureImage(imageBuffer)
    }

    const document = addSignature({
      documentId: docId,
      partyId,
      signerAddress: address,
      signatureType,
      clientSha256,
      displayName,
      signatureImage: imageBuffer,
      signatureImageSha256: imageSha256,
    })
    res.json({ document })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sign failed' })
  }
})

app.get('/api/documents/:docId/signatures/:sigId/image', (req, res) => {
  const docId = String(req.params.docId)
  const sigId = String(req.params.sigId)
  const signature = getSignatureForDocument(docId, sigId)
  if (!signature) {
    res.status(404).json({ error: 'Signature not found' })
    return
  }

  // Names + ink are private to creator and signees (not public share viewers).
  const viewer = optionalViewerAddress(req)
  if (!viewerMayAccessSignatureImage(docId, viewer)) {
    res.status(403).json({
      error: 'Signature images are only visible to the creator and parties on this agreement',
    })
    return
  }

  const image = getSignatureImage(sigId)
  if (!image) {
    res.status(404).json({ error: 'Signature image not found' })
    return
  }

  res.setHeader('Content-Type', image.contentType)
  res.setHeader('Content-Length', String(image.byteSize))
  // Private images — do not cache on shared CDNs / public browsers as anonymous.
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('ETag', `"${image.imageSha256}"`)
  if (req.headers['if-none-match'] === `"${image.imageSha256}"`) {
    res.status(304).end()
    return
  }
  res.send(image.imageBlob)
})

app.post('/api/documents/:id/prepare-lock', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const { finalSha256 } = req.body as { finalSha256?: string }
  if (!finalSha256 || !/^[a-f0-9]{64}$/i.test(finalSha256)) {
    res.status(400).json({ error: 'Valid finalSha256 required' })
    return
  }
  const address = res.locals.address as string
  try {
    const result = prepareLock(routeParam(req.params.id), finalSha256.toLowerCase(), address)
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Prepare lock failed'
    res.status(lockErrorStatus(message)).json({ error: message })
  }
})

app.post('/api/transactions/broadcast', attestLimit, authMiddleware, requireVerifiedWallet, async (req, res) => {
  const { serializedTx, documentId } = req.body as { serializedTx?: string; documentId?: string }
  if (!documentId?.trim()) {
    res.status(400).json({ error: 'documentId required' })
    return
  }
  if (!serializedTx?.trim()) {
    res.status(400).json({ error: 'serializedTx required' })
    return
  }

  const address = res.locals.address as string
  try {
    assertSealBroadcastAllowed(documentId, address)
    normalizeRawTransactionHex(serializedTx)
    const hash = await broadcastRawTransaction(serializedTx)
    res.json({ hash })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Broadcast failed'
    res.status(lockErrorStatus(message)).json({ error: message })
  }
})

app.post('/api/documents/:id/begin-lock', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const address = res.locals.address as string
  try {
    const document = beginLock(routeParam(req.params.id), address)
    res.json({ document })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Begin lock failed'
    res.status(lockErrorStatus(message)).json({ error: message })
  }
})

app.post('/api/documents/:id/attestations', attestLimit, authMiddleware, requireVerifiedWallet, async (req, res) => {
  const { txHash } = req.body as { txHash?: string }
  if (!txHash) {
    res.status(400).json({ error: 'txHash required' })
    return
  }

  const address = res.locals.address as string
  try {
    const result = await submitAttestation(routeParam(req.params.id), txHash, address)
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Attestation failed'
    res.status(lockErrorStatus(message)).json({ error: message })
  }
})

app.get('/api/attestations/status/:txHash', authMiddleware, async (req, res) => {
  try {
    const result = await resolveAttestation(routeParam(req.params.txHash))
    res.json(result)
  } catch (err) {
    try {
      const status = getAttestationStatus(routeParam(req.params.txHash))
      res.json(status)
    } catch {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Not found' })
    }
  }
})

app.get('/api/verify/:idOrSlug', publicReadLimit, (req, res) => {
  const viewer = optionalViewerAddress(req)
  const doc = getDocumentPublic(routeParam(req.params.idOrSlug), viewer)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    originalFilename: doc.originalFilename,
    type: doc.type,
    status: doc.status,
    creatorAddress: doc.creatorAddress,
    originalSha256: doc.originalSha256,
    finalSha256: doc.finalSha256,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
    attestation: doc.attestation,
    signatures: doc.signatures,
    parties: doc.parties,
    participantDetailsRevealed: doc.participantDetailsRevealed,
  })
})

app.get('/api/documents/:id/certificate', publicReadLimit, (req, res) => {
  const cert = buildCertificate(routeParam(req.params.id))
  if (!cert) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json(cert)
})

function pdfLabDisabled(res: express.Response): boolean {
  if (isPdfAnnotationUiEnabled()) return false
  res.status(404).json({ error: 'PDF annotation lab is disabled on this environment' })
  return true
}

/**
 * Placement construction plan (structure + planRoot hashes only).
 * POST body: { originalSha256, plan?, documentId?, lock?, unlock?, planRoot?, batch0FramesHex?, batch0Root? }
 * lock=true freezes geometry for signing; unlock=true re-opens draft when no fills/signatures yet.
 */
app.post(
  '/api/placement-plans',
  annotationStreamLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    if (pdfLabDisabled(res)) return
    const body = req.body as {
      originalSha256?: string
      plan?: unknown
      documentId?: string
      lock?: boolean
      unlock?: boolean
      planRoot?: string
      batch0FramesHex?: string[]
      batch0Root?: string
    }
    if (!body.originalSha256 || !/^[a-f0-9]{64}$/i.test(body.originalSha256)) {
      res.status(400).json({ error: 'Valid originalSha256 required' })
      return
    }
    const address = res.locals.address as string
    try {
      if (body.unlock) {
        const result = unlockPlacementPlan({
          originalSha256: body.originalSha256,
          creatorAddress: address,
          documentId: body.documentId ?? null,
        })
        res.status(200).json(result)
        return
      }
      const result = body.lock
        ? lockPlacementPlan({
            originalSha256: body.originalSha256,
            creatorAddress: address,
            plan: body.plan,
            planRoot: body.planRoot,
            batch0FramesHex: body.batch0FramesHex,
            batch0Root: body.batch0Root,
            documentId: body.documentId ?? null,
          })
        : saveDraftPlan({
            originalSha256: body.originalSha256,
            creatorAddress: address,
            plan: body.plan,
            documentId: body.documentId ?? null,
          })
      res.status(body.lock ? 201 : 200).json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Placement plan save failed'
      const status =
        message.includes('Only the plan owner') ||
        message.includes('already locked') ||
        message.includes('Cannot edit placements')
          ? 403
          : 400
      res.status(status).json({ error: message })
    }
  },
)

/**
 * Placement plan structure (hashes + geometry). When the viewer is the plan
 * creator or a document party/signee (optional Bearer session), fill wire
 * frames are included so the client can reconstruct a signed document view.
 */
app.get('/api/placement-plans/:sha256', publicReadLimit, (req, res) => {
  if (pdfLabDisabled(res)) return
  const sha = routeParam(req.params.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  const viewer = optionalViewerAddress(req)
  const plan = getPlanPublic(sha, { viewerAddress: viewer })
  if (!plan) {
    res.status(404).json({ error: 'No placement plan for this PDF hash' })
    return
  }
  res.json(plan)
})

/**
 * Append fill batch (content-addressed blob ids + optional wire frames).
 * Plan must be locked. Rejects double-fill of the same slot.
 */
app.post(
  '/api/placement-plans/:sha256/fills',
  annotationStreamLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    if (pdfLabDisabled(res)) return
    const sha = routeParam(req.params.sha256).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(sha)) {
      res.status(400).json({ error: 'Valid sha256 required' })
      return
    }
    const body = req.body as {
      personSlotIndex?: number
      prevRoot?: string
      batchRoot?: string
      batchIndex?: number
      framesHex?: string[]
      fills?: Array<{ slotId: string; blobId: string; personSlotIndex: number }>
      blobIds?: string[]
    }
    const address = res.locals.address as string
    try {
      const result = appendFillBatch({
        originalSha256: sha,
        signerAddress: address,
        personSlotIndex: Number(body.personSlotIndex),
        prevRoot: String(body.prevRoot ?? ''),
        batchRoot: String(body.batchRoot ?? ''),
        batchIndex: Number(body.batchIndex),
        framesHex: body.framesHex,
        fills: Array.isArray(body.fills) ? body.fills : [],
        blobIds: Array.isArray(body.blobIds) ? body.blobIds : [],
      })
      res.status(201).json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fill append failed'
      res.status(400).json({ error: message })
    }
  },
)

/**
 * Experiment: pack annotations into 64-byte frames, index by PDF hash,
 * optionally broadcast each frame via service wallet (on-chain).
 * Owner-scoped: only the publishing wallet may overwrite a hash.
 * Parallel to seal — not used by DocumentJourney seal flow.
 */
app.post(
  '/api/annotation-streams',
  annotationStreamLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    if (pdfLabDisabled(res)) return
    const body = req.body as {
      originalSha256?: string
      annotations?: unknown
      broadcast?: boolean
    }
    if (!body.originalSha256 || !/^[a-f0-9]{64}$/i.test(body.originalSha256)) {
      res.status(400).json({ error: 'Valid originalSha256 required' })
      return
    }
    const address = res.locals.address as string
    try {
      const result = await publishAnnotationStream({
        originalSha256: body.originalSha256,
        annotations: body.annotations,
        creatorAddress: address,
        broadcast: Boolean(body.broadcast),
      })
      res.status(201).json({
        ...result,
        serviceWalletConfigured: isServiceWalletConfigured(),
        broadcastEnabled: isAnnotationStreamBroadcastEnabled(),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed'
      const status = message.includes('Only the stream owner') ? 403 : 400
      res.status(status).json({ error: message })
    }
  },
)

/** Look up packed stream by PDF fingerprint (no PDF upload). Slim annotations only. */
app.get('/api/annotation-streams/:sha256', publicReadLimit, (req, res) => {
  if (pdfLabDisabled(res)) return
  const sha = routeParam(req.params.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  const stream = getStreamByHash(sha)
  if (!stream) {
    res.status(404).json({ error: 'No annotation stream for this PDF hash' })
    return
  }
  let annotations: unknown[] = []
  try {
    annotations = annotationsForPublic(JSON.parse(stream.annotationsJson) as unknown[])
  } catch {
    annotations = []
  }
  res.json({
    originalSha256: stream.originalSha256,
    creatorAddress: stream.creatorAddress,
    frameCount: stream.framesHex.length,
    payloadBytes: stream.payloadBytes,
    annotationCount: stream.annotationCount,
    // framesHex omitted from public GET — use reconstruct for verified payload
    txHashes: stream.txHashes,
    onChain: stream.onChain,
    confirmedFrames: stream.confirmedFrames,
    annotations,
    createdAt: stream.createdAt,
    updatedAt: stream.updatedAt,
    serviceWalletConfigured: isServiceWalletConfigured(),
    broadcastEnabled: isAnnotationStreamBroadcastEnabled(),
  })
})

/**
 * Reconstruct annotations for a PDF hash — prefers stored wire frames, optional chain sample.
 * Query: ?fallback=index (default) | ?fallback=none (fail closed on chain errors)
 */
app.get('/api/annotation-streams/:sha256/reconstruct', publicReadLimit, async (req, res) => {
  if (pdfLabDisabled(res)) return
  const sha = routeParam(req.params.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  const fallbackRaw = String(req.query.fallback ?? 'index').toLowerCase()
  const fallbackIndex = fallbackRaw !== 'none' && fallbackRaw !== '0' && fallbackRaw !== 'false'
  try {
    const result = await reconstructFromStoredOrChain(sha, { fallbackIndex })
    res.json(result)
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Not found' })
  }
})

app.post('/api/verify/hash', verifyHashLimit, (req, res) => {
  const { sha256 } = req.body as { sha256?: string }
  if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  const matches = findDocumentsByHash(sha256.toLowerCase()).map(doc => ({
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    originalFilename: doc.originalFilename,
    status: doc.status,
    finalSha256: doc.finalSha256,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
  }))
  res.json({ matches })
})

// ── Cross-device signature ink handoff (signaling + encrypted deposit only) ──
// Poll is ~1–1.5 Hz per peer + ICE posts; 60/min saturated dual-sided sessions.
const sigHandoffLimit = rateLimit(120, 60_000)
const sigHandoffSignalLimit = rateLimit(480, 60_000)
const sigHandoffCreateLimit = rateLimit(20, 60_000)

app.post(
  '/api/sig-handoff',
  sigHandoffCreateLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const address = res.locals.address as string
    const { documentId } = (req.body ?? {}) as { documentId?: string }
    try {
      const room = sigHandoff.createRoom(address, documentId)
      res.status(201).json({
        sessionId: room.id,
        expiresAt: room.expiresAt,
        status: room.status,
      })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Could not create session' })
    }
  },
)

app.get('/api/sig-handoff/:id', sigHandoffLimit, (req, res) => {
  try {
    const room = sigHandoff.getRoom(routeParam(req.params.id))
    if (!room) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    res.json({
      sessionId: room.id,
      status: room.status,
      expiresAt: room.expiresAt,
      hasDeposit: room.hasDeposit && !room.depositConsumed,
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Lookup failed' })
  }
})

app.post('/api/sig-handoff/:id/signal', sigHandoffSignalLimit, (req, res) => {
  const { from, type, payload } = (req.body ?? {}) as {
    from?: 'host' | 'guest'
    type?: string
    payload?: unknown
  }
  if (from !== 'host' && from !== 'guest') {
    res.status(400).json({ error: 'from must be host or guest' })
    return
  }
  if (!type || typeof type !== 'string') {
    res.status(400).json({ error: 'type required' })
    return
  }
  // Host signals may be sent with wallet session; guest uses knowledge of session id only.
  if (from === 'host') {
    const token = req.headers.authorization?.replace('Bearer ', '')
    const session = token ? getSession(token) : null
    if (!session) {
      res.status(401).json({ error: 'Host signals require a wallet session' })
      return
    }
    const room = sigHandoff.getRoom(routeParam(req.params.id))
    if (!room || normalizeAddress(room.creatorAddress) !== normalizeAddress(session.address)) {
      res.status(403).json({ error: 'Not the host of this session' })
      return
    }
  }
  try {
    const msg = sigHandoff.postSignal(routeParam(req.params.id), from, type, payload)
    res.json({ ok: true, id: msg.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Signal failed'
    const status = message === 'Session not found' ? 404 : 400
    res.status(status).json({ error: message })
  }
})

app.get('/api/sig-handoff/:id/signal', sigHandoffSignalLimit, (req, res) => {
  const afterRaw = req.query.after
  const after = typeof afterRaw === 'string' ? Number(afterRaw) : 0
  const afterId = Number.isFinite(after) && after >= 0 ? Math.floor(after) : 0
  try {
    const { room, messages } = sigHandoff.pullSignals(routeParam(req.params.id), afterId)
    res.json({
      status: room.status,
      expiresAt: room.expiresAt,
      hasDeposit: room.hasDeposit && !room.depositConsumed,
      messages: messages.map(m => ({
        id: m.id,
        from: m.fromRole,
        type: m.msgType,
        payload: m.payload,
        createdAt: m.createdAt,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Poll failed'
    res.status(message === 'Session not found' ? 404 : 400).json({ error: message })
  }
})

app.post('/api/sig-handoff/:id/deposit', sigHandoffLimit, (req, res) => {
  const { iv, ciphertext, alg } = (req.body ?? {}) as {
    iv?: string
    ciphertext?: string
    alg?: string
  }
  if (!iv || !ciphertext) {
    res.status(400).json({ error: 'iv and ciphertext required' })
    return
  }
  if (alg && alg !== 'A256GCM') {
    res.status(400).json({ error: 'Only A256GCM is supported' })
    return
  }
  try {
    sigHandoff.depositCiphertext(routeParam(req.params.id), iv, ciphertext)
    res.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Deposit failed'
    const status = message === 'Session not found' ? 404 : 400
    res.status(status).json({ error: message })
  }
})

app.get(
  '/api/sig-handoff/:id/deposit',
  sigHandoffLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const address = res.locals.address as string
    try {
      const deposit = sigHandoff.takeDeposit(routeParam(req.params.id), address)
      if (!deposit) {
        res.status(404).json({ error: 'No deposit available' })
        return
      }
      res.json(deposit)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Retrieve failed'
      const status =
        message.includes('host') ? 403 : message === 'Session not found' ? 404 : 400
      res.status(status).json({ error: message })
    }
  },
)

app.post(
  '/api/sig-handoff/:id/complete',
  sigHandoffLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const address = res.locals.address as string
    try {
      sigHandoff.completeRoom(routeParam(req.params.id), address)
      res.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Complete failed'
      const status =
        message.includes('host') ? 403 : message === 'Session not found' ? 404 : 400
      res.status(status).json({ error: message })
    }
  },
)

app.delete(
  '/api/sig-handoff/:id',
  sigHandoffLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const address = res.locals.address as string
    try {
      const ok = sigHandoff.cancelRoom(routeParam(req.params.id), address)
      if (!ok) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json({ ok: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Cancel failed'
      const status = message.includes('host') ? 403 : 400
      res.status(status).json({ error: message })
    }
  },
)

startAttestationPoller()
startSessionCleanup()

if (IS_PRODUCTION) {
  attachClientStatic(app)
}

async function boot(): Promise<void> {
  if (!IS_PRODUCTION) {
    await attachLocalStudios(app)
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`VeriLock listening on http://${HOST}:${PORT}`)
    console.log(`  data: ${getDataDir()}`)
    console.log(`  chain verify: ${!SKIP_CHAIN_VERIFY}`)
    if (IS_PRODUCTION) {
      console.log(`  mode: production (client + API)`)
    }
  })

  server.on('error', err => {
    console.error('FATAL: server failed to start', err)
    process.exit(1)
  })
}

void boot()

process.on('uncaughtException', err => {
  console.error('uncaughtException', err)
  process.exit(1)
})

process.on('unhandledRejection', err => {
  console.error('unhandledRejection', err)
  process.exit(1)
})