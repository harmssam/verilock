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
  beginLock,
  createDocument,
  deleteDocument,
  getDocumentPublic,
  getMyDocuments,
  prepareLock,
} from './documents.js'
import { verifyHubSignedMessage } from './hub-signature.js'
import { rateLimit } from './rate-limit.js'
import { broadcastRawTransaction, normalizeRawTransactionHex, verifySignature } from './nimiq-rpc.js'
import { assertSafeBootConfig, resolveCorsOrigin, sanitizeDisplayName } from './security.js'
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
import { getNimPrices } from './nimPrices.js'
import { getSealPricing } from './sealPricing.js'

assertSafeBootConfig()

const PORT = Number(process.env.PORT ?? 3002)
const HOST = process.env.HOST ?? '0.0.0.0'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CORS_ORIGIN = resolveCorsOrigin()
const SKIP_CHAIN_VERIFY = process.env.SKIP_CHAIN_VERIFY === 'true'
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

const app = express()
app.use(cors({ origin: CORS_ORIGIN }))
app.use(express.json({ limit: '2mb' }))

const authChallengeLimit = rateLimit(12, 60_000)
const authVerifyLimit = rateLimit(24, 60_000)
const docLimit = rateLimit(30, 60_000)
const attestLimit = rateLimit(24, 60_000)

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

app.post('/api/auth/challenge', authChallengeLimit, (req, res) => {
  const { address } = req.body as { address?: string }
  if (!address) {
    res.status(400).json({ error: 'Address required' })
    return
  }
  const normalized = normalizeAddress(address)
  const nonce = `seal-login:${uuid()}:${Date.now()}`
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
        : await verifySignature(session.nonce, publicKey, signature, true)
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

  markSessionVerified(token, publicKey)
  res.json({ ok: true, address: session.address, verified: true })
})

app.get('/api/me', authMiddleware, (req, res) => {
  const address = res.locals.address as string
  res.json({ address, documents: getMyDocuments(address) })
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
  }

  if (!body.originalSha256 || !/^[a-f0-9]{64}$/i.test(body.originalSha256)) {
    res.status(400).json({ error: 'Valid originalSha256 required' })
    return
  }

  const address = res.locals.address as string

  if (!body.creatorDisplayName?.trim()) {
    res.status(400).json({ error: 'Your name is required' })
    return
  }

  const doc = createDocument({
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
  })

  res.status(201).json({ document: doc })
})

app.get('/api/documents/:id', (req, res) => {
  const doc = getDocumentPublic(req.params.id!)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({ document: doc })
})

app.delete('/api/documents/:id', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  const address = res.locals.address as string
  try {
    deleteDocument(req.params.id!, address)
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
  const docId = req.params.id!

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

  const image = getSignatureImage(sigId)
  if (!image) {
    res.status(404).json({ error: 'Signature image not found' })
    return
  }

  res.setHeader('Content-Type', image.contentType)
  res.setHeader('Content-Length', String(image.byteSize))
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
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
  try {
    const result = prepareLock(req.params.id!, finalSha256.toLowerCase())
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Prepare lock failed' })
  }
})

app.post('/api/transactions/broadcast', attestLimit, authMiddleware, requireVerifiedWallet, async (req, res) => {
  const { serializedTx } = req.body as { serializedTx?: string }
  if (!serializedTx?.trim()) {
    res.status(400).json({ error: 'serializedTx required' })
    return
  }

  try {
    normalizeRawTransactionHex(serializedTx)
    const hash = await broadcastRawTransaction(serializedTx)
    res.json({ hash })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Broadcast failed' })
  }
})

app.post('/api/documents/:id/begin-lock', docLimit, authMiddleware, requireVerifiedWallet, (req, res) => {
  try {
    const document = beginLock(req.params.id!)
    res.json({ document })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Begin lock failed' })
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
    const result = await submitAttestation(req.params.id!, txHash, address)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Attestation failed' })
  }
})

app.get('/api/attestations/status/:txHash', authMiddleware, async (req, res) => {
  try {
    const result = await resolveAttestation(req.params.txHash!)
    res.json(result)
  } catch (err) {
    try {
      const status = getAttestationStatus(req.params.txHash!)
      res.json(status)
    } catch {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Not found' })
    }
  }
})

app.get('/api/verify/:idOrSlug', (req, res) => {
  const doc = getDocumentPublic(req.params.idOrSlug!)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json({
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    originalFilename: doc.originalFilename,
    status: doc.status,
    creatorAddress: doc.creatorAddress,
    originalSha256: doc.originalSha256,
    finalSha256: doc.finalSha256,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
    attestation: doc.attestation,
    signatures: doc.signatures,
    parties: doc.parties,
  })
})

app.get('/api/documents/:id/certificate', (req, res) => {
  const cert = buildCertificate(req.params.id!)
  if (!cert) {
    res.status(404).json({ error: 'Document not found' })
    return
  }
  res.json(cert)
})

app.post('/api/verify/hash', (req, res) => {
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

if (IS_PRODUCTION) {
  attachClientStatic(app)
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

process.on('uncaughtException', err => {
  console.error('uncaughtException', err)
  process.exit(1)
})

process.on('unhandledRejection', err => {
  console.error('unhandledRejection', err)
  process.exit(1)
})