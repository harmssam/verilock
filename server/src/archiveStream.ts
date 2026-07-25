/**
 * Archive stream packing (0xA1) for paid on-chain data backup.
 *
 * Stream versions (byte 1):
 *   1 = free-form annotation stream (see annotationStream.ts)
 *   2 = placement construction batches (client packer)
 *   3 = archive manifest (people + wallets + signature roster)
 *
 * Frame layout matches v1/v2: 64-byte basic-tx payloads, HEAD/DATA/END.
 */
import { createHash } from 'node:crypto'
import {
  FRAME_BODY,
  FRAME_DATA,
  FRAME_END,
  FRAME_HEAD,
  FRAME_HEADER,
  FRAME_SIZE,
  MAX_STREAM_FRAMES,
  STREAM_MAGIC,
} from './annotationStream.js'
import { normalizeAddress } from './addresses.js'
import {
  getDocumentById,
  getPartiesForDocument,
  getSignaturesForDocument,
  resolvePlacementPlan,
  type DocumentDataArchiveSource,
} from './db.js'

/** Manifest stream version - distinct from annotation (1) and placement (2). */
export const STREAM_VERSION_MANIFEST = 3
export const STREAM_VERSION_ANNOTATION = 1
export const STREAM_VERSION_PLACEMENT = 2

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

function hexToBytes32(hex: string): Buffer {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(clean)) throw new Error('pdf hash must be 64 hex chars')
  return Buffer.from(clean, 'hex')
}

function writeHeader(
  frame: Buffer,
  version: number,
  type: number,
  seq: number,
  total: number,
  hashPrefix: Buffer,
): void {
  frame[0] = STREAM_MAGIC
  frame[1] = version & 0xff
  frame[2] = type
  frame[3] = seq & 0xff
  frame[4] = total & 0xff
  hashPrefix.copy(frame, 5, 0, 4)
}

/**
 * Pack an arbitrary JSON payload into 0xA1 HEAD+DATA*+END frames at a given version.
 * Same layout as annotation/placement streams so scanners share one decoder.
 */
export function packJsonStreamFrames(
  pdfSha256: string,
  version: number,
  payload: unknown,
): Buffer[] {
  const hash = hexToBytes32(pdfSha256)
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
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
      `Archive stream too large (${total} frames; max ${MAX_STREAM_FRAMES})`,
    )
  }

  const frames: Buffer[] = []
  let seq = 0

  {
    const f = Buffer.alloc(FRAME_SIZE)
    writeHeader(f, version, FRAME_HEAD, seq++, total, hash)
    hash.copy(f, FRAME_HEADER)
    f.writeUInt32BE(json.length, FRAME_HEADER + 32)
    f.writeUInt16BE(0, FRAME_HEADER + 36)
    f.writeUInt32BE(checksum, FRAME_HEADER + 38)
    frames.push(f)
  }

  for (const chunk of dataChunks) {
    const f = Buffer.alloc(FRAME_SIZE)
    writeHeader(f, version, FRAME_DATA, seq++, total, hash)
    chunk.copy(f, FRAME_HEADER)
    frames.push(f)
  }

  {
    const f = Buffer.alloc(FRAME_SIZE)
    writeHeader(f, version, FRAME_END, seq++, total, hash)
    f.writeUInt32BE(json.length, FRAME_HEADER)
    f.writeUInt32BE(checksum, FRAME_HEADER + 4)
    frames.push(f)
  }

  return frames
}

export interface ArchiveManifest {
  v: 3
  kind: 'archive_manifest'
  /** Original document fingerprint (SHA-256 hex). */
  pdf: string
  /** Placement plan root when present. */
  pl?: string
  /** Agreement id (for seal short-id correlation). */
  doc?: string
  title?: string
  people: Array<{ i: number; n: string; r?: string; w?: string }>
  /** Signed parties: person slot, wallet, name, signed-at ms, signature type. */
  sigs: Array<{ i: number; w: string; n?: string; at: number; t?: string; sha?: string }>
}

/** Build a reconstruct-friendly manifest from server agreement state. */
export function buildArchiveManifest(documentId: string): ArchiveManifest | null {
  const doc = getDocumentById(documentId)
  if (!doc) return null

  const hash = doc.originalSha256.toLowerCase()
  const parties = getPartiesForDocument(documentId)
    .filter(p => p.required)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const signatures = getSignaturesForDocument(documentId)
  const sigByParty = new Map(signatures.map(s => [s.partyId, s]))

  const plan = resolvePlacementPlan({
    originalSha256: hash,
    documentId,
  })
  let planPeople: ArchiveManifest['people'] = []
  let planRoot: string | undefined
  if (plan?.planJson) {
    try {
      const parsed = JSON.parse(plan.planJson) as {
        people?: Array<{
          slotIndex?: number
          displayName?: string
          role?: string
          walletAddress?: string | null
        }>
        planRoot?: string
      }
      planRoot = (plan.planRoot || parsed.planRoot || undefined)?.toLowerCase()
      if (Array.isArray(parsed.people)) {
        planPeople = parsed.people
          .map(p => {
            const i = Number(p.slotIndex)
            if (!Number.isInteger(i) || i < 1) return null
            const row: ArchiveManifest['people'][number] = {
              i,
              n: String(p.displayName ?? `Person ${i}`).trim().slice(0, 80),
            }
            if (p.role) row.r = String(p.role).slice(0, 40)
            const w = p.walletAddress?.replace(/\s+/g, '').toUpperCase()
            if (w) row.w = w
            return row
          })
          .filter((x): x is ArchiveManifest['people'][number] => x != null)
          .sort((a, b) => a.i - b.i)
      }
    } catch {
      /* ignore bad plan JSON */
    }
  }

  // Prefer plan people; fill wallet gaps from parties / signatures.
  const people: ArchiveManifest['people'] =
    planPeople.length > 0
      ? planPeople.map(p => {
          const party = parties[p.i - 1]
          if (p.w || !party) return p
          const w =
            party.walletAddress?.replace(/\s+/g, '').toUpperCase() ||
            sigByParty.get(party.id)?.signerAddress.replace(/\s+/g, '').toUpperCase()
          return w ? { ...p, w } : p
        })
      : parties.map((party, idx) => {
          const i = idx + 1
          const row: ArchiveManifest['people'][number] = {
            i,
            n: String(party.displayName || `Person ${i}`).trim().slice(0, 80),
          }
          if (party.role) row.r = String(party.role).slice(0, 40)
          const w =
            party.walletAddress?.replace(/\s+/g, '').toUpperCase() ||
            sigByParty.get(party.id)?.signerAddress.replace(/\s+/g, '').toUpperCase()
          if (w) row.w = w
          return row
        })

  const sigs: ArchiveManifest['sigs'] = []
  for (let idx = 0; idx < parties.length; idx++) {
    const party = parties[idx]!
    const sig = sigByParty.get(party.id)
    if (!sig) continue
    const i = idx + 1
    sigs.push({
      i,
      w: normalizeAddress(sig.signerAddress),
      n: String(party.displayName || '').trim().slice(0, 80) || undefined,
      at: sig.signedAt,
      t: sig.signatureType || undefined,
      sha: sig.clientSha256?.toLowerCase() || undefined,
    })
  }

  return {
    v: 3,
    kind: 'archive_manifest',
    pdf: hash,
    ...(planRoot ? { pl: planRoot } : {}),
    doc: documentId,
    title: String(doc.title || '').trim().slice(0, 120) || undefined,
    people,
    sigs,
  }
}

export function packArchiveManifestFrames(documentId: string): Buffer[] {
  const manifest = buildArchiveManifest(documentId)
  if (!manifest) throw new Error('Document not found for archive manifest')
  return packJsonStreamFrames(manifest.pdf, STREAM_VERSION_MANIFEST, manifest)
}

/**
 * Split a flat list of 64-byte frames into contiguous streams.
 * Each stream starts at HEAD and has `total` frames (seq 0..total-1).
 */
export function splitFrameStreams(frames: Buffer[]): Buffer[][] {
  const streams: Buffer[][] = []
  let i = 0
  while (i < frames.length) {
    const head = frames[i]!
    if (head.length !== FRAME_SIZE || head[0] !== STREAM_MAGIC || head[2] !== FRAME_HEAD) {
      throw new Error(`Expected stream HEAD at frame index ${i}`)
    }
    const total = head[4]!
    if (total < 2 || i + total > frames.length) {
      throw new Error(`Invalid stream length ${total} at frame index ${i}`)
    }
    streams.push(frames.slice(i, i + total))
    i += total
  }
  return streams
}

export function framesHexToBuffers(framesHex: string[]): Buffer[] {
  return framesHex.map((hex, index) => {
    if (typeof hex !== 'string' || !/^[a-f0-9]{128}$/i.test(hex)) {
      throw new Error(`Invalid frame hex at index ${index}`)
    }
    const buf = Buffer.from(hex, 'hex')
    if (buf.length !== FRAME_SIZE) {
      throw new Error(`Frame ${index} is ${buf.length} bytes (need ${FRAME_SIZE})`)
    }
    return buf
  })
}

export function unpackJsonStreamPayload(framesIn: Buffer[]): {
  version: number
  pdfSha256: string
  payload: unknown
  payloadBytes: number
  frameCount: number
  checksum: number
} {
  if (framesIn.length < 2) throw new Error('Not enough frames')
  const frames = [...framesIn].sort((a, b) => a[3]! - b[3]!)
  const head = frames[0]!
  if (head[0] !== STREAM_MAGIC) throw new Error('Bad stream magic')
  if (head[2] !== FRAME_HEAD) throw new Error('First frame must be HEAD')
  const version = head[1]!
  const total = head[4]!
  if (frames.length !== total) {
    throw new Error(`Expected ${total} frames, got ${frames.length}`)
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]![3] !== i) throw new Error(`Frame sequence gap at ${i}`)
    if (frames[i]![1] !== version) throw new Error(`Version mismatch at frame ${i}`)
  }

  const hash = head.subarray(FRAME_HEADER, FRAME_HEADER + 32)
  const hashPrefix = hash.subarray(0, 4)
  const payloadLen = head.readUInt32BE(FRAME_HEADER + 32)
  const checksum = head.readUInt32BE(FRAME_HEADER + 38)
  const pdfSha256 = hash.toString('hex')

  const parts: Buffer[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== STREAM_MAGIC) throw new Error(`Bad magic on frame ${i}`)
    if (!f.subarray(5, 9).equals(hashPrefix)) {
      throw new Error(`Hash prefix mismatch on frame ${i}`)
    }
    if (f[2] === FRAME_DATA) parts.push(f.subarray(FRAME_HEADER))
    else if (f[2] === FRAME_END) {
      const endLen = f.readUInt32BE(FRAME_HEADER)
      const endCrc = f.readUInt32BE(FRAME_HEADER + 4)
      if (endLen !== payloadLen || endCrc !== checksum) {
        throw new Error('END frame length/checksum mismatch')
      }
    }
  }

  const joined = Buffer.concat(parts).subarray(0, payloadLen)
  if (crc32(joined) !== checksum) throw new Error('Payload CRC32 mismatch')
  const text = joined.toString('utf8')
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Payload is not valid JSON')
  }
  return {
    version,
    pdfSha256,
    payload,
    payloadBytes: payloadLen,
    frameCount: frames.length,
    checksum,
  }
}

export interface UnpackedArchive {
  originalSha256: string
  source: DocumentDataArchiveSource | 'mixed'
  streams: Array<{
    version: number
    frameCount: number
    pdfSha256: string
  }>
  /** Placement batch payloads (v2 wire objects). */
  placementBatches: unknown[]
  /** Free-form annotations when present (v1). */
  annotations: unknown[] | null
  /** Signature / people manifest when present (v3). */
  manifest: ArchiveManifest | null
}

/**
 * Unpack a flat multi-stream archive (placement batches + optional manifest).
 */
export function unpackArchiveFrames(framesHex: string[]): UnpackedArchive {
  const frames = framesHexToBuffers(framesHex)
  if (frames.length === 0) throw new Error('No frames to unpack')
  const streams = splitFrameStreams(frames)
  let originalSha256 = ''
  const placementBatches: unknown[] = []
  let annotations: unknown[] | null = null
  let manifest: ArchiveManifest | null = null
  let sawPlacement = false
  let sawAnnotations = false

  const streamMeta: UnpackedArchive['streams'] = []

  for (const stream of streams) {
    const version = stream[0]![1]!
    const unpacked = unpackJsonStreamPayload(stream)
    if (!originalSha256) originalSha256 = unpacked.pdfSha256
    else if (unpacked.pdfSha256 !== originalSha256) {
      throw new Error('Mixed PDF fingerprints in archive streams')
    }
    streamMeta.push({
      version,
      frameCount: stream.length,
      pdfSha256: unpacked.pdfSha256,
    })

    if (version === STREAM_VERSION_MANIFEST) {
      const m = unpacked.payload as ArchiveManifest
      if (m && m.kind === 'archive_manifest' && m.v === 3) {
        manifest = m
      }
      continue
    }
    if (version === STREAM_VERSION_PLACEMENT) {
      sawPlacement = true
      placementBatches.push(unpacked.payload)
      continue
    }
    if (version === STREAM_VERSION_ANNOTATION) {
      sawAnnotations = true
      // v1 packer stores a slim annotation array as the JSON root
      annotations = Array.isArray(unpacked.payload)
        ? unpacked.payload
        : ((unpacked.payload as { annotations?: unknown[] })?.annotations ?? null)
      continue
    }
    // Unknown version - keep metadata only
  }

  const source: UnpackedArchive['source'] =
    sawPlacement && sawAnnotations
      ? 'mixed'
      : sawPlacement
        ? 'placements'
        : sawAnnotations
          ? 'annotations'
          : 'mixed'

  return {
    originalSha256,
    source,
    streams: streamMeta,
    placementBatches,
    annotations,
    manifest,
  }
}

export function contentHashFrames(framesHex: string[]): string {
  return createHash('sha256').update(framesHex.join('')).digest('hex')
}
