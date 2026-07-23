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

/** Accept only well-formed 64-byte VeriLock stream frames (magic 0xA1 + known version). */
function assertValidStreamFrameHex(hex: string, index: number, source: DocumentDataArchiveSource): void {
  if (typeof hex !== 'string' || !/^[a-f0-9]{128}$/i.test(hex)) {
    throw new Error(`Invalid frame hex at index ${index}`)
  }
  const buf = Buffer.from(hex, 'hex')
  if (buf.length !== 64) {
    throw new Error(`Frame ${index} is ${buf.length} bytes (need 64)`)
  }
  if (buf[0] !== STREAM_MAGIC) {
    throw new Error(`Frame ${index} has bad stream magic`)
  }
  const ver = buf[1]!
  if (source === 'placements') {
    if (ver !== STREAM_VERSION_PLACEMENT) {
      throw new Error(`Frame ${index} is not a placement stream (v2) frame`)
    }
  } else if (ver !== STREAM_VERSION_ANNOTATION) {
    throw new Error(`Frame ${index} is not an annotation stream (v1) frame`)
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

  let collected: CollectedFrames | null = null
  let collectError: string | undefined
  try {
    // Quote shows live collect when not yet charged; after charge show pinned set.
    if (existing?.framesHex?.length && existing.creditsCharged > 0) {
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

  let reason: string | undefined
  let eligible = false
  if (onChain) {
    reason = 'Signatures and fields are already stored on Nimiq'
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
    creditsCharged: existing?.creditsCharged ?? 0,
    txHashes: existing?.txHashes ?? [],
    confirmedFrames: existing?.confirmedFrames ?? 0,
    balance,
    broadcastReady,
    creditsEnabled,
    error: existing?.error ?? null,
  }
}

type ArchiveResult = DataArchiveQuote & {
  balance: number
  broadcastError?: string
  partialBroadcast?: boolean
}

/** Coalesce concurrent archive attempts for the same document. */
const inflightArchives = new Map<string, Promise<ArchiveResult>>()

/**
 * Charge credits (if not already paid) and broadcast packed frames on Nimiq.
 * Idempotent: re-broadcasts free of charge when credits were already spent.
 * Concurrent callers share one in-flight promise (no double spend / double tx).
 */
export async function archiveDocumentDataOnChain(
  documentId: string,
  creatorAddress: string,
): Promise<ArchiveResult> {
  const existingPromise = inflightArchives.get(documentId)
  if (existingPromise) return existingPromise

  const run = runArchiveDocumentDataOnChain(documentId, creatorAddress).finally(() => {
    if (inflightArchives.get(documentId) === run) {
      inflightArchives.delete(documentId)
    }
  })
  inflightArchives.set(documentId, run)
  return run
}

async function runArchiveDocumentDataOnChain(
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
    }
  }

  const collected = resolveFramesForArchive(documentId, existing)
  const frameCount = collected.frameCount
  const credits = creditsForStreamTxCount(frameCount)
  if (credits <= 0) {
    throw new Error('Nothing to charge for empty data archive')
  }

  // Spend once per successful attempt. Partial broadcast keeps the charge; full
  // failure refunds so the next attempt can charge again.
  const { attempt, alreadyPaid, key: spendIdem, paidCredits } = resolveSpendAttempt(documentId)
  let balance = getCreditBalance(address)

  // If already paid, credits must match the pinned frame set (no free upgrades).
  if (alreadyPaid && paidCredits != null && paidCredits < credits) {
    throw new Error(
      `Paid ${paidCredits} credit(s) for this archive but ${credits} are required for ${frameCount} frames. Contact support or start a new agreement.`,
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

    // Pin frames immediately after charge so a crash mid-broadcast still resumes safely.
    const nowPin = Date.now()
    existing = {
      documentId,
      originalSha256: collected.originalSha256,
      source: collected.source,
      frameCount,
      creditsCharged: credits,
      framesHex: collected.framesHex,
      txHashes: existing?.txHashes ?? [],
      onChain: false,
      confirmedFrames: existing?.confirmedFrames ?? 0,
      error: null,
      createdAt: existing?.createdAt ?? nowPin,
      updatedAt: nowPin,
    }
    upsertDocumentDataArchive(existing)
  }

  const now = Date.now()
  // Resume: skip frames already broadcast on a prior partial attempt.
  const priorHashes = Array.isArray(existing?.txHashes) ? existing!.txHashes : []
  const resumeFrom = Math.min(
    priorHashes.length,
    collected.framesHex.length,
  )
  // Only trust prior hashes when frames match the pinned set length or content.
  const safeResume =
    existing &&
    existing.framesHex.length === collected.framesHex.length &&
    framesContentHash(existing.framesHex) === collected.contentHash
      ? resumeFrom
      : 0

  const remainingHex = collected.framesHex.slice(safeResume)
  const priorKept = safeResume > 0 ? priorHashes.slice(0, safeResume) : []

  let txHashes: string[] = [...priorKept]
  let confirmedFrames = existing?.confirmedFrames ?? 0
  let onChain = false
  let broadcastError: string | undefined
  let partialBroadcast = false

  try {
    if (remainingHex.length === 0) {
      // Already have hashes for every frame from a prior attempt.
      txHashes = priorKept.length === collected.framesHex.length
        ? priorKept
        : priorHashes
      if (txHashes.length === collected.framesHex.length) {
        onChain = true
        confirmedFrames = Math.max(confirmedFrames, txHashes.length)
      }
    } else {
      const frames = remainingHex.map(hex => Buffer.from(hex, 'hex'))
      const result = await broadcastStreamFrames(frames)
      txHashes = [...priorKept, ...result.hashes]
      confirmedFrames = priorKept.length + result.confirmed
      partialBroadcast = result.partial || txHashes.length < collected.framesHex.length

      if (txHashes.length === collected.framesHex.length) {
        onChain = true
        if (result.confirmed < frames.length) {
          partialBroadcast = true
          broadcastError =
            result.error ??
            `Broadcast all ${collected.framesHex.length} frames; ${confirmedFrames} visible so far (mempool/RPC lag).`
        }
      } else if (txHashes.length > 0) {
        partialBroadcast = true
        onChain = false
        broadcastError =
          result.error ??
          `Partial broadcast: ${txHashes.length}/${collected.framesHex.length} frames sent`
      } else {
        broadcastError = result.error ?? 'Broadcast produced no transaction hashes'
        onChain = false
      }
    }
  } catch (err) {
    broadcastError = err instanceof Error ? err.message : String(err)
    onChain = false
  }

  // Full failure with zero hashes ever: refund this attempt so the user can retry.
  // Never refund if any prior or current frame hash exists (partial on-chain work must stay paid).
  const hadPriorHashes = priorHashes.length > 0 || priorKept.length > 0
  const refundCredits = alreadyPaid
    ? paidCredits ?? existing?.creditsCharged ?? credits
    : credits

  if (!onChain && txHashes.length === 0 && !hadPriorHashes) {
    if (!getLedgerByIdempotencyKey(refundKey(documentId, attempt))) {
      try {
        const refund = applyCreditDelta({
          id: uuid(),
          walletAddress: address,
          delta: refundCredits,
          kind: 'refund_release',
          idempotencyKey: refundKey(documentId, attempt),
          refDocumentId: documentId,
          feeNimAtEvent: getSealFeeNim(),
          meta: JSON.stringify({
            kind: 'data_archive_refund',
            reason: broadcastError ?? 'broadcast_failed',
            attempt,
            credits: refundCredits,
          }),
        })
        balance = refund.balance
      } catch (refundErr) {
        console.error('[data-archive] refund failed', refundErr)
      }
    }
  }

  const charged =
    Boolean(getLedgerByIdempotencyKey(spendIdem)) &&
    !getLedgerByIdempotencyKey(refundKey(documentId, attempt))

  const record: DocumentDataArchiveRecord = {
    documentId,
    originalSha256: collected.originalSha256,
    source: collected.source,
    frameCount,
    creditsCharged: charged ? (paidCredits ?? credits) : 0,
    framesHex: collected.framesHex,
    txHashes,
    onChain,
    confirmedFrames,
    error: broadcastError ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertDocumentDataArchive(record)

  if (!onChain && txHashes.length === 0) {
    throw new Error(broadcastError ?? 'Could not broadcast data frames on-chain')
  }

  // Partial progress is a soft success: credits stay charged; client can retry to resume.
  const quote = quoteDocumentDataArchive(documentId, address)
  return {
    ...quote,
    balance,
    ...(broadcastError ? { broadcastError } : {}),
    ...(partialBroadcast ? { partialBroadcast: true } : {}),
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
    if (existing && existing.framesHex.length > 0 && existing.creditsCharged > 0) {
      const locked = doc.status === 'locked'
      const broadcastReady =
        isAnnotationStreamBroadcastEnabled() && isServiceWalletConfigured()
      const eligible =
        locked && isCreditsEnabled() && broadcastReady && !existing.onChain
      return {
        onChain: false,
        eligible,
        frameCount: existing.frameCount || existing.framesHex.length,
        credits:
          existing.creditsCharged ||
          creditsForStreamTxCount(existing.frameCount || existing.framesHex.length),
        ...(eligible
          ? {}
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
