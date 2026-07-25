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
  ASSOC_LEN,
  associationIdFromPdfHash,
  detectFrameLayout,
  FRAME_BODY,
  FRAME_DATA,
  FRAME_END,
  FRAME_HEAD,
  FRAME_HEADER,
  FRAME_SIZE,
  MAX_STREAM_FRAMES,
  STREAM_MAGIC,
  writeStreamFrameHeader,
} from './annotationStream.js'
import { normalizeAddress } from './addresses.js'
import {
  getDocumentById,
  getPartiesForDocument,
  getSignaturesForDocument,
  resolvePlacementPlan,
  type DocumentDataArchiveSource,
} from './db.js'
import {
  decodeRecipientDataBytes,
  fetchTransactionsByAddress,
  type NimiqTransaction,
} from './nimiq-rpc.js'

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
  pdfHash: Buffer,
): void {
  writeStreamFrameHeader(frame, version, type, seq, total, pdfHash)
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

  const { header: hdr, assocLen } = detectFrameLayout(head)
  const hash = head.subarray(hdr, hdr + 32)
  const assoc = hash.subarray(0, assocLen)
  const payloadLen = head.readUInt32BE(hdr + 32)
  const checksum = head.readUInt32BE(hdr + 38)
  const pdfSha256 = hash.toString('hex')

  const parts: Buffer[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== STREAM_MAGIC) throw new Error(`Bad magic on frame ${i}`)
    if (!f.subarray(5, 5 + assocLen).equals(assoc)) {
      throw new Error(`Association id mismatch on frame ${i}`)
    }
    const { header: fh } = detectFrameLayout(f, pdfSha256)
    if (f[2] === FRAME_DATA) parts.push(f.subarray(fh))
    else if (f[2] === FRAME_END) {
      const endLen = f.readUInt32BE(fh)
      const endCrc = f.readUInt32BE(fh + 4)
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

// ── Hash-only chain discovery (no recovery file / no server index) ─────────

export interface ScannedFrame {
  txHash: string
  hex: string
  buf: Buffer
  /** Chronological index (0 = oldest among scanned). */
  order: number
  from: string
  blockNumber?: number
}

export interface ScanArchiveResult {
  originalSha256: string
  found: boolean
  framesHex: string[]
  txHashes: string[]
  streamCount: number
  scannedTxs: number
  truncated: boolean
  scanAddresses: string[]
  error?: string
}

function frameFullPdfHash(head: Buffer): string | null {
  if (head.length !== FRAME_SIZE || head[0] !== STREAM_MAGIC || head[2] !== FRAME_HEAD) {
    return null
  }
  const { header } = detectFrameLayout(head)
  return head.subarray(header, header + 32).toString('hex')
}

/**
 * True when frame carries the association id for this PDF hash.
 * Prefer 8-byte (modern) match; legacy 4-byte only when allowLegacy is true
 * (and ideally only after HEAD self-detect proves old layout).
 */
export function frameMatchesPdfAssociation(
  frame: Buffer,
  pdfSha256: string,
  options?: { allowLegacy?: boolean },
): boolean {
  const want = associationIdFromPdfHash(pdfSha256)
  // New 8-byte assoc
  if (frame.subarray(5, 5 + ASSOC_LEN).equals(want)) return true
  // Legacy 4-byte prefix (weaker filter — optional for mixed-era history)
  if (options?.allowLegacy !== false) {
    if (frame.subarray(5, 9).equals(want.subarray(0, 4))) return true
  }
  return false
}

/**
 * Validate pre-packed multi-stream frames belong to `pdfSha256` before index/broadcast.
 * Rejects mismatched association ids, HEAD full-hash drift, and unpack failures.
 */
export function assertFramesBelongToPdfHash(pdfSha256: string, framesHex: string[]): void {
  const hash = pdfSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('pdf hash must be 64 hex chars')
  }
  if (framesHex.length === 0) throw new Error('No frames to validate')
  const buffers = framesHexToBuffers(framesHex)
  let streams: Buffer[][]
  try {
    streams = splitFrameStreams(buffers)
  } catch (err) {
    throw new Error(
      `Invalid multi-stream framing: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const wantAssoc = associationIdFromPdfHash(hash)
  for (let s = 0; s < streams.length; s++) {
    const stream = streams[s]!
    for (let i = 0; i < stream.length; i++) {
      const f = stream[i]!
      if (f[0] !== STREAM_MAGIC) {
        throw new Error(`Stream ${s} frame ${i}: bad magic`)
      }
      // Require modern 8-byte association id on newly accepted archives
      if (!f.subarray(5, 5 + ASSOC_LEN).equals(wantAssoc)) {
        throw new Error(
          `Stream ${s} frame ${i}: association id does not match originalSha256`,
        )
      }
    }
    const head = stream[0]!
    if (head[2] !== FRAME_HEAD) {
      throw new Error(`Stream ${s}: first frame must be HEAD`)
    }
    const full = frameFullPdfHash(head)
    if (full !== hash) {
      throw new Error(
        `Stream ${s}: HEAD full PDF hash does not match originalSha256`,
      )
    }
    try {
      unpackJsonStreamPayload(stream)
    } catch (err) {
      throw new Error(
        `Stream ${s}: unpack failed (${err instanceof Error ? err.message : String(err)})`,
      )
    }
  }
}

/**
 * From a pool of 0xA1 frames (chronological), assemble every complete stream
 * whose HEAD embeds `pdfSha256`. Association uses the 8-byte id (first 8 bytes
 * of the PDF hash) so hash-only recovery does not need a recovery file.
 */
export function assembleArchiveStreamsFromPool(
  pdfSha256: string,
  pool: ScannedFrame[],
  options?: {
    /** Prefer service-wallet sender only (reject sink-only injects). */
    requireSender?: string | null
    /** Prefer modern 8-byte assoc; legacy 4-byte only when HEAD proves old layout. */
    preferModernAssoc?: boolean
  },
): { frames: ScannedFrame[]; streamCount: number } {
  const hash = pdfSha256.toLowerCase()
  const requireSender = options?.requireSender
    ? options.requireSender.replace(/\s+/g, '').toUpperCase()
    : null
  const preferModern = options?.preferModernAssoc !== false

  let poolScoped = pool
  if (requireSender) {
    poolScoped = pool.filter(
      f => f.from.replace(/\s+/g, '').toUpperCase() === requireSender,
    )
  }

  // Prefer 8-byte association; fall back to legacy only for HEAD-proven old streams
  const modernRelated = poolScoped.filter(f =>
    frameMatchesPdfAssociation(f.buf, hash, { allowLegacy: false }),
  )
  const headsModern = modernRelated.filter(f => frameFullPdfHash(f.buf) === hash)

  // Legacy HEADs (4-byte prefix era): only if HEAD self-detects legacy layout
  const legacyHeads = preferModern
    ? poolScoped.filter(f => {
        if (f.buf[2] !== FRAME_HEAD) return false
        if (frameFullPdfHash(f.buf) !== hash) return false
        const { assocLen } = detectFrameLayout(f.buf, hash)
        return assocLen === 4
      })
    : []

  const heads = [...headsModern, ...legacyHeads]
  if (heads.length === 0) return { frames: [], streamCount: 0 }

  heads.sort((a, b) => a.order - b.order || a.txHash.localeCompare(b.txHash))

  const usedTx = new Set<string>()
  const assembled: ScannedFrame[] = []
  let streamCount = 0

  for (const head of heads) {
    if (usedTx.has(head.txHash)) continue
    const total = head.buf[4]!
    const version = head.buf[1]!
    if (total < 2 || total > 128) continue
    const { assocLen } = detectFrameLayout(head.buf, hash)
    const allowLegacyForStream = assocLen === 4

    // Candidate pool for this stream: same layout era
    const related = poolScoped.filter(f =>
      frameMatchesPdfAssociation(f.buf, hash, { allowLegacy: allowLegacyForStream }),
    )

    const chosen: ScannedFrame[] = new Array(total)
    chosen[0] = head
    let ok = true
    for (let seq = 1; seq < total; seq++) {
      const cands = related.filter(f => {
        if (usedTx.has(f.txHash) || f.txHash === head.txHash) return false
        if (f.buf[0] !== STREAM_MAGIC) return false
        if (f.buf[1] !== version) return false
        if (f.buf[2] === FRAME_HEAD) return false
        if (f.buf[3] !== seq) return false
        if (f.buf[4] !== total) return false
        // Same chronological neighborhood: must be after HEAD (serialized broadcast)
        if (f.order < head.order) return false
        return true
      })
      if (cands.length === 0) {
        ok = false
        break
      }
      cands.sort((a, b) => a.order - b.order || a.txHash.localeCompare(b.txHash))
      // Prefer nearest after HEAD to reduce cross-stream mix under same total
      chosen[seq] = cands[0]!
    }
    if (!ok) continue

    try {
      const unpacked = unpackJsonStreamPayload(chosen.map(c => c.buf))
      if (unpacked.pdfSha256 !== hash) continue
    } catch {
      continue
    }

    for (const c of chosen) usedTx.add(c.txHash)
    assembled.push(...chosen)
    streamCount += 1
  }

  return { frames: assembled, streamCount }
}

function txToFrame(tx: NimiqTransaction, order: number): ScannedFrame | null {
  if (tx.executionResult === false) return null
  try {
    const bytes = decodeRecipientDataBytes(tx.recipientData)
    if (bytes.length !== FRAME_SIZE) return null
    if (bytes[0] !== STREAM_MAGIC) return null
    const buf = Buffer.from(bytes)
    return {
      txHash: String(tx.hash || '').replace(/^0x/i, '').toLowerCase(),
      hex: buf.toString('hex'),
      buf,
      order,
      from: String(tx.from || ''),
      blockNumber: tx.blockNumber,
    }
  } catch {
    return null
  }
}

/**
 * Scan Nimiq address history for VeriLock stream frames belonging to `pdfSha256`.
 * Callers typically pass the service wallet (sender) and/or attestation sink.
 */
export async function scanAddressForArchiveFrames(
  address: string,
  pdfSha256: string,
  options?: { maxTxs?: number; pageSize?: number },
): Promise<{ pool: ScannedFrame[]; scannedTxs: number; truncated: boolean }> {
  const maxTxs = options?.maxTxs ?? 1500
  const pageSize = options?.pageSize ?? 100
  const hitsNewestFirst: ScannedFrame[] = []
  let scannedTxs = 0
  let startAt: string | null = null
  let truncated = false

  while (scannedTxs < maxTxs) {
    const batch = Math.min(pageSize, maxTxs - scannedTxs)
    const txs = await fetchTransactionsByAddress(address, batch, startAt)
    if (txs.length === 0) break
    for (const tx of txs) {
      scannedTxs += 1
      // order filled after reverse
      const frame = txToFrame(tx, 0)
      if (frame && frame.txHash) hitsNewestFirst.push(frame)
    }
    if (txs.length < batch) break
    if (scannedTxs >= maxTxs) {
      truncated = true
      break
    }
    const last = txs[txs.length - 1]
    if (!last?.hash) break
    startAt = last.hash.replace(/^0x/i, '').toLowerCase()
  }

  // Chronological: oldest first
  const chronological = hitsNewestFirst.reverse()
  chronological.forEach((f, i) => {
    f.order = i
  })
  return { pool: chronological, scannedTxs, truncated }
}

/**
 * Hash-only recovery: find all archive streams for a PDF fingerprint on Nimiq
 * by scanning the service wallet / sink. No DB index and no recovery file required.
 */
export async function scanArchiveByPdfHash(
  pdfSha256: string,
  options?: {
    maxTxs?: number
    pageSize?: number
    /**
     * Addresses to scan. Default: **service wallet only** (sender of archives).
     * Do not include the public sink by default — anyone can send dust to the sink.
     */
    addresses?: string[]
  },
): Promise<ScanArchiveResult> {
  const hash = pdfSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    return {
      originalSha256: hash,
      found: false,
      framesHex: [],
      txHashes: [],
      streamCount: 0,
      scannedTxs: 0,
      truncated: false,
      scanAddresses: [],
      error: 'SHA-256 must be 64 hex characters',
    }
  }

  const { getServiceWalletAddress } = await import('./serviceWallet.js')
  const service = getServiceWalletAddress()
  // Integrity: only scan service wallet (frames we broadcast). Sink is public.
  const addresses = (
    options?.addresses?.length
      ? options.addresses
      : [service].filter((a): a is string => Boolean(a))
  ).map(a => a.replace(/\s+/g, '').toUpperCase())

  if (addresses.length === 0) {
    return {
      originalSha256: hash,
      found: false,
      framesHex: [],
      txHashes: [],
      streamCount: 0,
      scannedTxs: 0,
      truncated: false,
      scanAddresses: [],
      error:
        'Service wallet not configured for hash-only chain scan (set SERVICE_WALLET_PRIVATE_KEY)',
    }
  }

  const byTx = new Map<string, ScannedFrame>()
  let scannedTxs = 0
  let truncated = false

  for (const addr of addresses) {
    try {
      const part = await scanAddressForArchiveFrames(addr, hash, {
        maxTxs: options?.maxTxs,
        pageSize: options?.pageSize,
      })
      scannedTxs += part.scannedTxs
      truncated = truncated || part.truncated
      for (const f of part.pool) {
        if (!byTx.has(f.txHash)) byTx.set(f.txHash, f)
      }
    } catch (err) {
      console.warn('[archive-scan] address scan failed', addr.slice(0, 12), err)
    }
  }

  const pool = [...byTx.values()].sort((a, b) => {
    const ba = a.blockNumber ?? 0
    const bb = b.blockNumber ?? 0
    if (ba !== bb && ba > 0 && bb > 0) return ba - bb
    return a.order - b.order || a.txHash.localeCompare(b.txHash)
  })
  pool.forEach((f, i) => {
    f.order = i
  })

  // Prefer frames sent by the service wallet when present
  const requireSender = service
    ? service.replace(/\s+/g, '').toUpperCase()
    : null
  const { frames, streamCount } = assembleArchiveStreamsFromPool(hash, pool, {
    requireSender,
    preferModernAssoc: true,
  })
  return {
    originalSha256: hash,
    found: frames.length > 0,
    framesHex: frames.map(f => f.hex),
    txHashes: frames.map(f => f.txHash),
    streamCount,
    scannedTxs,
    truncated,
    scanAddresses: addresses,
  }
}
