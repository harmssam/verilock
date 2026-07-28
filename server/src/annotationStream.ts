/**
 * Pack/unpack annotation streams into 64-byte Nimiq basic-tx frames.
 * Keep framing compatible with client/src/pdf/annotationStream.ts.
 *
 * Magic 0xA1 - distinct from seal attestation 0x01 (37-byte).
 */
import { createHash } from 'node:crypto'
import { Address, TransactionBuilder } from '@nimiq/core'
import { normalizeAddress } from './addresses.js'
import {
  broadcastRawTransactionDetailed,
  decodeRecipientDataBytes,
  fetchTransaction,
  getBroadcastClientForService,
  getExpectedAttestationRecipient,
  getWalletBalanceLuna,
  waitForTransactionVisible,
} from './nimiq-rpc.js'
import { isServiceWalletConfigured } from './serviceWallet.js'
import { sanitizeAnnotations } from './security.js'
import {
  getAnnotationStream,
  upsertAnnotationStream,
  type AnnotationStreamRecord,
} from './db.js'

export const STREAM_MAGIC = 0xa1
export const STREAM_VERSION = 1
export const FRAME_SIZE = 64
/**
 * Frame header (new layout, 2026-07):
 * [0] magic  [1] version  [2] type  [3] seq  [4] total
 * [5..12] 8-byte association id = first 8 bytes of PDF SHA-256
 * [13..63] body (51 B)
 *
 * Legacy layout used a 4-byte hash prefix and body at offset 9 — still readable
 * via detectFrameLayout() for older on-chain frames.
 */
export const ASSOC_LEN = 8
export const FRAME_HEADER = 5 + ASSOC_LEN // 13
export const FRAME_BODY = FRAME_SIZE - FRAME_HEADER // 51
/** Pre-assoc layout (4-byte prefix, body @ 9). */
export const FRAME_HEADER_LEGACY = 9
export const ASSOC_LEN_LEGACY = 4
export const FRAME_HEAD = 1
export const FRAME_DATA = 2
export const FRAME_END = 3

/**
 * Per-stream frame cap (HEAD + DATA* + END).
 * Wire layout stores `total` in a single byte (`frame[4]`), so 255 is the hard max.
 * Abuse still limited by rate limit + service-wallet balance + credits.
 */
export const MAX_STREAM_FRAMES = 255
/** Match credit seal dust value so sinks/network treat frames like paid proofs. */
export const STREAM_FRAME_VALUE_LUNA = 1
const STREAM_FEE_BUFFER_LUNA = 10
/** Per-frame visibility wait after broadcast (keep short - many frames). */
const VISIBILITY_TIMEOUT_MS = 4_000
const VISIBILITY_POLL_MS = 800
/** After all broadcasts, one quick pass over hashes (no multi-minute waits). */
const POST_BROADCAST_CONFIRM_MS = 12_000
const HEAD_REFRESH_EVERY = 8

export function isAnnotationStreamBroadcastEnabled(): boolean {
  const raw = process.env.ANNOTATION_STREAM_BROADCAST?.trim().toLowerCase()
  if (raw === '0' || raw === 'false' || raw === 'off') return false
  // Default on in non-production when service wallet exists; require explicit enable in prod.
  if (process.env.NODE_ENV === 'production') {
    return raw === '1' || raw === 'true' || raw === 'on'
  }
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]!
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function hexToBytes(hex: string): Buffer {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(clean)) throw new Error('pdf hash must be 64 hex chars')
  return Buffer.from(clean, 'hex')
}

/** First 8 bytes of the PDF SHA-256 — association id for hash-only chain scan. */
export function associationIdFromPdfHash(pdfSha256: string | Buffer): Buffer {
  if (Buffer.isBuffer(pdfSha256)) {
    if (pdfSha256.length < ASSOC_LEN) throw new Error('pdf hash too short for association id')
    return pdfSha256.subarray(0, ASSOC_LEN)
  }
  const clean = pdfSha256.replace(/^0x/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(clean)) throw new Error('pdf hash must be 64 hex chars')
  return Buffer.from(clean.slice(0, ASSOC_LEN * 2), 'hex')
}

export function writeStreamFrameHeader(
  frame: Buffer,
  version: number,
  type: number,
  seq: number,
  total: number,
  pdfHashOrAssoc: Buffer,
): void {
  frame[0] = STREAM_MAGIC
  frame[1] = version & 0xff
  frame[2] = type
  frame[3] = seq & 0xff
  frame[4] = total & 0xff
  const assoc =
    pdfHashOrAssoc.length >= ASSOC_LEN
      ? pdfHashOrAssoc.subarray(0, ASSOC_LEN)
      : associationIdFromPdfHash(pdfHashOrAssoc)
  assoc.copy(frame, 5, 0, ASSOC_LEN)
}

function writeHeader(
  frame: Buffer,
  type: number,
  seq: number,
  total: number,
  hashPrefix: Buffer,
): void {
  writeStreamFrameHeader(frame, STREAM_VERSION, type, seq, total, hashPrefix)
}

/**
 * Detect body offset for a frame. When `expectedPdfHash` is known (reconstruct),
 * match the 8-byte or legacy 4-byte association id. HEAD frames can self-detect.
 */
export function detectFrameLayout(
  frame: Buffer,
  expectedPdfHash?: string | null,
): { header: number; assocLen: number } {
  if (frame.length !== FRAME_SIZE || frame[0] !== STREAM_MAGIC) {
    return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
  }
  if (expectedPdfHash) {
    const want = associationIdFromPdfHash(expectedPdfHash)
    if (frame.subarray(5, 5 + ASSOC_LEN).equals(want)) {
      return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
    }
    if (frame.subarray(5, 5 + ASSOC_LEN_LEGACY).equals(want.subarray(0, ASSOC_LEN_LEGACY))) {
      return { header: FRAME_HEADER_LEGACY, assocLen: ASSOC_LEN_LEGACY }
    }
  }
  if (frame[2] === FRAME_HEAD) {
    const fullAtNew = frame.subarray(FRAME_HEADER, FRAME_HEADER + 32)
    const fullAtLegacy = frame.subarray(FRAME_HEADER_LEGACY, FRAME_HEADER_LEGACY + 32)
    if (frame.subarray(5, 5 + ASSOC_LEN).equals(fullAtNew.subarray(0, ASSOC_LEN))) {
      return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
    }
    if (
      frame.subarray(5, 5 + ASSOC_LEN_LEGACY).equals(fullAtLegacy.subarray(0, ASSOC_LEN_LEGACY))
    ) {
      return { header: FRAME_HEADER_LEGACY, assocLen: ASSOC_LEN_LEGACY }
    }
  }
  // Default to new layout for freshly packed frames
  return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
}

export function frameAssociationHex(frame: Buffer, assocLen = ASSOC_LEN): string {
  return frame.subarray(5, 5 + assocLen).toString('hex')
}

/** Shorten floats in wire JSON (big win for long signature paths). */
function q(n: unknown, digits = 4): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 0
  const p = 10 ** digits
  return Math.round(v * p) / p
}

function slimPath(path: unknown): unknown {
  if (!path || typeof path !== 'object') return path
  const p = path as {
    epsilon?: number
    lineWidthRatio?: number
    strokes?: Array<{ points?: Array<{ x?: number; y?: number }> }>
  }
  return {
    epsilon: q(p.epsilon, 2),
    lineWidthRatio: q(p.lineWidthRatio, 4),
    strokes: Array.isArray(p.strokes)
      ? p.strokes.map(s => ({
          points: Array.isArray(s.points)
            ? s.points.map(pt => ({ x: q(pt.x), y: q(pt.y) }))
            : [],
        }))
      : [],
  }
}

/** Strip PNG; keep path / text / marks for wire JSON. Always emit mark colors. */
export function slimAnnotations(annotations: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const item of annotations) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    if (a.type === 'signature') {
      out.push({
        t: 's',
        page: a.pageIndex,
        x: q(a.x),
        y: q(a.y),
        w: q(a.width),
        h: q(a.height),
        ...(a.path ? { path: slimPath(a.path) } : {}),
      })
    } else if (a.type === 'text') {
      out.push({
        t: 'x',
        page: a.pageIndex,
        x: q(a.x),
        y: q(a.y),
        w: q(a.width),
        h: q(a.height),
        text: a.text,
        ...(a.fontSizeRatio != null ? { font: q(a.fontSizeRatio, 4) } : {}),
        color: typeof a.color === 'string' ? a.color : '#0f172a',
      })
    } else if (a.type === 'checkmark' || a.type === 'cross') {
      const defaultColor = a.type === 'checkmark' ? '#0f766e' : '#b91c1c'
      out.push({
        t: a.type === 'checkmark' ? 'c' : 'k',
        page: a.pageIndex,
        x: q(a.x),
        y: q(a.y),
        w: q(a.width),
        h: q(a.height),
        color: typeof a.color === 'string' ? a.color : defaultColor,
      })
    }
  }
  return out
}

/** Public / index response: never include PNG bytes. */
export function annotationsForPublic(annotations: unknown[]): unknown[] {
  return annotations.map(item => {
    if (!item || typeof item !== 'object') return item
    const a = item as Record<string, unknown>
    if (a.type === 'signature') {
      const { imageDataUrl: _img, ...rest } = a
      return {
        ...rest,
        imageDataUrl: '',
        hasPath: Boolean(a.path && typeof a.path === 'object'),
      }
    }
    return a
  })
}

export function expandSlim(slim: unknown[]): unknown[] {
  return slim.map((item, i) => {
    const a = item as Record<string, unknown>
    const id = `stream_${i}`
    const geo = {
      id,
      pageIndex: a.page,
      x: a.x,
      y: a.y,
      width: a.w,
      height: a.h,
    }
    if (a.t === 's') {
      return {
        ...geo,
        type: 'signature',
        imageDataUrl: '',
        ...(a.path ? { path: a.path } : {}),
      }
    }
    if (a.t === 'x') {
      return {
        ...geo,
        type: 'text',
        text: a.text,
        fontSizeRatio: a.font ?? 0.025,
        color: a.color ?? '#0f172a',
      }
    }
    return {
      ...geo,
      type: a.t === 'c' ? 'checkmark' : 'cross',
      color: a.color ?? (a.t === 'c' ? '#0f766e' : '#b91c1c'),
    }
  })
}

export function packAnnotationStream(pdfSha256: string, annotations: unknown[]): Buffer[] {
  const hash = hexToBytes(pdfSha256)
  const slim = slimAnnotations(annotations)
  const json = Buffer.from(JSON.stringify(slim), 'utf8')
  const checksum = crc32(json)

  const dataChunks: Buffer[] = []
  if (json.length === 0) {
    dataChunks.push(Buffer.alloc(0))
  } else {
    for (let off = 0; off < json.length; off += FRAME_BODY) {
      dataChunks.push(json.subarray(off, Math.min(json.length, off + FRAME_BODY)))
    }
  }

  const total = 2 + dataChunks.length
  if (total > MAX_STREAM_FRAMES) {
    throw new Error(
      `Annotation stream too large (${total} frames; max ${MAX_STREAM_FRAMES})`,
    )
  }

  const frames: Buffer[] = []
  let seq = 0

  {
    const f = Buffer.alloc(FRAME_SIZE)
    writeHeader(f, FRAME_HEAD, seq++, total, hash)
    hash.copy(f, FRAME_HEADER)
    f.writeUInt32BE(json.length, FRAME_HEADER + 32)
    f.writeUInt16BE(slim.length, FRAME_HEADER + 36)
    f.writeUInt32BE(checksum, FRAME_HEADER + 38)
    frames.push(f)
  }

  for (const chunk of dataChunks) {
    const f = Buffer.alloc(FRAME_SIZE)
    writeHeader(f, FRAME_DATA, seq++, total, hash)
    chunk.copy(f, FRAME_HEADER)
    frames.push(f)
  }

  {
    const f = Buffer.alloc(FRAME_SIZE)
    writeHeader(f, FRAME_END, seq++, total, hash)
    f.writeUInt32BE(json.length, FRAME_HEADER)
    f.writeUInt32BE(checksum, FRAME_HEADER + 4)
    frames.push(f)
  }

  return frames
}

export function unpackAnnotationStream(framesIn: Buffer[]): {
  pdfSha256: string
  annotations: unknown[]
  payloadBytes: number
  frameCount: number
  checksum: number
  annCount: number
} {
  if (framesIn.length < 2) throw new Error('Not enough frames')
  const frames = [...framesIn].sort((a, b) => a[3]! - b[3]!)
  const head = frames[0]!
  if (head[0] !== STREAM_MAGIC) throw new Error('Bad stream magic')
  if (head[1] !== STREAM_VERSION) throw new Error('Unsupported stream version')
  if (head[2] !== FRAME_HEAD) throw new Error('First frame must be HEAD')

  const total = head[4]!
  if (frames.length !== total) throw new Error(`Expected ${total} frames, got ${frames.length}`)

  // Contiguous unique seq 0..total-1
  const seen = new Set<number>()
  for (let i = 0; i < frames.length; i++) {
    const seq = frames[i]![3]!
    if (seq !== i) throw new Error(`Frame sequence gap: expected ${i}, got ${seq}`)
    if (seen.has(seq)) throw new Error(`Duplicate frame seq ${seq}`)
    seen.add(seq)
  }

  const { header: hdr, assocLen } = detectFrameLayout(head)
  const hash = head.subarray(hdr, hdr + 32)
  const assoc = hash.subarray(0, assocLen)
  const payloadLen = head.readUInt32BE(hdr + 32)
  const annCount = head.readUInt16BE(hdr + 36)
  const checksum = head.readUInt32BE(hdr + 38)
  const pdfSha256 = hash.toString('hex')

  const parts: Buffer[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== STREAM_MAGIC) throw new Error(`Bad magic on frame ${i}`)
    if (f[1] !== STREAM_VERSION) throw new Error(`Bad version on frame ${i}`)
    if (!f.subarray(5, 5 + assocLen).equals(assoc)) {
      throw new Error(`Association id mismatch on frame ${i}`)
    }
    const { header: fh } = detectFrameLayout(f, pdfSha256)
    if (f[2] === FRAME_DATA) parts.push(f.subarray(fh))
    else if (f[2] === FRAME_END) {
      const endLen = f.readUInt32BE(fh)
      const endCrc = f.readUInt32BE(fh + 4)
      if (endLen !== payloadLen || endCrc !== checksum) {
        throw new Error('END frame checksum mismatch')
      }
    } else {
      throw new Error(`Unexpected frame type ${f[2]} at seq ${i}`)
    }
  }

  const joined = Buffer.concat(parts).subarray(0, payloadLen)
  if (crc32(joined) !== checksum) throw new Error('Payload CRC mismatch')
  const slim = JSON.parse(joined.toString('utf8')) as unknown[]
  if (!Array.isArray(slim)) throw new Error('Invalid stream JSON')
  if (slim.length !== annCount) {
    throw new Error(`Annotation count mismatch: HEAD ${annCount} vs payload ${slim.length}`)
  }
  return {
    pdfSha256,
    annotations: expandSlim(slim),
    payloadBytes: payloadLen,
    frameCount: total,
    checksum,
    annCount,
  }
}

function assertSignaturesHavePathForBroadcast(annotations: unknown[]): void {
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i] as Record<string, unknown>
    if (a?.type !== 'signature') continue
    const path = a.path as { strokes?: unknown[] } | undefined
    if (!path || !Array.isArray(path.strokes) || path.strokes.length === 0) {
      throw new Error(
        `Signature annotation ${i} has no vector path - draw with the stroke pad before on-chain publish`,
      )
    }
  }
}

export function prepareStreamFromAnnotations(
  originalSha256: string,
  annotationsInput: unknown,
  creatorAddress: string,
): {
  record: AnnotationStreamRecord
  frames: Buffer[]
  framesHex: string[]
} {
  const annotations = sanitizeAnnotations(annotationsInput)
  if (!annotations || annotations.length === 0) {
    throw new Error('At least one annotation is required')
  }
  const hash = originalSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Valid originalSha256 required')

  const frames = packAnnotationStream(hash, annotations)
  const framesHex = frames.map(f => f.toString('hex'))
  const payloadBytes = Buffer.from(JSON.stringify(slimAnnotations(annotations)), 'utf8').length
  const now = Date.now()
  const record: AnnotationStreamRecord = {
    originalSha256: hash,
    creatorAddress: normalizeAddress(creatorAddress),
    framesHex,
    txHashes: [],
    annotationCount: annotations.length,
    payloadBytes,
    onChain: false,
    confirmedFrames: 0,
    annotationsJson: JSON.stringify(annotationsForPublic(annotations)),
    createdAt: now,
    updatedAt: now,
  }
  return { record, frames, framesHex }
}

export interface PublishStreamResult {
  originalSha256: string
  frameCount: number
  payloadBytes: number
  framesHex: string[]
  txHashes: string[]
  onChain: boolean
  confirmedFrames: number
  annotations: unknown[]
  creatorAddress: string
  broadcastError?: string
  partialBroadcast?: boolean
}

export async function publishAnnotationStream(input: {
  originalSha256: string
  annotations: unknown
  creatorAddress: string
  /** When true and service wallet configured, broadcast each frame. */
  broadcast?: boolean
}): Promise<PublishStreamResult> {
  const publisher = normalizeAddress(input.creatorAddress)
  const existing = getAnnotationStream(input.originalSha256.toLowerCase())
  // Empty creatorAddress = legacy row; claim on first rewrite.
  if (
    existing &&
    existing.creatorAddress &&
    normalizeAddress(existing.creatorAddress) !== publisher
  ) {
    throw new Error('Only the stream owner can replace this annotation stream')
  }

  const { record, frames, framesHex } = prepareStreamFromAnnotations(
    input.originalSha256,
    input.annotations,
    publisher,
  )
  // Preserve createdAt on update
  if (existing) {
    record.createdAt = existing.createdAt
  }

  const annotations = JSON.parse(record.annotationsJson) as unknown[]

  let txHashes: string[] = []
  let onChain = false
  let confirmedFrames = 0
  let broadcastError: string | undefined
  let partialBroadcast = false

  if (input.broadcast) {
    console.log('[annotation-stream] publish on-chain requested', {
      hash: input.originalSha256.slice(0, 12),
      frames: frames.length,
      publisher: publisher.slice(0, 12),
      broadcastEnabled: isAnnotationStreamBroadcastEnabled(),
      serviceWallet: isServiceWalletConfigured(),
    })
    if (!isAnnotationStreamBroadcastEnabled()) {
      broadcastError =
        'On-chain annotation broadcast is disabled (set ANNOTATION_STREAM_BROADCAST=true)'
    } else if (!isServiceWalletConfigured()) {
      broadcastError =
        'Service wallet not configured - stream stored locally; set SERVICE_WALLET_PRIVATE_KEY to publish on-chain'
    } else {
      try {
        assertSignaturesHavePathForBroadcast(
          sanitizeAnnotations(input.annotations) ?? [],
        )
        const result = await broadcastStreamFrames(frames)
        txHashes = result.hashes
        confirmedFrames = result.confirmed
        partialBroadcast = result.partial
        // Broadcast success is primary; confirmed count is best-effort visibility.
        onChain =
          result.hashes.length === frames.length && !result.partial && result.confirmed > 0
        if (result.hashes.length === frames.length && result.confirmed < frames.length) {
          partialBroadcast = true
          broadcastError =
            result.error ??
            `Broadcast all ${frames.length} frames; ${result.confirmed} visible so far (mempool/RPC lag). Reconstruct may use index until confirmed.`
          // Still treat as on-chain attempt success if all hashes recorded
          onChain = result.confirmed >= Math.min(2, frames.length)
        }
        if (result.error && result.hashes.length === 0) {
          broadcastError = result.error
          onChain = false
        } else if (result.error && !broadcastError) {
          broadcastError = result.error
        }
        console.log('[annotation-stream] broadcast finished', {
          hashes: txHashes.length,
          confirmed: confirmedFrames,
          onChain,
          error: broadcastError,
        })
      } catch (err) {
        broadcastError = err instanceof Error ? err.message : String(err)
        console.error('[annotation-stream] broadcast threw', broadcastError)
      }
    }
  }

  const saved: AnnotationStreamRecord = {
    ...record,
    txHashes,
    onChain,
    confirmedFrames,
    updatedAt: Date.now(),
  }
  upsertAnnotationStream(saved)

  return {
    originalSha256: saved.originalSha256,
    frameCount: framesHex.length,
    payloadBytes: saved.payloadBytes,
    framesHex,
    txHashes,
    onChain,
    confirmedFrames,
    annotations,
    creatorAddress: saved.creatorAddress,
    ...(broadcastError ? { broadcastError } : {}),
    ...(partialBroadcast ? { partialBroadcast: true } : {}),
  }
}

export function getStreamByHash(originalSha256: string): AnnotationStreamRecord | null {
  return getAnnotationStream(originalSha256.toLowerCase())
}

/**
 * Reconstruct overlays for a PDF hash.
 *
 * Strategy (avoids Nimiq RPC 429 on 20+ frame streams):
 * 1. Unpack stored wire frames (same bytes we broadcast) - CRC-checked.
 * 2. Optionally sample 1–2 on-chain txs (HEAD + END) when not rate-limited.
 * 3. Full chain re-read only when framesHex missing or caller forces it.
 */
export async function reconstructFromStoredOrChain(
  originalSha256: string,
  options?: { fallbackIndex?: boolean; preferFullChain?: boolean },
): Promise<{
  originalSha256: string
  annotations: unknown[]
  source: 'index' | 'chain' | 'wire'
  frameCount: number
  txHashes: string[]
  onChain: boolean
  confirmedFrames: number
  chainError?: string
  chainSampleOk?: boolean
  integrityOk?: boolean
}> {
  const hash = originalSha256.toLowerCase()
  const stored = getAnnotationStream(hash)
  if (!stored) throw new Error('No annotation stream for this PDF hash')

  const fallbackIndex = options?.fallbackIndex !== false
  const forceNoFallback = options?.fallbackIndex === false
  const preferFullChain = options?.preferFullChain === true

  // ── Primary: unpack the exact frames we packed/broadcast (no RPC flood) ──
  if (stored.framesHex.length > 0 && !preferFullChain) {
    try {
      const frames = stored.framesHex.map(hex => {
        const buf = Buffer.from(hex, 'hex')
        if (buf.length !== FRAME_SIZE) {
          throw new Error(`Stored frame wrong size (${buf.length})`)
        }
        return buf
      })
      const unpacked = unpackAnnotationStream(frames)
      if (unpacked.pdfSha256 !== hash) {
        throw new Error('Stored stream hash does not match PDF fingerprint')
      }

      // Optional light chain sample (HEAD + END only) - ignore 429
      let chainSampleOk: boolean | undefined
      let chainError: string | undefined
      if (stored.txHashes.length >= 2) {
        try {
          const samples = [stored.txHashes[0]!, stored.txHashes[stored.txHashes.length - 1]!]
          let ok = 0
          for (const txHash of samples) {
            await new Promise(r => setTimeout(r, 150))
            const tx = await fetchTransaction(txHash)
            if (tx && tx.executionResult !== false) {
              const bytes = decodeRecipientDataBytes(tx.recipientData)
              if (bytes.length === FRAME_SIZE) ok++
            }
          }
          chainSampleOk = ok === samples.length
          if (!chainSampleOk) {
            chainError = `Sampled ${ok}/${samples.length} on-chain frames (HEAD/END)`
          }
        } catch (err) {
          chainError = err instanceof Error ? err.message : String(err)
          chainSampleOk = false
          // 429 / rate limit: still return wire reconstruct - not a hard failure
          console.warn('[annotation-stream] chain sample skipped', chainError)
        }
      }

      return {
        originalSha256: hash,
        annotations: unpacked.annotations,
        source: 'wire',
        frameCount: unpacked.frameCount,
        txHashes: stored.txHashes,
        onChain: stored.onChain || stored.txHashes.length > 0,
        confirmedFrames: stored.confirmedFrames,
        ...(chainError ? { chainError } : {}),
        ...(chainSampleOk != null ? { chainSampleOk } : {}),
        integrityOk: true,
      }
    } catch (err) {
      console.warn('[annotation-stream] wire reconstruct failed', err)
      // fall through to full chain or index
    }
  }

  // ── Full chain re-read (throttled) - only when forced or no framesHex ──
  if (stored.txHashes.length > 0 && (preferFullChain || stored.framesHex.length === 0)) {
    try {
      if (
        stored.framesHex.length > 0 &&
        stored.txHashes.length !== stored.framesHex.length
      ) {
        throw new Error(
          `Incomplete tx set: ${stored.txHashes.length}/${stored.framesHex.length} frames broadcast`,
        )
      }
      const frames: Buffer[] = []
      for (let i = 0; i < stored.txHashes.length; i++) {
        const txHash = stored.txHashes[i]!
        if (i > 0) await new Promise(r => setTimeout(r, 200))
        const tx = await fetchTransaction(txHash)
        if (!tx) throw new Error(`Tx not found: ${txHash.slice(0, 12)}…`)
        if (tx.executionResult === false) {
          throw new Error(`Tx ${txHash.slice(0, 12)}… failed execution`)
        }
        const bytes = decodeRecipientDataBytes(tx.recipientData)
        if (bytes.length !== FRAME_SIZE) {
          throw new Error(
            `Truncated/invalid frame payload (${bytes.length} B, need ${FRAME_SIZE}) for ${txHash.slice(0, 12)}…`,
          )
        }
        frames.push(Buffer.from(bytes))
      }
      const unpacked = unpackAnnotationStream(frames)
      if (unpacked.pdfSha256 !== hash) {
        throw new Error('On-chain stream hash does not match PDF fingerprint')
      }
      return {
        originalSha256: hash,
        annotations: unpacked.annotations,
        source: 'chain',
        frameCount: unpacked.frameCount,
        txHashes: stored.txHashes,
        onChain: true,
        confirmedFrames: stored.txHashes.length,
        integrityOk: true,
        chainSampleOk: true,
      }
    } catch (err) {
      const chainError = err instanceof Error ? err.message : String(err)
      console.warn('[annotation-stream] full chain reconstruct failed', chainError)
      if (forceNoFallback || !fallbackIndex) {
        throw new Error(`Chain reconstruct failed: ${chainError}`)
      }
      const annotations = JSON.parse(stored.annotationsJson) as unknown[]
      return {
        originalSha256: hash,
        annotations: annotationsForPublic(annotations),
        source: 'index',
        frameCount: stored.framesHex.length || annotations.length,
        txHashes: stored.txHashes,
        onChain: stored.onChain,
        confirmedFrames: stored.confirmedFrames,
        chainError,
        integrityOk: false,
      }
    }
  }

  const annotations = JSON.parse(stored.annotationsJson) as unknown[]
  return {
    originalSha256: hash,
    annotations: annotationsForPublic(annotations),
    source: 'index',
    frameCount: stored.framesHex.length,
    txHashes: stored.txHashes,
    onChain: stored.onChain,
    confirmedFrames: stored.confirmedFrames,
    integrityOk: true,
  }
}

export interface BroadcastStreamResult {
  hashes: string[]
  confirmed: number
  partial: boolean
  error?: string
}

export interface BroadcastStreamOptions {
  /**
   * Called after each successful frame broadcast (for incremental DB persist).
   * index is 0-based within this `frames` batch.
   */
  onFrame?: (info: { index: number; hash: string; hashes: string[] }) => void
  /**
   * Skip the multi-second post-broadcast visibility polling loop.
   * Use for large multi-tx archives so the HTTP path does not sit on RPC lag
   * (hashes are still recorded; confirmation can catch up later).
   */
  skipVisibilityWait?: boolean
  /** Delay between frames in ms (default 120). */
  interFrameDelayMs?: number
}

/**
 * Serialize multi-tx stream broadcasts so frames for one archive stay contiguous
 * on the service wallet. That lets hash-only chain scanners assemble streams by
 * walking chronological 0xA1 frames after each matching HEAD (no recovery file).
 */
let streamBroadcastQueue: Promise<unknown> = Promise.resolve()

/**
 * Broadcast pre-packed 64-byte frames via the service wallet (one basic tx each).
 * Shared by annotation-stream experiment and paid document data-archive upsell.
 */
export async function broadcastStreamFrames(
  frames: Buffer[],
  options?: BroadcastStreamOptions,
): Promise<BroadcastStreamResult> {
  const run = () => broadcastStreamFramesUnlocked(frames, options)
  const result = streamBroadcastQueue.then(run, run)
  // Keep queue alive even if this job fails
  streamBroadcastQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

async function broadcastStreamFramesUnlocked(
  frames: Buffer[],
  options?: BroadcastStreamOptions,
): Promise<BroadcastStreamResult> {
  if (!frames.length) {
    return {
      hashes: [],
      confirmed: 0,
      partial: false,
      error: 'No frames to broadcast (empty stream)',
    }
  }

  const { getServiceKeyPairForBroadcast, getServiceWalletAddress } = await import(
    './serviceWallet.js'
  )
  const keyPair = getServiceKeyPairForBroadcast()
  const senderAddress = getServiceWalletAddress()
  if (!senderAddress) throw new Error('Service wallet address unavailable')

  const sink = getExpectedAttestationRecipient()
  if (!sink) throw new Error('ATTESTATION_RECIPIENT not configured')
  if (normalizeAddress(sink) === normalizeAddress(senderAddress)) {
    throw new Error('Service wallet must not equal attestation sink')
  }

  const minBalance =
    frames.length * STREAM_FRAME_VALUE_LUNA + STREAM_FEE_BUFFER_LUNA
  try {
    const balance = await getWalletBalanceLuna(senderAddress)
    console.log('[annotation-stream] service wallet balance check', {
      sender: senderAddress.slice(0, 12),
      balance,
      minBalance,
      frames: frames.length,
    })
    if (balance < minBalance) {
      return {
        hashes: [],
        confirmed: 0,
        partial: false,
        error: `Service wallet balance too low (${balance} luna; need ≥ ${minBalance} for ${frames.length} frames). Fund ${senderAddress}.`,
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Service wallet balance')) {
      return { hashes: [], confirmed: 0, partial: false, error: err.message }
    }
    // Fail open on balance read errors (same as credit seals) so a cold light client
    // does not block the proven /pdf multi-tx path.
    console.warn('[annotation-stream] could not read service wallet balance', err)
  }

  const client = await getBroadcastClientForService()
  const networkId = await client.getNetworkId()
  const sender = Address.fromString(senderAddress)
  const recipient = Address.fromString(sink)

  const hashes: string[] = []
  let validityStartHeight = Math.max(0, (await client.getHeadHeight()) - 1)

  for (let i = 0; i < frames.length; i++) {
    if (i > 0 && i % HEAD_REFRESH_EVERY === 0) {
      validityStartHeight = Math.max(0, (await client.getHeadHeight()) - 1)
    }

    const payload = frames[i]!
    if (payload.length !== FRAME_SIZE) {
      return {
        hashes,
        confirmed: 0,
        partial: hashes.length > 0,
        error: `Frame ${i} is ${payload.length} bytes (need ${FRAME_SIZE})`,
      }
    }

    const tx = TransactionBuilder.newBasicWithData(
      sender,
      recipient,
      payload,
      BigInt(STREAM_FRAME_VALUE_LUNA),
      BigInt(0),
      validityStartHeight,
      networkId,
    )
    tx.sign(keyPair, undefined)
    const hex = tx.toHex()
    const expectedHash = tx.hash().replace(/^0x/i, '').toLowerCase()

    let pushedHash: string | null = null
    try {
      const result = await broadcastRawTransactionDetailed(hex)
      const h = (result.hash || expectedHash).toLowerCase()
      hashes.push(h)
      pushedHash = h
    } catch (err) {
      try {
        const details = await client.sendTransaction(tx)
        if (details.state === 'invalidated' || details.state === 'expired') {
          return {
            hashes,
            confirmed: 0,
            partial: hashes.length > 0,
            error: `Frame ${i} rejected (state: ${details.state})`,
          }
        }
        const h = details.transactionHash.replace(/^0x/i, '').toLowerCase()
        hashes.push(h)
        pushedHash = h
      } catch (inner) {
        const msg = err instanceof Error ? err.message : String(inner)
        return {
          hashes,
          confirmed: 0,
          partial: hashes.length > 0,
          error: `Frame ${i} broadcast failed: ${msg}`,
        }
      }
    }

    if (pushedHash) {
      try {
        options?.onFrame?.({ index: i, hash: pushedHash, hashes: [...hashes] })
      } catch (hookErr) {
        console.warn('[annotation-stream] onFrame hook failed', hookErr)
      }
    }

    const delay = options?.interFrameDelayMs ?? 120
    if (i + 1 < frames.length && delay > 0) {
      await new Promise(r => setTimeout(r, delay))
    }
  }

  // Fast visibility check: wait briefly on first + last, then one pass over all.
  // Skip for large multi-tx archives so callers are not held for tens of seconds.
  let confirmed = 0
  if (hashes.length > 0 && !options?.skipVisibilityWait) {
    const sample = [hashes[0]!, hashes[hashes.length - 1]!]
    for (const h of sample) {
      try {
        const seen = await waitForTransactionVisible(h, VISIBILITY_TIMEOUT_MS, VISIBILITY_POLL_MS)
        if (seen && seen.executionResult !== false) {
          /* sample ok */
        }
      } catch {
        /* continue */
      }
    }

    const deadline = Date.now() + POST_BROADCAST_CONFIRM_MS
    const confirmedSet = new Set<string>()
    while (Date.now() < deadline && confirmedSet.size < hashes.length) {
      for (const h of hashes) {
        if (confirmedSet.has(h)) continue
        try {
          const tx = await fetchTransaction(h)
          if (tx && tx.executionResult !== false) confirmedSet.add(h)
        } catch {
          /* ignore */
        }
      }
      if (confirmedSet.size >= hashes.length) break
      await new Promise(r => setTimeout(r, VISIBILITY_POLL_MS))
    }
    confirmed = confirmedSet.size
  } else if (hashes.length > 0 && options?.skipVisibilityWait) {
    // Treat submitted hashes as "known" for progress; RPC lag is fine.
    confirmed = hashes.length
  }

  const partial = hashes.length < frames.length
  const allBroadcast = hashes.length === frames.length
  console.log('[annotation-stream] visibility', {
    broadcast: hashes.length,
    confirmed,
    frames: frames.length,
  })
  return {
    hashes,
    confirmed,
    partial,
    ...(!allBroadcast
      ? {
          error: `Partial broadcast: ${hashes.length}/${frames.length} frames sent`,
        }
      : confirmed < hashes.length
        ? {
            error: `All ${hashes.length} frames broadcast; ${confirmed} visible so far (RPC lag is OK - hashes saved)`,
          }
        : {}),
  }
}

export function streamContentHash(framesHex: string[]): string {
  return createHash('sha256').update(framesHex.join('')).digest('hex')
}
