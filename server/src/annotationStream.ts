/**
 * Pack/unpack annotation streams into 64-byte Nimiq basic-tx frames.
 * Keep framing compatible with client/src/pdf/annotationStream.ts.
 *
 * Magic 0xA1 — distinct from seal attestation 0x01 (37-byte).
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
export const FRAME_HEADER = 9
export const FRAME_BODY = FRAME_SIZE - FRAME_HEADER
export const FRAME_HEAD = 1
export const FRAME_DATA = 2
export const FRAME_END = 3

/**
 * Experiment cap (frames = HEAD + DATA* + END).
 * ~55 B payload per DATA frame; free fees make 128 practical for multi-sig paths.
 * Abuse still limited by rate limit + service-wallet balance.
 */
export const MAX_STREAM_FRAMES = 128
/** Match credit seal dust value so sinks/network treat frames like paid proofs. */
export const STREAM_FRAME_VALUE_LUNA = 1
const STREAM_FEE_BUFFER_LUNA = 10
/** Per-frame visibility wait after broadcast (keep short — many frames). */
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

function writeHeader(
  frame: Buffer,
  type: number,
  seq: number,
  total: number,
  hashPrefix: Buffer,
): void {
  frame[0] = STREAM_MAGIC
  frame[1] = STREAM_VERSION
  frame[2] = type
  frame[3] = seq & 0xff
  frame[4] = total & 0xff
  hashPrefix.copy(frame, 5, 0, 4)
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
      `Annotation stream too large (${total} frames; max ${MAX_STREAM_FRAMES} for experiment)`,
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

  const hash = head.subarray(FRAME_HEADER, FRAME_HEADER + 32)
  const hashPrefix = hash.subarray(0, 4)
  const payloadLen = head.readUInt32BE(FRAME_HEADER + 32)
  const annCount = head.readUInt16BE(FRAME_HEADER + 36)
  const checksum = head.readUInt32BE(FRAME_HEADER + 38)
  const pdfSha256 = hash.toString('hex')

  const parts: Buffer[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== STREAM_MAGIC) throw new Error(`Bad magic on frame ${i}`)
    if (f[1] !== STREAM_VERSION) throw new Error(`Bad version on frame ${i}`)
    if (!f.subarray(5, 9).equals(hashPrefix)) {
      throw new Error(`Hash prefix mismatch on frame ${i}`)
    }
    if (f[2] === FRAME_DATA) parts.push(f.subarray(FRAME_HEADER))
    else if (f[2] === FRAME_END) {
      const endLen = f.readUInt32BE(FRAME_HEADER)
      const endCrc = f.readUInt32BE(FRAME_HEADER + 4)
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
        `Signature annotation ${i} has no vector path — draw with the stroke pad before on-chain publish`,
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
        'Service wallet not configured — stream stored locally; set SERVICE_WALLET_PRIVATE_KEY to publish on-chain'
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
 * 1. Unpack stored wire frames (same bytes we broadcast) — CRC-checked.
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

      // Optional light chain sample (HEAD + END only) — ignore 429
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
          // 429 / rate limit: still return wire reconstruct — not a hard failure
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

  // ── Full chain re-read (throttled) — only when forced or no framesHex ──
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

interface BroadcastResult {
  hashes: string[]
  confirmed: number
  partial: boolean
  error?: string
}

async function broadcastStreamFrames(frames: Buffer[]): Promise<BroadcastResult> {
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

    try {
      const result = await broadcastRawTransactionDetailed(hex)
      const h = (result.hash || expectedHash).toLowerCase()
      hashes.push(h)
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
        hashes.push(details.transactionHash.replace(/^0x/i, '').toLowerCase())
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

    if (i + 1 < frames.length) {
      await new Promise(r => setTimeout(r, 120))
    }
  }

  // Fast visibility check: wait briefly on first + last, then one pass over all.
  let confirmed = 0
  if (hashes.length > 0) {
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
            error: `All ${hashes.length} frames broadcast; ${confirmed} visible so far (RPC lag is OK — hashes saved)`,
          }
        : {}),
  }
}

export function streamContentHash(framesHex: string[]): string {
  return createHash('sha256').update(framesHex.join('')).digest('hex')
}
