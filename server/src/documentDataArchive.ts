/**
 * Paid multi-tx on-chain data archive for agreements.
 *
 * Uses the same 64-byte Nimiq frame packing proven in the /pdf experiment:
 * - Production: placement plan batch0 + fill batch frames (signatures, initials, text)
 * - Legacy/experiment: free-form document.annotations packed as v1 annotation stream
 *
 * Pricing: 1 credit per 10 txs, rounded up (ceil). Example: 51 frames → 6 credits.
 *
 * Security invariants:
 * - Creator-only; document must already be fingerprint-locked
 * - Credits spent once per attempt; full failure refunds; partial keeps charge
 * - Concurrent archives for the same document coalesce (no double broadcast)
 * - After charge, frames are pinned — later fill growth cannot free-ride
 * - Partial broadcast resumes from the first missing frame index
 */
import { createHash } from 'node:crypto'
import { v4 as uuid } from 'uuid'
import { normalizeAddress } from './addresses.js'
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
  getLedgerByIdempotencyKey,
  resolvePlacementPlan,
  upsertDocumentDataArchive,
  type DocumentDataArchiveRecord,
  type DocumentDataArchiveSource,
} from './db.js'
import { sanitizeAnnotations } from './security.js'
import { getSealFeeNim } from './sealPricing.js'
import { isServiceWalletConfigured } from './serviceWallet.js'

const MAX_ARCHIVE_FRAMES = 128

/** Placement stream version byte (v2). Annotation free-form is v1. */
const STREAM_VERSION_ANNOTATION = 1
const STREAM_VERSION_PLACEMENT = 2

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
  return createHash('sha256').update(framesHex.join('')).digest('hex')
}

/** Accept well-formed 64-byte VeriLock stream frames (magic 0xA1, version 1 or 2). */
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
  // v1 = free-form annotation stream (/pdf lab); v2 = placement construction stream
  if (ver !== STREAM_VERSION_ANNOTATION && ver !== STREAM_VERSION_PLACEMENT) {
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

/** Collect packed 64-byte frames for a document (placements preferred). */
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
      validateFramesHex(frames, 'placements')
      return {
        source: 'placements',
        framesHex: frames,
        frameCount: frames.length,
        originalSha256: hash,
        contentHash: framesContentHash(frames),
      }
    }
  }

  const annotations = sanitizeAnnotations(doc.annotations)
  if (annotations && annotations.length > 0) {
    const packed = packAnnotationStream(hash, annotations)
    const framesHex = packed.map(f => f.toString('hex'))
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
  /** idle | processing | complete | failed — processing means server is writing in background. */
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
    : frameCount > 0
      ? Math.min(99, Math.round((hashes / frameCount) * 100))
      : 0

  let reason: string | undefined
  let eligible = false
  if (onChain) {
    reason = 'Signatures and fields are already stored on the Nimiq blockchain'
  } else if (jobStatus === 'processing') {
    reason = 'Writing to the Nimiq blockchain in the background…'
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
          ? `Resume free — ${hashes}/${frameCount} frames already written (no extra charge)`
          : 'Credits already reserved — resume storage free of charge'
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

/** In-process background jobs — one per document. */
const inflightArchives = new Map<string, Promise<void>>()

/** Optional completion emails requested at job start (key = documentId). */
const pendingNotifyEmails = new Map<string, string>()

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
 * Client should poll GET .../on-chain-data until jobStatus is complete/failed.
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

  // Already running in this process — return current progress without double-start.
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

  // Background work — do not await (avoids 524 gateway timeouts on multi-tx).
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
  }

  try {
    if (remainingHex.length === 0) {
      if (txHashes.length === collected.framesHex.length && collected.framesHex.length > 0) {
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
      // Incomplete pin / resume state — do not call broadcast with an empty batch
      // (that used to look like success with 0 hashes → false "broadcast failed").
      persist({
        txHashes,
        confirmedFrames: txHashes.length,
        onChain: false,
        jobStatus: 'failed',
        error:
          txHashes.length > 0
            ? `Resume needed: ${txHashes.length}/${collected.framesHex.length} frames on-chain — try Store forever again (free)`
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
      })
      fireArchiveNotifyEmail(documentId, allHashes.length, chargedCredits)
      return
    }

    if (allHashes.length > 0) {
      // Partial — keep charge, leave idle so client can resume free.
      persist({
        txHashes: allHashes,
        confirmedFrames: allHashes.length,
        onChain: false,
        jobStatus: 'failed',
        error:
          result.error ??
          `Partial write: ${allHashes.length}/${collected.framesHex.length} frames — resume free of charge`,
      })
      return
    }

    // Zero hashes — refund so user is not stranded after 524 / wallet empty.
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
        error: `${msg} — partial progress kept; resume free of charge`,
      })
    }
  }
}

/**
 * Lightweight summary for agreement list cards (creator view).
 * Avoids packing frames / scanning full placement JSON on every /api/me load —
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
              ? { reason: 'Resume free — credits already reserved' }
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
      // credits so UI still surfaces upsell — requestArchive loads the real quote.
      frameHint = -1
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
