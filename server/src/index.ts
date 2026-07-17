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
  createDocument,
  deleteDocument,
  getDocumentPublic,
  getMyDocuments,
  prepareLock,
  setCreatorNotifyEmail,
  viewerMayAccessSignatureImage,
} from './documents.js'
import { emailFeaturesPublic } from './email/config.js'
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
// Hash verify is read-only and easy to double-fire from UI retries; allow a higher burst.
const verifyHashLimit = rateLimit(60, 60_000)
/** Public contact form — tight limit against spam floods. */
const supportContactLimit = rateLimit(5, 15 * 60_000)

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

/** Optional session for public reads — never 401s; attaches address when token is valid. */
function optionalViewerAddress(req: express.Request): string | null {
  const token = req.headers.authorization?.replace('Bearer ', '')?.trim()
  if (!token) return null
  const session = getSession(token)
  return session?.address ?? null
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
  }

  if (!body.originalSha256 || !/^[a-f0-9]{64}$/i.test(body.originalSha256)) {
    res.status(400).json({ error: 'Valid originalSha256 required' })
    return
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
  })

  res.status(201).json({ document: doc, ...(hashWarning ? { hashWarning } : {}) })
})

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
      body.requiredSignatures > 4
    ) {
      res.status(400).json({ error: 'requiredSignatures must be between 1 and 4' })
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