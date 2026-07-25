/**
 * Paid multi-tx on-chain data archive for agreements.
 *
 * Uses the same 64-byte Nimiq frame packing proven in the /pdf experiment:
 * - Production: placement plan batch0 + fill batch frames (signatures, initials, text)
 * - Plus v3 archive manifest (people, wallets, signature roster) for offline reconstruct
 * - Legacy/experiment: free-form document.annotations packed as v1 annotation stream
 *
 * Pricing: 1 credit per 10 txs, rounded up (ceil). Example: 51 frames → 6 credits.
 *
 * Security invariants:
 * - Creator-only; document must already be fingerprint-locked
 * - Credits spent once per attempt; full failure refunds; partial keeps charge
 * - Concurrent archives for the same document coalesce (no double broadcast)
 * - After charge, frames are pinned - later fill growth cannot free-ride
 * - Partial broadcast resumes from the first missing frame index
 * - onChain requires broadcast of all frames + HEAD/END sample verification
 */
import { v4 as uuid } from 'uuid'
import { normalizeAddress } from './addresses.js'
import {
  buildArchiveManifest,
  contentHashFrames,
  framesHexToBuffers,
  packArchiveManifestFrames,
  scanArchiveByPdfHash,
  splitFrameStreams,
  STREAM_VERSION_ANNOTATION,
  STREAM_VERSION_MANIFEST,
  STREAM_VERSION_PLACEMENT,
  unpackArchiveFrames,
} from './archiveStream.js'
import {
  broadcastStreamFrames,
  isAnnotationStreamBroadcastEnabled,
  packAnnotationStream,
  STREAM_MAGIC,
} from './annotationStream.js'
import {
  creditsForStreamTxCount,
  FRAMES_PER_DATA_ARCHIVE_CREDIT,
} from './credits.js'
import { isCreditsEnabled } from './creditsConfig.js'
import {
  applyCreditDelta,
  getCreditBalance,
  getDocumentById,
  getDocumentDataArchive,
  getDocumentDataArchiveBySha256,
  getLedgerByIdempotencyKey,
  resolvePlacementPlan,
  upsertDocumentDataArchive,
  type DocumentDataArchiveRecord,
  type DocumentDataArchiveSource,
} from './db.js'
import {
  decodeRecipientDataBytes,
  fetchTransaction,
} from './nimiq-rpc.js'
import { sanitizeAnnotations } from './security.js'
import { getSealFeeNim } from './sealPricing.js'
import { getServiceWalletAddress, isServiceWalletConfigured } from './serviceWallet.js'

const MAX_ARCHIVE_FRAMES = 128

function assertCreator(documentId: string, requesterAddress: string) {
  const doc = getDocumentById(documentId)
  if (!doc) throw new Error('Document not found')
  if (normalizeAddress(doc.creatorAddress) !== normalizeAddress(requesterAddress)) {
    throw new Error('Only the creator can archive agreement data on-chain')
  }
  return doc
}

function spendKey(documentId: string, attempt: number): string {
  return `data-archive:${documentId}:${attempt}`
}

function refundKey(documentId: string, attempt: number): string {
  return `data-archive-refund:${documentId}:${attempt}`
}

/**
 * Find an unrefunded spend (already paid) or the next free attempt slot.
 * After a full-failure refund, a new attempt can charge again.
 */
function resolveSpendAttempt(documentId: string): {
  attempt: number
  alreadyPaid: boolean
  key: string
  paidCredits: number | null
} {
  let attempt = 1
  while (attempt < 50) {
    const key = spendKey(documentId, attempt)
    const spent = getLedgerByIdempotencyKey(key)
    if (!spent) {
      return { attempt, alreadyPaid: false, key, paidCredits: null }
    }
    if (getLedgerByIdempotencyKey(refundKey(documentId, attempt))) {
      attempt += 1
      continue
    }
    const paidCredits = Math.abs(Number(spent.delta))
    return {
      attempt,
      alreadyPaid: true,
      key,
      paidCredits: Number.isFinite(paidCredits) && paidCredits > 0 ? paidCredits : null,
    }
  }
  throw new Error('Too many data-archive credit attempts for this document')
}

function framesContentHash(framesHex: string[]): string {
  return contentHashFrames(framesHex)
}

/** Accept well-formed 64-byte VeriLock stream frames (magic 0xA1, version 1–3). */
function assertValidStreamFrameHex(hex: string, index: number, _source: DocumentDataArchiveSource): void {
  if (typeof hex !== 'string' || !/^[a-f0-9]{128}$/i.test(hex)) {
    throw new Error(`Invalid frame hex at index ${index}`)
  }
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 64) {
    throw new Error(`Frame ${index} is ${buf.length} bytes (need 64)`)
  }
  if (buf[0] !== STREAM_MAGIC) {
    throw new Error(`Frame ${index} has bad stream magic (expected 0xA1 like /pdf lab)`)
  }
  const ver = buf[1]!
  // v1 = annotations; v2 = placement; v3 = archive manifest (people/wallets/sigs)
  if (
    ver !== STREAM_VERSION_ANNOTATION &&
    ver !== STREAM_VERSION_PLACEMENT &&
    ver !== STREAM_VERSION_MANIFEST
  ) {
    throw new Error(`Frame ${index} has unsupported stream version ${ver}`)
  }
}

function validateFramesHex(framesHex: string[], source: DocumentDataArchiveSource): void {
  if (framesHex.length === 0) throw new Error('No frames to archive')
  if (framesHex.length > MAX_ARCHIVE_FRAMES) {
    throw new Error(
      `Data archive too large (${framesHex.length} txs; max ${MAX_ARCHIVE_FRAMES})`,
    )
  }
  for (let i = 0; i < framesHex.length; i++) {
    assertValidStreamFrameHex(framesHex[i]!, i, source)
  }
}

export interface CollectedFrames {
  source: DocumentDataArchiveSource
  framesHex: string[]
  frameCount: number
  originalSha256: string
  contentHash: string
}

/**
 * Append v3 archive manifest (people, wallets, signature roster) when missing.
 * Manifest is required for offline reconstruct of identity; ink lives in placement frames.
 */
function withArchiveManifest(documentId: string, framesHex: string[]): string[] {
  const buffers = framesHexToBuffers(framesHex)
  try {
    const streams = splitFrameStreams(buffers)
    const hasManifest = streams.some(s => s[0]?.[1] === STREAM_VERSION_MANIFEST)
    if (hasManifest) return framesHex
  } catch {
    /* if split fails, still try to append a valid manifest */
  }
  const manifestFrames = packArchiveManifestFrames(documentId).map(f => f.toString('hex'))
  return [...framesHex, ...manifestFrames]
}

/** Collect packed 64-byte frames for a document (placements preferred + manifest). */
export function collectDocumentDataFrames(documentId: string): CollectedFrames | null {
  const doc = getDocumentById(documentId)
  if (!doc) return null
  const hash = doc.originalSha256.toLowerCase()

  const plan = resolvePlacementPlan({
    originalSha256: hash,
    documentId,
  })
  if (plan) {
    const frames: string[] = []
    for (const h of plan.batch0FramesHex ?? []) {
      if (typeof h === 'string' && /^[a-f0-9]{128}$/i.test(h)) {
        frames.push(h.toLowerCase())
      }
    }
    for (const batch of plan.fillBatches ?? []) {
      for (const h of batch.framesHex ?? []) {
        if (typeof h === 'string' && /^[a-f0-9]{128}$/i.test(h)) {
          frames.push(h.toLowerCase())
        }
      }
    }
    if (frames.length > 0) {
      const withManifest = withArchiveManifest(documentId, frames)
      validateFramesHex(withManifest, 'placements')
      return {
        source: 'placements',
        framesHex: withManifest,
        frameCount: withManifest.length,
        originalSha256: hash,
        contentHash: framesContentHash(withManifest),
      }
    }
  }

  const annotations = sanitizeAnnotations(doc.annotations)
  if (annotations && annotations.length > 0) {
    const packed = packAnnotationStream(hash, annotations)
    const framesHex = packed.map(f => f.toString('hex'))
    const withManifest = withArchiveManifest(documentId, framesHex)
    validateFramesHex(withManifest, 'annotations')
    return {
      source: 'annotations',
      framesHex: withManifest,
      frameCount: withManifest.length,
      originalSha256: hash,
      contentHash: framesContentHash(withManifest),
    }
  }

  // Signatures-only (wallet roster) with no placement ink / annotations still archives.
  const manifest = buildArchiveManifest(documentId)
  const hasSigs = Boolean(manifest?.sigs?.length)
  const hasWallets = Boolean(manifest?.people?.some(p => p.w))
  if (manifest && (hasSigs || hasWallets)) {
    const framesHex = packArchiveManifestFrames(documentId).map(f => f.toString('hex'))
    validateFramesHex(framesHex, 'annotations')
    return {
      source: 'annotations',
      framesHex,
      frameCount: framesHex.length,
      originalSha256: hash,
      contentHash: framesContentHash(framesHex),
    }
  }

  return null
}

/**
 * Verify HEAD + END of each multi-tx stream on Nimiq (payload bytes match).
 * Full DATA-frame poll is skipped to keep large archives practical.
 * Retries briefly for RPC/mempool lag after broadcast.
 */
async function verifyArchiveHeadEndOnChain(
  framesHex: string[],
  txHashes: string[],
  options?: { attempts?: number; delayMs?: number },
): Promise<{ ok: boolean; checked: number; matched: number; error?: string }> {
  if (framesHex.length === 0 || txHashes.length !== framesHex.length) {
    return {
      ok: false,
      checked: 0,
      matched: 0,
      error: `Hash count mismatch (${txHashes.length}/${framesHex.length})`,
    }
  }
  let streams: Buffer[][]
  try {
    streams = splitFrameStreams(framesHexToBuffers(framesHex))
  } catch (err) {
    return {
      ok: false,
      checked: 0,
      matched: 0,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const sampleIndices: number[] = []
  let offset = 0
  for (const stream of streams) {
    sampleIndices.push(offset)
    if (stream.length > 1) sampleIndices.push(offset + stream.length - 1)
    offset += stream.length
  }

  const attempts = options?.attempts ?? 6
  const delayMs = options?.delayMs ?? 2_000
  let lastError: string | undefined
  let lastChecked = 0
  let lastMatched = 0

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, delayMs))
    let checked = 0
    let matched = 0
    let failed: string | undefined
    for (const globalIdx of sampleIndices) {
      const expected = framesHex[globalIdx]!.toLowerCase()
      const txHash = txHashes[globalIdx]!
      checked += 1
      try {
        const tx = await fetchTransaction(txHash)
        if (!tx) {
          failed = `Tx not found yet: ${txHash.slice(0, 12)}…`
          break
        }
        if (tx.executionResult === false) {
          failed = `Tx failed execution: ${txHash.slice(0, 12)}…`
          break
        }
        const bytes = decodeRecipientDataBytes(tx.recipientData)
        const hex = Buffer.from(bytes).toString('hex').toLowerCase()
        if (hex !== expected) {
          failed = `Frame payload mismatch at index ${globalIdx}`
          break
        }
        matched += 1
      } catch (err) {
        failed = err instanceof Error ? err.message : String(err)
        break
      }
    }
    lastChecked = checked
    lastMatched = matched
    lastError = failed
    if (!failed && matched === checked && checked > 0) {
      return { ok: true, checked, matched }
    }
    // Permanent payload/execution failures should not spin retries
    if (
      failed &&
      (failed.includes('payload mismatch') || failed.includes('failed execution'))
    ) {
      break
    }
  }
  return {
    ok: false,
    checked: lastChecked,
    matched: lastMatched,
    error: lastError ?? 'Chain sample verification failed',
  }
}

/**
 * Prefer pinned frames from a prior paid attempt so fill growth cannot free-ride
 * on already-spent credits.
 */
function resolveFramesForArchive(
  documentId: string,
  existing: DocumentDataArchiveRecord | null,
): CollectedFrames {
  if (existing && existing.framesHex.length > 0 && existing.creditsCharged > 0) {
    validateFramesHex(existing.framesHex, existing.source)
    return {
      source: existing.source,
      framesHex: existing.framesHex,
      frameCount: existing.framesHex.length,
      originalSha256: existing.originalSha256,
      contentHash: framesContentHash(existing.framesHex),
    }
  }

  const collected = collectDocumentDataFrames(documentId)
  if (!collected || collected.frameCount === 0) {
    throw new Error('No signatures, initials, or field data available to archive')
  }
  return collected
}

export interface DataArchiveQuote {
  documentId: string
  eligible: boolean
  reason?: string
  locked: boolean
  onChain: boolean
  frameCount: number
  credits: number
  framesPerCredit: number
  source: DocumentDataArchiveSource | null
  creditsCharged: number
  txHashes: string[]
  confirmedFrames: number
  balance: number | null
  broadcastReady: boolean
  creditsEnabled: boolean
  error?: string | null
  /** idle | processing | complete | failed - processing means server is writing in background. */
  jobStatus: 'idle' | 'processing' | 'complete' | 'failed'
  /** True when credits already spent and user can resume free of charge. */
  alreadyPaid: boolean
  progressPercent: number
}

export function quoteDocumentDataArchive(
  documentId: string,
  walletAddress?: string | null,
): DataArchiveQuote {
  const doc = getDocumentById(documentId)
  if (!doc) {
    return {
      documentId,
      eligible: false,
      reason: 'Document not found',
      locked: false,
      onChain: false,
      frameCount: 0,
      credits: 0,
      framesPerCredit: FRAMES_PER_DATA_ARCHIVE_CREDIT,
      source: null,
      creditsCharged: 0,
      txHashes: [],
      confirmedFrames: 0,
      balance: null,
      broadcastReady: false,
      creditsEnabled: isCreditsEnabled(),
      jobStatus: 'idle',
      alreadyPaid: false,
      progressPercent: 0,
    }
  }

  const existing = getDocumentDataArchive(documentId)
  const locked = doc.status === 'locked'
  const creditsEnabled = isCreditsEnabled()
  const broadcastReady =
    isAnnotationStreamBroadcastEnabled() && isServiceWalletConfigured()
  const balance =
    walletAddress != null
      ? getCreditBalance(normalizeAddress(walletAddress))
      : null

  // Detect paid-but-incomplete (e.g. Cloudflare 524 mid-job) so UI can resume free.
  const spend = (() => {
    try {
      return resolveSpendAttempt(documentId)
    } catch {
      return { alreadyPaid: false, paidCredits: null as number | null, attempt: 0, key: '' }
    }
  })()

  let collected: CollectedFrames | null = null
  let collectError: string | undefined
  try {
    if (existing?.framesHex?.length && (existing.creditsCharged > 0 || spend.alreadyPaid)) {
      collected = {
        source: existing.source,
        framesHex: existing.framesHex,
        frameCount: existing.framesHex.length,
        originalSha256: existing.originalSha256,
        contentHash: framesContentHash(existing.framesHex),
      }
    } else {
      collected = collectDocumentDataFrames(documentId)
    }
  } catch (err) {
    collectError = err instanceof Error ? err.message : String(err)
  }

  const frameCount = collected?.frameCount || existing?.frameCount || 0
  const credits = creditsForStreamTxCount(frameCount)
  const onChain = Boolean(existing?.onChain)
  const source = existing?.source ?? collected?.source ?? null
  const inFlight = inflightArchives.has(documentId)
  const jobStatus: DataArchiveQuote['jobStatus'] = onChain
    ? 'complete'
    : inFlight || existing?.jobStatus === 'processing'
      ? 'processing'
      : existing?.jobStatus === 'failed'
        ? 'failed'
        : 'idle'

  const hashes = existing?.txHashes?.length ?? 0
  const progressPercent = onChain
    ? 100
    : frameCount > 0 && hashes >= frameCount
      ? 95 // all submitted; sample confirm in progress
      : frameCount > 0
        ? Math.min(90, Math.round((hashes / frameCount) * 90))
        : 0

  let reason: string | undefined
  let eligible = false
  if (onChain) {
    reason = 'Signatures and fields are already stored on the Nimiq blockchain'
  } else if (jobStatus === 'processing') {
    reason =
      frameCount > 0 && hashes >= frameCount
        ? `All ${frameCount} transactions submitted — confirming on Nimiq…`
        : frameCount > 0
          ? `Writing TX ${Math.min(hashes + 1, frameCount)} of ${frameCount}…`
          : 'Writing to the Nimiq blockchain in the background…'
    eligible = false
  } else if (!locked) {
    reason = 'Lock the fingerprint first, then archive signatures on-chain'
  } else if (collectError) {
    reason = collectError
  } else if (!collected || frameCount === 0) {
    reason = 'No signatures, initials, or field data available to archive'
  } else if (!creditsEnabled) {
    reason = 'Credits are not enabled'
  } else if (!broadcastReady) {
    reason = 'On-chain data broadcast is not configured'
  } else {
    eligible = true
    if (spend.alreadyPaid && !onChain) {
      reason =
        hashes > 0
          ? `Resume free - ${hashes}/${frameCount} frames already written (no extra charge)`
          : 'Credits already reserved - resume storage free of charge'
    }
  }

  return {
    documentId,
    eligible,
    reason,
    locked,
    onChain,
    frameCount,
    credits,
    framesPerCredit: FRAMES_PER_DATA_ARCHIVE_CREDIT,
    source,
    creditsCharged: existing?.creditsCharged ?? (spend.alreadyPaid ? spend.paidCredits ?? 0 : 0),
    txHashes: existing?.txHashes ?? [],
    confirmedFrames: existing?.confirmedFrames ?? hashes,
    balance,
    broadcastReady,
    creditsEnabled,
    error: existing?.error ?? null,
    jobStatus,
    alreadyPaid: spend.alreadyPaid && !onChain,
    progressPercent,
  }
}

type ArchiveResult = DataArchiveQuote & {
  balance: number
  broadcastError?: string
  partialBroadcast?: boolean
  /** True when work continues in the background (poll GET for completion). */
  accepted?: boolean
}

/** In-process background jobs - one per document. */
const inflightArchives = new Map<string, Promise<void>>()

/** Optional completion emails requested at job start (key = documentId). */
const pendingNotifyEmails = new Map<string, string>()

/**
 * Live progress subscribers (SSE). In-process only — same process as the
 * broadcast job. Multi-instance deployments should use sticky routing or fall
 * back to GET polling (SQLite is shared).
 */
type ArchiveProgressListener = (quote: DataArchiveQuote) => void
const archiveProgressListeners = new Map<string, Set<ArchiveProgressListener>>()

export function subscribeArchiveProgress(
  documentId: string,
  listener: ArchiveProgressListener,
): () => void {
  let set = archiveProgressListeners.get(documentId)
  if (!set) {
    set = new Set()
    archiveProgressListeners.set(documentId, set)
  }
  set.add(listener)
  return () => {
    const cur = archiveProgressListeners.get(documentId)
    if (!cur) return
    cur.delete(listener)
    if (cur.size === 0) archiveProgressListeners.delete(documentId)
  }
}

function publishArchiveProgress(documentId: string, walletAddress?: string | null): void {
  const listeners = archiveProgressListeners.get(documentId)
  if (!listeners || listeners.size === 0) return
  try {
    const quote = quoteDocumentDataArchive(documentId, walletAddress)
    for (const listener of listeners) {
      try {
        listener(quote)
      } catch (err) {
        console.warn('[data-archive] progress listener failed', err)
      }
    }
  } catch (err) {
    console.warn('[data-archive] progress publish failed', err)
  }
}

export function registerArchiveNotifyEmail(documentId: string, email: string): void {
  pendingNotifyEmails.set(documentId, email.trim().toLowerCase())
}

function fireArchiveNotifyEmail(documentId: string, frameCount: number, creditsCharged: number): void {
  const to = pendingNotifyEmails.get(documentId)
  if (!to) return
  pendingNotifyEmails.delete(documentId)
  void import('./email/dataArchiveComplete.js').then(({ notifyDataArchiveComplete }) =>
    notifyDataArchiveComplete({
      documentId,
      to,
      frameCount,
      creditsCharged,
    }),
  )
}

/**
 * Charge credits (if needed), pin frames, start background multi-tx broadcast.
 * Returns quickly so Cloudflare/proxy (∼100s) never 524s long archives.
 * Client should subscribe GET .../on-chain-data/stream (SSE) for live TX
 * progress, or poll GET .../on-chain-data as a fallback.
 *
 * If credits were already spent (timeout after charge), resume is free.
 */
export async function archiveDocumentDataOnChain(
  documentId: string,
  creatorAddress: string,
): Promise<ArchiveResult> {
  if (!isCreditsEnabled()) {
    throw new Error('Credits are not enabled')
  }
  if (!isAnnotationStreamBroadcastEnabled()) {
    throw new Error(
      'On-chain data broadcast is disabled (set ANNOTATION_STREAM_BROADCAST=true)',
    )
  }
  if (!isServiceWalletConfigured()) {
    throw new Error('Service wallet is not configured for data archive')
  }

  const address = normalizeAddress(creatorAddress)
  const doc = assertCreator(documentId, address)
  if (doc.status !== 'locked') {
    throw new Error('Document must be locked before archiving data on-chain')
  }

  let existing = getDocumentDataArchive(documentId)
  if (existing?.onChain) {
    return {
      ...quoteDocumentDataArchive(documentId, address),
      balance: getCreditBalance(address),
      accepted: false,
    }
  }

  // Already running in this process - return current progress without double-start.
  if (inflightArchives.has(documentId)) {
    return {
      ...quoteDocumentDataArchive(documentId, address),
      balance: getCreditBalance(address),
      accepted: true,
    }
  }

  const collected = resolveFramesForArchive(documentId, existing)
  const frameCount = collected.frameCount
  const credits = creditsForStreamTxCount(frameCount)
  if (credits <= 0) {
    throw new Error('Nothing to charge for empty data archive')
  }

  const { attempt, alreadyPaid, key: spendIdem, paidCredits } = resolveSpendAttempt(documentId)
  let balance = getCreditBalance(address)

  if (alreadyPaid && paidCredits != null && paidCredits < credits && !(existing?.framesHex?.length)) {
    throw new Error(
      `Paid ${paidCredits} credit(s) for this archive but ${credits} are required for ${frameCount} frames.`,
    )
  }

  if (!alreadyPaid) {
    const spend = applyCreditDelta({
      id: uuid(),
      walletAddress: address,
      delta: -credits,
      kind: 'spend',
      idempotencyKey: spendIdem,
      refDocumentId: documentId,
      feeNimAtEvent: getSealFeeNim(),
      meta: JSON.stringify({
        kind: 'data_archive',
        frameCount,
        credits,
        framesPerCredit: FRAMES_PER_DATA_ARCHIVE_CREDIT,
        source: collected.source,
        attempt,
        contentHash: collected.contentHash,
      }),
    })
    balance = spend.balance
  }

  const nowPin = Date.now()
  const chargedCredits =
    alreadyPaid && paidCredits != null ? paidCredits : credits
  existing = {
    documentId,
    originalSha256: collected.originalSha256,
    source: collected.source,
    frameCount,
    creditsCharged: chargedCredits,
    framesHex: collected.framesHex,
    txHashes: existing?.txHashes ?? [],
    onChain: false,
    confirmedFrames: existing?.confirmedFrames ?? 0,
    error: null,
    jobStatus: 'processing',
    createdAt: existing?.createdAt ?? nowPin,
    updatedAt: nowPin,
  }
  upsertDocumentDataArchive(existing)
  publishArchiveProgress(documentId, address)

  // Background work - do not await (avoids 524 gateway timeouts on multi-tx).
  const job = runBackgroundBroadcast({
    documentId,
    walletAddress: address,
    collected,
    attempt,
    spendIdem,
    chargedCredits,
  }).finally(() => {
    if (inflightArchives.get(documentId) === job) {
      inflightArchives.delete(documentId)
    }
    // Final snapshot for late SSE subscribers (complete / failed).
    publishArchiveProgress(documentId, address)
  })
  inflightArchives.set(documentId, job)

  return {
    ...quoteDocumentDataArchive(documentId, address),
    balance,
    accepted: true,
  }
}

async function runBackgroundBroadcast(input: {
  documentId: string
  walletAddress: string
  collected: CollectedFrames
  attempt: number
  spendIdem: string
  chargedCredits: number
}): Promise<void> {
  const { documentId, walletAddress, collected, attempt, chargedCredits } = input
  const prior = getDocumentDataArchive(documentId)
  const priorHashes = Array.isArray(prior?.txHashes) ? prior!.txHashes : []
  const safeResume =
    prior &&
    prior.framesHex.length === collected.framesHex.length &&
    framesContentHash(prior.framesHex) === collected.contentHash
      ? Math.min(priorHashes.length, collected.framesHex.length)
      : 0
  const remainingHex = collected.framesHex.slice(safeResume)
  let txHashes = safeResume > 0 ? priorHashes.slice(0, safeResume) : []

  const persist = (patch: Partial<DocumentDataArchiveRecord>) => {
    const cur = getDocumentDataArchive(documentId)
    const base: DocumentDataArchiveRecord = cur ?? {
      documentId,
      originalSha256: collected.originalSha256,
      source: collected.source,
      frameCount: collected.frameCount,
      creditsCharged: chargedCredits,
      framesHex: collected.framesHex,
      txHashes: [],
      onChain: false,
      confirmedFrames: 0,
      error: null,
      jobStatus: 'processing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    upsertDocumentDataArchive({
      ...base,
      framesHex: collected.framesHex,
      creditsCharged: chargedCredits,
      ...patch,
      updatedAt: Date.now(),
    })
    // Push live TX progress to SSE clients (one open stream per watching client).
    publishArchiveProgress(documentId, walletAddress)
  }

  try {
    if (remainingHex.length === 0) {
      if (txHashes.length === collected.framesHex.length && collected.framesHex.length > 0) {
        const verify = await verifyArchiveHeadEndOnChain(collected.framesHex, txHashes)
        const permanentFail =
          Boolean(verify.error) &&
          (verify.error!.includes('payload mismatch') ||
            verify.error!.includes('failed execution'))
        if (permanentFail) {
          persist({
            txHashes,
            confirmedFrames: verify.matched,
            onChain: false,
            jobStatus: 'failed',
            error: verify.error ?? 'On-chain frame sample verification failed',
          })
          return
        }
        if (!verify.ok) {
          // Do not claim on-chain success without HEAD/END sample match.
          // Credits already charged; free resume re-verifies without re-broadcast.
          persist({
            txHashes,
            confirmedFrames: verify.matched,
            onChain: false,
            jobStatus: 'failed',
            error:
              verify.error ??
              `Broadcast complete but chain samples not visible yet (${verify.matched}/${verify.checked}) — resume free to re-check`,
          })
          return
        }
        persist({
          txHashes,
          confirmedFrames: txHashes.length,
          onChain: true,
          jobStatus: 'complete',
          error: null,
        })
        fireArchiveNotifyEmail(documentId, txHashes.length, chargedCredits)
        return
      }
      // Incomplete pin / resume state - do not call broadcast with an empty batch
      // (that used to look like success with 0 hashes → false "broadcast failed").
      persist({
        txHashes,
        confirmedFrames: txHashes.length,
        onChain: false,
        jobStatus: 'failed',
        error:
          txHashes.length > 0
            ? `Resume needed: ${txHashes.length}/${collected.framesHex.length} frames on-chain - try Store forever again (free)`
            : 'No packed frames to broadcast (same multi-tx path as /pdf lab). Re-open and retry.',
      })
      return
    }

    // Same multi-tx path as /pdf lab (publishAnnotationStream → broadcastStreamFrames).
    // Use Buffer.copy into fixed 64-byte frames like packAnnotationStream does.
    const frames = remainingHex.map(hex => {
      const raw = Buffer.from(hex, 'hex')
      const f = Buffer.alloc(64)
      raw.copy(f, 0, 0, Math.min(64, raw.length))
      return f
    })
    console.log('[data-archive] broadcasting frames', {
      documentId,
      total: collected.framesHex.length,
      remaining: frames.length,
      resumeFrom: safeResume,
      source: collected.source,
    })
    const result = await broadcastStreamFrames(frames, {
      // Skip long visibility polling so large streams finish; hashes are persisted per frame.
      skipVisibilityWait: true,
      // Match /pdf pacing closely (was 120ms there).
      interFrameDelayMs: 120,
      onFrame: ({ hashes, index }) => {
        const all = [
          ...(safeResume > 0 ? priorHashes.slice(0, safeResume) : []),
          ...hashes,
        ]
        if (index === 0 || (index + 1) % 8 === 0 || index + 1 === frames.length) {
          console.log('[data-archive] frame progress', {
            documentId,
            done: all.length,
            total: collected.framesHex.length,
          })
        }
        persist({
          txHashes: all,
          confirmedFrames: all.length,
          onChain: false,
          jobStatus: 'processing',
          error: null,
        })
      },
    })

    const allHashes = [
      ...(safeResume > 0 ? priorHashes.slice(0, safeResume) : []),
      ...result.hashes,
    ]
    txHashes = allHashes

    if (allHashes.length === collected.framesHex.length) {
      // HEAD+END sample: prefer hard match; permanent payload errors fail the job.
      const verify = await verifyArchiveHeadEndOnChain(collected.framesHex, allHashes)
      const permanentFail =
        Boolean(verify.error) &&
        (verify.error!.includes('payload mismatch') ||
          verify.error!.includes('failed execution'))
      if (!verify.ok) {
        console.warn('[data-archive] chain sample incomplete — not marking onChain', {
          documentId,
          checked: verify.checked,
          matched: verify.matched,
          error: verify.error,
          permanentFail,
        })
        persist({
          txHashes: allHashes,
          confirmedFrames: verify.matched,
          onChain: false,
          jobStatus: 'failed',
          error:
            verify.error ??
            `Broadcast ${allHashes.length} frames but chain samples not confirmed (${verify.matched}/${verify.checked}) — resume free to re-check`,
        })
        return
      }
      persist({
        txHashes: allHashes,
        confirmedFrames: allHashes.length,
        onChain: true,
        jobStatus: 'complete',
        error: result.error ?? null,
      })
      console.log('[data-archive] complete', {
        documentId,
        frames: allHashes.length,
        credits: chargedCredits,
        chainSamples: verify.matched,
        samplesOk: true,
      })
      fireArchiveNotifyEmail(documentId, allHashes.length, chargedCredits)
      return
    }

    if (allHashes.length > 0) {
      // Partial - keep charge, leave idle so client can resume free.
      persist({
        txHashes: allHashes,
        confirmedFrames: allHashes.length,
        onChain: false,
        jobStatus: 'failed',
        error:
          result.error ??
          `Partial write: ${allHashes.length}/${collected.framesHex.length} frames - resume free of charge`,
      })
      return
    }

    // Zero hashes - refund so user is not stranded after 524 / wallet empty.
    const refundCredits = chargedCredits
    if (!getLedgerByIdempotencyKey(refundKey(documentId, attempt))) {
      try {
        applyCreditDelta({
          id: uuid(),
          walletAddress,
          delta: refundCredits,
          kind: 'refund_release',
          idempotencyKey: refundKey(documentId, attempt),
          refDocumentId: documentId,
          feeNimAtEvent: getSealFeeNim(),
          meta: JSON.stringify({
            kind: 'data_archive_refund',
            reason: result.error ?? 'broadcast_failed_zero_hashes',
            attempt,
            credits: refundCredits,
          }),
        })
        console.log('[data-archive] refunded after zero-hash failure', {
          documentId,
          credits: refundCredits,
        })
      } catch (refundErr) {
        console.error('[data-archive] refund failed', refundErr)
      }
    }
    const failMsg =
      result.error ||
      'Could not broadcast data frames on-chain (same path as /pdf lab). Credits refunded if nothing was written.'
    console.error('[data-archive] zero-hash failure', {
      documentId,
      error: failMsg,
      remaining: frames.length,
    })
    persist({
      txHashes: [],
      confirmedFrames: 0,
      onChain: false,
      creditsCharged: 0,
      jobStatus: 'failed',
      error: failMsg,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[data-archive] background job failed', { documentId, msg })
    const cur = getDocumentDataArchive(documentId)
    const hashes = cur?.txHashes ?? []
    if (hashes.length === 0) {
      if (!getLedgerByIdempotencyKey(refundKey(documentId, attempt))) {
        try {
          applyCreditDelta({
            id: uuid(),
            walletAddress,
            delta: chargedCredits,
            kind: 'refund_release',
            idempotencyKey: refundKey(documentId, attempt),
            refDocumentId: documentId,
            feeNimAtEvent: getSealFeeNim(),
            meta: JSON.stringify({
              kind: 'data_archive_refund',
              reason: msg,
              attempt,
            }),
          })
        } catch (refundErr) {
          console.error('[data-archive] refund failed', refundErr)
        }
      }
      persist({
        txHashes: [],
        confirmedFrames: 0,
        onChain: false,
        creditsCharged: 0,
        jobStatus: 'failed',
        error: `${msg} (credits refunded if no frames were written)`,
      })
    } else {
      persist({
        txHashes: hashes,
        confirmedFrames: hashes.length,
        onChain: false,
        jobStatus: 'failed',
        error: `${msg} - partial progress kept; resume free of charge`,
      })
    }
  }
}

/**
 * Lightweight summary for agreement list cards (creator view).
 * Avoids packing frames / scanning full placement JSON on every /api/me load -
 * expensive quote packing stays on GET/POST .../on-chain-data (modal open).
 */
export function dataArchiveSummaryForDocument(documentId: string): {
  onChain: boolean
  eligible: boolean
  frameCount: number
  credits: number
  reason?: string
} | null {
  try {
    const doc = getDocumentById(documentId)
    if (!doc) return null

    const existing = getDocumentDataArchive(documentId)
    if (existing?.onChain) {
      return {
        onChain: true,
        eligible: false,
        frameCount: existing.frameCount,
        credits: existing.creditsCharged || creditsForStreamTxCount(existing.frameCount),
        reason: 'Signatures and fields are already stored on Nimiq',
      }
    }

    // Resume / mid-flight: show cheap status from stored row without re-packing.
    if (existing && existing.framesHex.length > 0 && (existing.creditsCharged > 0 || existing.jobStatus === 'processing')) {
      const locked = doc.status === 'locked'
      const broadcastReady =
        isAnnotationStreamBroadcastEnabled() && isServiceWalletConfigured()
      const processing =
        existing.jobStatus === 'processing' || inflightArchives.has(documentId)
      const eligible =
        locked &&
        isCreditsEnabled() &&
        broadcastReady &&
        !existing.onChain &&
        !processing
      return {
        onChain: false,
        eligible,
        frameCount: existing.frameCount || existing.framesHex.length,
        credits:
          existing.creditsCharged ||
          creditsForStreamTxCount(existing.frameCount || existing.framesHex.length),
        ...(processing
          ? { reason: 'Writing to the Nimiq blockchain…' }
          : eligible
            ? existing.creditsCharged > 0
              ? { reason: 'Resume free - credits already reserved' }
              : {}
            : {
                reason: !locked
                  ? 'Lock the fingerprint first, then archive signatures on-chain'
                  : !isCreditsEnabled()
                    ? 'Credits are not enabled'
                    : !broadcastReady
                      ? 'On-chain data broadcast is not configured'
                      : existing.error || undefined,
              }),
      }
    }

    if (doc.status !== 'locked') return null

    // Cheap eligibility: any placement frames or annotations without packing.
    const plan = resolvePlacementPlan({
      originalSha256: doc.originalSha256,
      documentId,
    })
    let frameHint = 0
    if (plan) {
      frameHint += (plan.batch0FramesHex ?? []).filter(
        h => typeof h === 'string' && /^[a-f0-9]{128}$/i.test(h),
      ).length
      for (const b of plan.fillBatches ?? []) {
        frameHint += (b.framesHex ?? []).filter(
          h => typeof h === 'string' && /^[a-f0-9]{128}$/i.test(h),
        ).length
      }
    }
    if (frameHint === 0 && Array.isArray(doc.annotations) && doc.annotations.length > 0) {
      // Unknown exact pack size until modal quote; show as eligible with placeholder 0
      // credits so UI still surfaces upsell - requestArchive loads the real quote.
      frameHint = -1
    }
    if (frameHint === 0) {
      // Signatures / wallets only (manifest stream) still worth archiving.
      const m = buildArchiveManifest(documentId)
      if (m && (m.sigs.length > 0 || m.people.some(p => p.w))) {
        frameHint = -1
      }
    }
    if (frameHint === 0) return null

    const creditsEnabled = isCreditsEnabled()
    const broadcastReady =
      isAnnotationStreamBroadcastEnabled() && isServiceWalletConfigured()
    const eligible = creditsEnabled && broadcastReady
    const frameCount = frameHint > 0 ? frameHint : 0
    const credits = frameCount > 0 ? creditsForStreamTxCount(frameCount) : 0

    return {
      onChain: false,
      eligible,
      frameCount,
      credits,
      ...(eligible
        ? {}
        : {
            reason: !creditsEnabled
              ? 'Credits are not enabled'
              : 'On-chain data broadcast is not configured',
          }),
    }
  } catch {
    return null
  }
}

// ── Public chain-data index + reconstruct (hash-only lookup) ───────────────

export function publicChainDataIndex(originalSha256: string): {
  originalSha256: string
  found: boolean
  onChain: boolean
  frameCount: number
  confirmedFrames: number
  txHashes: string[]
  source: DocumentDataArchiveSource | null
  /** Omitted from product index intentionally (lab/private ids not exposed). */
  documentId: string | null
  serviceWalletAddress: string | null
  updatedAt: number | null
} {
  const hash = originalSha256.toLowerCase()
  const row = getDocumentDataArchiveBySha256(hash)
  if (!row) {
    return {
      originalSha256: hash,
      found: false,
      onChain: false,
      frameCount: 0,
      confirmedFrames: 0,
      txHashes: [],
      source: null,
      documentId: null,
      serviceWalletAddress: getServiceWalletAddress(),
      updatedAt: null,
    }
  }
  return {
    originalSha256: row.originalSha256,
    found: true,
    onChain: row.onChain,
    frameCount: row.frameCount,
    confirmedFrames: row.confirmedFrames,
    txHashes: row.txHashes,
    source: row.source,
    // Do not leak internal document UUID on public index
    documentId: null,
    serviceWalletAddress: getServiceWalletAddress(),
    updatedAt: row.updatedAt,
  }
}

/**
 * Reconstruct archive payload for a PDF fingerprint.
 * - source=wire: unpack stored frames (fast, same bytes we broadcast)
 * - source=chain: re-read recipientData from each tx hash in the DB index
 * - source=scan: discover frames on Nimiq by 8-byte association id (hash-only)
 * - source=auto (default): wire if indexed, else scan by hash
 */
export async function reconstructArchiveBySha256(
  originalSha256: string,
  options?: { source?: 'wire' | 'chain' | 'scan' | 'auto' },
): Promise<{
  originalSha256: string
  source: 'wire' | 'chain' | 'scan'
  onChain: boolean
  frameCount: number
  txHashes: string[]
  integrityOk: boolean
  unpacked: ReturnType<typeof unpackArchiveFrames>
  chainError?: string
  scanMeta?: {
    scannedTxs: number
    truncated: boolean
    streamCount: number
    scanAddresses: string[]
  }
}> {
  const hash = originalSha256.toLowerCase()
  const mode = options?.source ?? 'auto'
  const row = getDocumentDataArchiveBySha256(hash)

  const tryUnpack = (
    framesHex: string[],
    source: 'wire' | 'chain' | 'scan',
    txHashes: string[],
    onChain: boolean,
    extra?: {
      chainError?: string
      integrityOk?: boolean
      scanMeta?: {
        scannedTxs: number
        truncated: boolean
        streamCount: number
        scanAddresses: string[]
      }
    },
  ) => {
    const unpacked = unpackArchiveFrames(framesHex)
    if (unpacked.originalSha256 !== hash) {
      throw new Error('Unpacked stream fingerprint does not match request')
    }
    const integrityOk =
      extra?.integrityOk !== undefined
        ? extra.integrityOk
        : !extra?.chainError && !(extra?.scanMeta?.truncated)
    return {
      originalSha256: hash,
      source,
      onChain,
      frameCount: framesHex.length,
      txHashes,
      integrityOk,
      unpacked,
      ...(extra?.chainError ? { chainError: extra.chainError } : {}),
      ...(extra?.scanMeta ? { scanMeta: extra.scanMeta } : {}),
    }
  }

  const fromScan = async () => {
    const scan = await scanArchiveByPdfHash(hash)
    if (!scan.found || scan.framesHex.length === 0) {
      throw new Error(
        scan.error ||
          'No archive frames found on Nimiq for this fingerprint (scanned service wallet)',
      )
    }
    // Truncated history is not full integrity even if streams unpack.
    const integrityOk = !scan.truncated
    return tryUnpack(scan.framesHex, 'scan', scan.txHashes, integrityOk, {
      integrityOk,
      chainError: scan.truncated
        ? 'Chain history scan was truncated — older frames may be missing; integrity not guaranteed'
        : undefined,
      scanMeta: {
        scannedTxs: scan.scannedTxs,
        truncated: scan.truncated,
        streamCount: scan.streamCount,
        scanAddresses: scan.scanAddresses,
      },
    })
  }

  if (mode === 'scan') {
    return fromScan()
  }

  if (mode === 'wire') {
    if (!row?.framesHex?.length) {
      throw new Error('No stored archive frames for this fingerprint')
    }
    return tryUnpack(row.framesHex, 'wire', row.txHashes, row.onChain)
  }

  if (mode === 'chain') {
    if (!row?.txHashes?.length || !row.framesHex?.length) {
      // No index — fall back to full scan by association id
      return fromScan()
    }
    if (row.txHashes.length !== row.framesHex.length) {
      throw new Error(
        `Incomplete tx set: ${row.txHashes.length}/${row.framesHex.length} frames broadcast`,
      )
    }
    try {
      const fromChain: string[] = []
      for (let i = 0; i < row.txHashes.length; i++) {
        const txHash = row.txHashes[i]!
        if (i > 0) await new Promise(r => setTimeout(r, 150))
        const tx = await fetchTransaction(txHash)
        if (!tx) throw new Error(`Tx not found: ${txHash.slice(0, 12)}…`)
        if (tx.executionResult === false) {
          throw new Error(`Tx ${txHash.slice(0, 12)}… failed execution`)
        }
        const bytes = decodeRecipientDataBytes(tx.recipientData)
        if (bytes.length !== 64) {
          throw new Error(`Invalid frame size ${bytes.length} for ${txHash.slice(0, 12)}…`)
        }
        fromChain.push(Buffer.from(bytes).toString('hex').toLowerCase())
      }
      return tryUnpack(fromChain, 'chain', row.txHashes, true)
    } catch (err) {
      const chainError = err instanceof Error ? err.message : String(err)
      try {
        return tryUnpack(row.framesHex, 'wire', row.txHashes, row.onChain, { chainError })
      } catch {
        throw new Error(`Chain reconstruct failed: ${chainError}`)
      }
    }
  }

  // auto: prefer server index, else hash-only scan
  if (row?.framesHex?.length) {
    return tryUnpack(row.framesHex, 'wire', row.txHashes, row.onChain)
  }
  return fromScan()
}

/** Recovery package for download after archive completes (offline companion). */
export function recoveryPackageForDocument(documentId: string): {
  version: 1
  kind: 'verilock_data_archive_recovery'
  originalSha256: string
  documentId: string
  onChain: boolean
  frameCount: number
  txHashes: string[]
  framesHex: string[]
  source: DocumentDataArchiveSource
  serviceWalletAddress: string | null
  exportedAt: number
} | null {
  const row = getDocumentDataArchive(documentId)
  if (!row || row.framesHex.length === 0) return null
  return {
    version: 1,
    kind: 'verilock_data_archive_recovery',
    originalSha256: row.originalSha256,
    documentId: row.documentId,
    onChain: row.onChain,
    frameCount: row.frameCount,
    txHashes: row.txHashes,
    framesHex: row.framesHex,
    source: row.source,
    serviceWalletAddress: getServiceWalletAddress(),
    exportedAt: Date.now(),
  }
}
