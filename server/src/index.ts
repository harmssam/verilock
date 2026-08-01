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
import { addressFromPublicKeyHex, publicKeyBindingResult } from './auth-wallet.js'
import { normalizeAddress } from './addresses.js'
import {
  createSession,
  findDocumentsByHash,
  getDocumentById,
  inspectPartyInviteByTokenHash,
  getSession,
  getSignatureForDocument,
  getSignatureImage,
  markSessionVerified,
} from './db.js'
import {
  addSignature,
  configureDocumentCosigners,
  configureSigningRoster,
  createDocument,
  deleteDocument,
  getDocumentPublic,
  getMyDocuments,
  hashInviteToken,
  setCreatorNotifyEmail,
  setMyDocumentListArchived,
  viewerMayAccessSignatureImage,
} from './documents.js'
import { emailFeaturesPublic } from './email/config.js'
import { sendPartyInviteEmail } from './email/inviteSigner.js'
import { verifyHubSignedMessage } from './hub-signature.js'
import { rateLimit } from './rate-limit.js'
import { attachAdminRoutes, requireAdminOrRedirect } from './admin.js'
import { handleInboxWebhook } from './adminInbox.js'
import { attachAdminStudioProxy } from './adminStudioProxy.js'
import {
  clientIpFromRequest,
  deliverSupportContact,
  sanitizeSupportContact,
  supportContactPublicFeatures,
  verifyTurnstileToken,
  type SupportContactBody,
} from './supportContact.js'
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
import { verifySignature } from './nimiq-rpc.js'
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
} from './attestations.js'
import { applySecurityHeaders } from './http-headers.js'
import { getNimPrices, warmNimPricesCache } from './nimPrices.js'
import { getSealPricing } from './sealPricing.js'
import { startSessionCleanup } from './session-cleanup.js'
// Ensure support schema is migrated before any route handles tickets/stats.
import './supportTickets.js'
import { startSupportVolumeNoticeWorker } from './supportVolumeNotice.js'
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

// Blog moved to blog.verilock.online (private store / content-studio).
// Permanent redirects keep SEO and bookmarks. Disable with BLOG_REDIRECT=false.
const BLOG_PUBLIC_ORIGIN = (
  process.env.BLOG_PUBLIC_ORIGIN?.trim() || 'https://blog.verilock.online'
).replace(/\/+$/, '')
if (process.env.BLOG_REDIRECT !== 'false') {
  app.get(['/blog', '/blog/'], (_req, res) => {
    res.redirect(301, `${BLOG_PUBLIC_ORIGIN}/`)
  })
  app.get('/blog/:slug', (req, res) => {
    const slug = String(req.params.slug || '').replace(/\/+$/, '')
    if (!slug || slug.includes('..')) {
      res.redirect(301, `${BLOG_PUBLIC_ORIGIN}/`)
      return
    }
    res.redirect(301, `${BLOG_PUBLIC_ORIGIN}/${encodeURIComponent(slug)}`)
  })
}

// Global CORS is restricted to product origins. Offline-companion routes are open
// so VeriLock Offline (desktop + GitHub Pages) can look up hashes, load agreement
// metadata/layouts, complete Nimiq Hub login (challenge/verify), and fetch ink when
// authorized. Never receives document file bytes. Route-aware so preflight is not blocked.
app.use((req, res, next) => {
  const path = req.path
  const method = req.method
  const openOfflineCompanion =
    path === '/api/verify/hash' ||
    path === '/api/auth/challenge' ||
    path === '/api/auth/verify' ||
    (method === 'GET' &&
      (path === '/api/me' ||
        path.startsWith('/api/verify/') ||
        path.startsWith('/api/documents/') ||
        path.startsWith('/api/placement-plans/')))
  cors({
    origin: openOfflineCompanion ? true : CORS_ORIGIN,
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  })(req, res, next)
})

// Stripe webhooks need the raw body for signature verification - register before json parser.
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

// Studio image uploads are raw binary; capture before express.json so the
// admin proxy can forward Buffer bytes (not an empty/JSON-mangled body).
app.use(
  '/api/blog-studio/upload-image',
  express.raw({ type: ['image/*', 'application/octet-stream', '*/*'], limit: '12mb' }),
)
app.use(
  '/api/studio/images/catalog/upload',
  express.raw({ type: ['image/*', 'application/octet-stream', '*/*'], limit: '12mb' }),
)
app.use(
  '/api/x-studio/upload-image',
  express.raw({ type: ['image/*', 'application/octet-stream', '*/*'], limit: '12mb' }),
)

app.use(express.json({ limit: '2mb' }))

const authChallengeLimit = rateLimit(12, 60_000)
const authVerifyLimit = rateLimit(24, 60_000)
/** Desktop QR poll (~1.6s); allow steady wait for a few minutes without 429. */
const authQrPollLimit = rateLimit(120, 60_000)
const authQrStartLimit = rateLimit(20, 60_000)
const docLimit = rateLimit(30, 60_000)
const attestLimit = rateLimit(24, 60_000)
/** Mutations / checkout - keep tight. */
const creditsLimit = rateLimit(30, 60_000)
/** Code redemption - tighter (brute-force codes). */
const redeemLimit = rateLimit(10, 60_000)
/** Cheap SQLite balance reads - header + panel may both load. */
const creditsBalanceLimit = rateLimit(120, 60_000)
const publicReadLimit = rateLimit(60, 60_000)
/** Multi-tx annotation stream broadcast - tight (service wallet cost). */
const annotationStreamLimit = rateLimit(6, 60_000)
/** Multi-tx data archive is expensive (service wallet + credits); keep tight. */
const dataArchiveLimit = rateLimit(6, 60_000)
/**
 * Quote / recovery GETs. Progress prefers SSE (one long-lived connection);
 * this limit covers open-modal quote + poll fallback only.
 */
const dataArchiveQuoteLimit = rateLimit(60, 60_000)
/** Open SSE streams for archive progress (one connection per job watch). */
const dataArchiveStreamLimit = rateLimit(20, 60_000)
// Hash verify is read-only and easy to double-fire from UI retries; allow a higher burst.
const verifyHashLimit = rateLimit(60, 60_000)
/** Public contact form - tight limit against spam floods. */
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
 * Optional session for public reads - never 401s.
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
    // Browser/CDN can reuse briefly; server also keeps a 5-min SWR memory cache.
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=240')
    res.json(prices)
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : 'Could not fetch NIM prices',
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
    // Live rates change slowly; let browsers reuse for a minute (server SWR is 5 min).
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=240')
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

/** Public info for /redeem page (credits per code, feature flag). */
app.get('/api/credits/redeem-info', creditsLimit, (_req, res) => {
  void import('./redeemCodes.js').then(({ getRedeemPublicInfo }) => {
    res.json(getRedeemPublicInfo())
  })
})

/**
 * Redeem a one-time code (AppSumo / promo) onto the verified wallet.
 * Body: { code: string }. Idempotent per code (second attempt fails as already used).
 */
app.post(
  '/api/credits/redeem',
  authMiddleware,
  requireVerifiedWallet,
  redeemLimit,
  async (req, res) => {
    try {
      const { redeemCodeForWallet } = await import('./redeemCodes.js')
      const { code } = req.body as { code?: string }
      if (!code?.trim()) {
        res.status(400).json({ error: 'code required' })
        return
      }
      const address = res.locals.address as string
      const result = redeemCodeForWallet(code, address)
      res.json({
        balance: result.balance,
        creditsMinted: result.creditsMinted,
        alreadyClaimed: result.alreadyClaimed,
        campaign: result.campaign,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Redemption failed'
      const status =
        /already been redeemed|not available|Invalid or unknown/i.test(message) ? 409 : 400
      res.status(status).json({ error: message })
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

/**
 * Quote / status for multi-tx on-chain data archive (signatures, initials, text).
 * Pricing: 1 credit per 10 Nimiq txs, rounded up. Creator only.
 */
app.get(
  '/api/documents/:id/on-chain-data',
  dataArchiveQuoteLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    try {
      const { quoteDocumentDataArchive } = await import('./documentDataArchive.js')
      const { assertDocumentCreator } = await import('./documents.js')
      const address = res.locals.address as string
      const docId = routeParam(req.params.id)
      assertDocumentCreator(docId, address)
      res.json(quoteDocumentDataArchive(docId, address))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Quote failed'
      const status =
        message.includes('not found')
          ? 404
          : message.includes('Only the creator')
            ? 403
            : 400
      res.status(status).json({ error: message })
    }
  },
)

/**
 * Server-Sent Events stream of on-chain data archive progress.
 * Creator only. Prefer this over polling while a job is writing frames.
 * Auth via Authorization header (fetch + stream; not native EventSource).
 */
app.get(
  '/api/documents/:id/on-chain-data/stream',
  dataArchiveStreamLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    try {
      const {
        quoteDocumentDataArchive,
        subscribeArchiveProgress,
      } = await import('./documentDataArchive.js')
      const { assertDocumentCreator } = await import('./documents.js')
      const address = res.locals.address as string
      const docId = routeParam(req.params.id)
      assertDocumentCreator(docId, address)

      // Long-lived stream: disable socket idle timeout (default ~2 min on some hosts).
      req.socket.setTimeout(0)
      res.status(200)
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      // Disable proxy buffering (nginx / some CDNs) so each frame event flushes.
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders?.()

      let cleaned = false
      let unsubscribe: (() => void) | null = null
      let heartbeat: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        if (cleaned) return
        cleaned = true
        if (heartbeat != null) clearInterval(heartbeat)
        heartbeat = null
        unsubscribe?.()
        unsubscribe = null
      }

      const isTerminal = (q: {
        onChain?: boolean
        jobStatus?: string
      }) =>
        Boolean(q.onChain) ||
        q.jobStatus === 'complete' ||
        q.jobStatus === 'failed'

      const writeEvent = (event: string, data: unknown): boolean => {
        if (res.writableEnded || res.destroyed || cleaned) return false
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          return true
        } catch {
          cleanup()
          return false
        }
      }

      const endTerminal = (quote: { jobStatus?: string; onChain?: boolean }) => {
        writeEvent('end', {
          jobStatus: quote.jobStatus ?? 'failed',
          onChain: Boolean(quote.onChain),
        })
        cleanup()
        if (!res.writableEnded) res.end()
      }

      heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed || cleaned) return
        try {
          res.write(`: ping ${Date.now()}\n\n`)
        } catch {
          cleanup()
        }
      }, 15_000)

      req.on('close', cleanup)
      res.on('close', cleanup)
      res.on('error', cleanup)

      // Immediate snapshot so reconnects catch current TX count.
      const snap = quoteDocumentDataArchive(docId, address)
      if (!writeEvent('progress', snap)) return
      if (isTerminal(snap)) {
        endTerminal(snap)
        return
      }

      unsubscribe = subscribeArchiveProgress(docId, quote => {
        if (!writeEvent('progress', quote)) return
        if (isTerminal(quote)) endTerminal(quote)
      })

      // Re-quote after subscribe so we cannot miss a terminal publish that
      // landed in the gap between the initial snapshot and listener registration.
      const after = quoteDocumentDataArchive(docId, address)
      if (!writeEvent('progress', after)) return
      if (isTerminal(after)) {
        endTerminal(after)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Stream failed'
      if (!res.headersSent) {
        const status =
          message.includes('not found')
            ? 404
            : message.includes('Only the creator')
              ? 403
              : 400
        res.status(status).json({ error: message })
        return
      }
      res.end()
    }
  },
)

/**
 * Download recovery package (tx hashes + wire frames) for offline reconstruct.
 * Creator only; available once frames are pinned (even mid-job).
 */
app.get(
  '/api/documents/:id/on-chain-data/recovery',
  dataArchiveQuoteLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    try {
      const { recoveryPackageForDocument } = await import('./documentDataArchive.js')
      const { assertDocumentCreator } = await import('./documents.js')
      const address = res.locals.address as string
      const docId = routeParam(req.params.id)
      assertDocumentCreator(docId, address)
      const pack = recoveryPackageForDocument(docId)
      if (!pack) {
        res.status(404).json({ error: 'No data archive frames for this document yet' })
        return
      }
      res.json(pack)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recovery package failed'
      const status =
        message.includes('not found')
          ? 404
          : message.includes('Only the creator')
            ? 403
            : 400
      res.status(status).json({ error: message })
    }
  },
)

/**
 * Public index: given a PDF fingerprint, list archive tx hashes on Nimiq.
 * No auth - enables verilock-offline hash-only reconstruct discovery.
 */
app.get('/api/chain-data/:sha256', publicReadLimit, async (req, res) => {
  const sha = routeParam(req.params.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  try {
    const { publicChainDataIndex } = await import('./documentDataArchive.js')
    res.json(publicChainDataIndex(sha))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Lookup failed' })
  }
})

/**
 * Public reconstruct: unpack archive for a fingerprint.
 * Query: ?source=auto|wire|chain|scan
 *   auto (default) — server index if present, else Nimiq scan by 8-byte association id
 *   scan — hash-only discovery (no recovery file; works after purge if frames are still on-chain)
 */
app.get('/api/chain-data/:sha256/reconstruct', publicReadLimit, async (req, res) => {
  const sha = routeParam(req.params.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  const sourceRaw = String(req.query.source ?? 'auto').toLowerCase()
  const source =
    sourceRaw === 'chain' || sourceRaw === 'wire' || sourceRaw === 'scan' || sourceRaw === 'auto'
      ? sourceRaw
      : 'auto'
  try {
    const { reconstructArchiveBySha256 } = await import('./documentDataArchive.js')
    const result = await reconstructArchiveBySha256(sha, { source })
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reconstruct failed'
    const status =
      /no archive|no stored|no on-chain|not found/i.test(message) ? 404 : 400
    res.status(status).json({ error: message })
  }
})

/**
 * Pay credits and broadcast packed annotation / placement frames on Nimiq.
 * Reuses the multi-tx frame pipeline (64-byte 0xA1 streams).
 * Body: optional { notifyEmail } for completion email after success.
 */
app.post(
  '/api/documents/:id/on-chain-data',
  dataArchiveLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    try {
      const { archiveDocumentDataOnChain } = await import('./documentDataArchive.js')
      const address = res.locals.address as string
      const docId = routeParam(req.params.id)
      const body = (req.body ?? {}) as { notifyEmail?: string | null }
      let notifyEmail: string | null = null
      if (body.notifyEmail != null && String(body.notifyEmail).trim() !== '') {
        try {
          notifyEmail = sanitizeNotifyEmail(body.notifyEmail)
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : 'Invalid notification email',
          })
          return
        }
      }

      const result = await archiveDocumentDataOnChain(docId, address)

      // Completion email: if already complete, send now; if background job,
      // attach notify email to fire when job finishes (poller path below).
      let notifyEmailQueued = false
      if (notifyEmail && result.onChain) {
        notifyEmailQueued = true
        void import('./email/dataArchiveComplete.js').then(({ notifyDataArchiveComplete }) =>
          notifyDataArchiveComplete({
            documentId: docId,
            to: notifyEmail!,
            frameCount: result.frameCount,
            creditsCharged: result.creditsCharged,
          }),
        )
      } else if (notifyEmail && result.accepted) {
        // Stash on archive error field is wrong - use in-memory map + complete hook.
        notifyEmailQueued = true
        const { registerArchiveNotifyEmail } = await import('./documentDataArchive.js')
        registerArchiveNotifyEmail(docId, notifyEmail)
      }

      res.json({ ...result, notifyEmailQueued })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'On-chain data archive failed'
      const status =
        message.includes('Insufficient credits')
          ? 402
          : message === 'Document not found'
            ? 404
            : message.includes('Only the creator')
              ? 403
              : message.includes('must be locked')
                ? 409
                : message.includes('Too many')
                  ? 429
                  : 400
      res.status(status).json({ error: message })
    }
  },
)

/**
 * Issue a sign-in challenge.
 * - With `address` (Pay / legacy): session is bound to that wallet up front.
 * - Without `address` (Hub single-trip): Hub signMessage lets the user pick an
 *   address and sign in one redirect; we bind the address from the public key
 *   on verify. Avoids chooseAddress → return → signMessage → return (two trips).
 */
app.post('/api/auth/challenge', authChallengeLimit, (req, res) => {
  const { address } = req.body as { address?: string }
  const nonce = `VeriLock sign-in:${uuid()}:${Date.now()}`
  const token = uuid()
  if (address != null && String(address).trim() !== '') {
    const normalized = normalizeAddress(address)
    createSession(token, normalized, nonce, SESSION_TTL_MS)
    res.json({ token, nonce, address: normalized })
    return
  }
  createSession(token, null, nonce, SESSION_TTL_MS)
  res.json({ token, nonce, address: null })
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

  // Single-trip Hub: session has no address yet - derive and bind from public key.
  const pendingAddress = !session.address || String(session.address).trim() === ''
  let resolvedAddress = session.address
  if (pendingAddress) {
    try {
      resolvedAddress = addressFromPublicKeyHex(publicKey)
    } catch {
      res.status(401).json({ error: 'Invalid public key' })
      return
    }
    markSessionVerified(token, publicKey, resolvedAddress)
    res.json({ ok: true, address: resolvedAddress, verified: true })
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

/** Desktop Pay QR login: create short-lived room (no auth). Returns pollSecret for desktop only. */
app.post('/api/auth/qr/start', authQrStartLimit, async (_req, res) => {
  try {
    const { startPayLoginQr } = await import('./payLoginQr.js')
    const result = startPayLoginQr()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not start QR login' })
  }
})

/**
 * Desktop polls until phone completes Pay login.
 * Requires `X-VeriLock-Qr-Poll-Secret` (or `?secret=`) — never put secret in the QR.
 * On first `ready` response, includes token+address and consumes the room.
 */
app.get('/api/auth/qr/:id', authQrPollLimit, async (req, res) => {
  try {
    const { pollPayLoginQr } = await import('./payLoginQr.js')
    const headerSecret = req.headers['x-verilock-qr-poll-secret']
    const querySecret = typeof req.query.secret === 'string' ? req.query.secret : ''
    const pollSecret =
      (typeof headerSecret === 'string' ? headerSecret : '') || querySecret
    if (!pollSecret.trim()) {
      res.status(401).json({ error: 'poll secret required' })
      return
    }
    const result = pollPayLoginQr(routeParam(req.params.id), pollSecret.trim())
    if (result.status === 'not_found') {
      res.status(404).json({ error: 'QR login session not found' })
      return
    }
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'QR login poll failed'
    if (/poll secret/i.test(message)) {
      res.status(401).json({ error: message })
      return
    }
    res.status(/expired|already used/i.test(message) ? 410 : 400).json({ error: message })
  }
})

/** Phone (verified Pay session) attaches identity to the desktop QR room. */
app.post(
  '/api/auth/qr/:id/complete',
  authVerifyLimit,
  authMiddleware,
  requireVerifiedWallet,
  async (req, res) => {
    try {
      const { completePayLoginQrFromPhoneSession } = await import('./payLoginQr.js')
      const token = res.locals.token as string
      const result = completePayLoginQrFromPhoneSession(routeParam(req.params.id), token)
      res.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'QR login complete failed'
      const status = /not found/i.test(message)
        ? 404
        : /expired|already used/i.test(message)
          ? 410
          : 400
      res.status(status).json({ error: message })
    }
  },
)

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

// Operator admin portal (password + Turnstile cookie session): stats + support queue.
attachAdminRoutes(app)

// Content Studio (Blog + X) via private Railway service — admin session required.
attachAdminStudioProxy(app, requireAdminOrRedirect)

// Resend inbound webhook — no admin auth (called by Resend servers).
// Only accepts mail for sam@verilock.online (or ADMIN_INBOX_TO).
const inboxWebhookLimit = rateLimit(30, 60_000)
app.post('/api/admin/inbox/inbound', inboxWebhookLimit, (req, res) => {
  void handleInboxWebhook(req, res)
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
    issue: sanitized.issue,
    walletAddress: sanitized.walletAddress,
  })

  if (!delivered.ok) {
    res.status(delivered.status).json({ error: delivered.error })
    return
  }

  res.json({
    ok: true,
    ticketPublicId: delivered.ticket.publicId,
  })
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
    /** Client PDF overlays only - never PDF file bytes. */
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
      res.status(400).json({ error: 'PDF file bytes are not accepted - send hash + annotations only' })
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
 * Public lookup for email deep links (`?invite=`). Returns slug + partyId only —
 * never the token, never invite email. Rate-limited.
 * Revoked / replaced / redeemed tokens return 410 so the client can hard-stop the invitee.
 */
app.get('/api/invites/lookup', publicReadLimit, (req, res) => {
  const raw = typeof req.query.token === 'string' ? req.query.token.trim() : ''
  if (!raw || raw.length > 200) {
    res.status(400).json({ error: 'token required' })
    return
  }
  const looked = inspectPartyInviteByTokenHash(hashInviteToken(raw))
  if (looked.status === 'not_found') {
    res.status(404).json({ error: 'Invite not found or expired', reason: 'not_found' })
    return
  }
  if (looked.status !== 'active') {
    const messages: Record<'revoked' | 'redeemed' | 'expired', string> = {
      revoked:
        'This invite link was replaced. Ask the organizer to send a new invite if you still need to sign.',
      redeemed: 'This invite link was already used to sign.',
      expired: 'This invite link has expired. Ask the organizer to resend the invite.',
    }
    res.status(410).json({
      error: messages[looked.status],
      reason: looked.status,
    })
    return
  }
  const invite = looked.invite
  const doc = getDocumentById(invite.documentId)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({
    documentId: doc.id,
    slug: doc.slug,
    partyId: invite.partyId,
  })
})

/**
 * Creator-only: email one party a branded invite with opaque personal link.
 * Never attaches the PDF. Never returns the raw invite token.
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
      inviteSentAt: result.inviteSentAt,
      previousEmail: result.previousEmail,
      previousLinksRevoked: result.previousLinksRevoked,
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

/**
 * Soft-archive / restore for the authenticated wallet’s agreements list only.
 * Does not touch on-chain data archive or server purge.
 */
app.put(
  '/api/documents/:id/list-archive',
  docLimit,
  authMiddleware,
  requireVerifiedWallet,
  (req, res) => {
    const address = res.locals.address as string
    const body = (req.body ?? {}) as { archived?: unknown }
    if (typeof body.archived !== 'boolean') {
      res.status(400).json({ error: 'archived must be a boolean' })
      return
    }
    try {
      const document = setMyDocumentListArchived(
        routeParam(req.params.id),
        address,
        body.archived,
      )
      res.json({ document })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not update list archive'
      const status =
        message === 'Document not found'
          ? 404
          : message.startsWith('Only participants')
            ? 403
            : 400
      res.status(status).json({ error: message })
    }
  },
)

app.post('/api/documents/:id/signatures', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const { partyId, signatureType, clientSha256, displayName, signatureImage, inviteToken } =
    req.body as {
      partyId?: string
      signatureType?: string
      clientSha256?: string
      displayName?: string
      signatureImage?: string
      /** Raw personal invite token from email deep link (`?invite=`). */
      inviteToken?: string
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
      inviteToken: typeof inviteToken === 'string' ? inviteToken : null,
    })
    res.json({ document })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign failed'
    const status =
      message.includes('personal invite link') || message.includes('invite link is invalid')
        ? 403
        : 400
    res.status(status).json({ error: message })
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
  // Private images - do not cache on shared CDNs / public browsers as anonymous.
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('ETag', `"${image.imageSha256}"`)
  if (req.headers['if-none-match'] === `"${image.imageSha256}"`) {
    res.status(304).end()
    return
  }
  res.send(image.imageBlob)
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

function pdfAnnotationUiDisabled(res: express.Response): boolean {
  if (isPdfAnnotationUiEnabled()) return false
  res.status(404).json({ error: 'PDF annotation UI is disabled on this environment' })
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
    if (pdfAnnotationUiDisabled(res)) return
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
  if (pdfAnnotationUiDisabled(res)) return
  const sha = routeParam(req.params.sha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    res.status(400).json({ error: 'Valid sha256 required' })
    return
  }
  const viewer = optionalViewerAddress(req)
  // Prefer agreement id so the same PDF can have many independent plans.
  const documentIdRaw = req.query.documentId
  const documentId =
    typeof documentIdRaw === 'string' && documentIdRaw.trim()
      ? documentIdRaw.trim()
      : null
  const plan = getPlanPublic(sha, { viewerAddress: viewer, documentId })
  if (!plan) {
    res.status(404).json({
      error: documentId
        ? 'No placement plan for this agreement'
        : 'No placement plan for this PDF hash',
    })
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
    if (pdfAnnotationUiDisabled(res)) return
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
      /** Required when the same PDF fingerprint is used on multiple agreements. */
      documentId?: string
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
        documentId: body.documentId?.trim() || null,
      })
      res.status(201).json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fill append failed'
      res.status(400).json({ error: message })
    }
  },
)

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
startSupportVolumeNoticeWorker()

if (IS_PRODUCTION) {
  attachClientStatic(app)
}

async function boot(): Promise<void> {
  if (!IS_PRODUCTION) {
    await attachLocalStudios(app)
  }

  // Prefetch NIM→USD so the first pricing/credits quote is not a cold Fastspot wait.
  warmNimPricesCache()

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