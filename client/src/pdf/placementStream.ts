/**
 * Placement stream v2 — BLOB / PLACE / FILL batches on 0xA1 Nimiq frames.
 *
 * Version byte = 2 (v1 free-form annotation streams remain STREAM_VERSION 1).
 * Each batch is its own HEAD+DATA*+END multi-tx sequence, chained by prevRoot.
 * Identical ink/text is content-addressed: emit BLOB once, FILL many times.
 */

import type { PdfAnnotation, SignaturePathData } from './annotations'
import {
  type ConstructionPerson,
  type ConstructionPlan,
  type ContentBlob,
  type PlacementBatch,
  type PlacementSlot,
  type SlotFill,
  ZERO_ROOT,
  kindFromWire,
  kindToWire,
  normalizeHex32,
  normalizeHex64,
  planLockBatch,
  q,
  clamp01,
  sha256HexBytes,
  utf8Buffer,
} from './placements'

export const STREAM_MAGIC = 0xa1
/** Placement / construction stream version (v1 = free-form annotations). */
export const STREAM_VERSION_V2 = 2
export const FRAME_SIZE = 64
export const FRAME_HEADER = 9
export const FRAME_BODY = FRAME_SIZE - FRAME_HEADER // 55
export const MAX_STREAM_FRAMES = 128

export const FRAME_HEAD = 1
export const FRAME_DATA = 2
export const FRAME_END = 3

// --- framing helpers (mirror annotationStream v1 layout) ---

function hexToBytes(hex: string): Uint8Array {
  const clean = normalizeHex64(hex)
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
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

function writeHeader(
  frame: Uint8Array,
  type: number,
  seq: number,
  total: number,
  hashPrefix: Uint8Array,
): void {
  frame[0] = STREAM_MAGIC
  frame[1] = STREAM_VERSION_V2
  frame[2] = type
  frame[3] = seq & 0xff
  frame[4] = total & 0xff
  frame[5] = hashPrefix[0]!
  frame[6] = hashPrefix[1]!
  frame[7] = hashPrefix[2]!
  frame[8] = hashPrefix[3]!
}

/** Wire form of one append batch (canonical JSON keys). */
export type BatchWire = {
  v: 2
  bi: number
  pr: string
  pl: string
  people?: Array<{ i: number; n: string; r?: string }>
  places?: Array<{
    id: string
    p: number
    k: string
    page: number
    x: number
    y: number
    w: number
    h: number
    lc?: { t?: string; m?: string; f?: number; c?: string }
  }>
  blobs?: Array<{ id: string; t: 'ink' | 'text'; d: unknown }>
  fills?: Array<{ s: string; b: string; p: number }>
}

export function batchToWire(batch: PlacementBatch): BatchWire {
  const wire: BatchWire = {
    v: 2,
    bi: batch.batchIndex | 0,
    pr: normalizeHex64(batch.prevRoot || ZERO_ROOT),
    pl: normalizeHex64(batch.planRoot),
  }

  if (batch.people?.length) {
    wire.people = [...batch.people]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map(p => {
        const row: { i: number; n: string; r?: string } = {
          i: p.slotIndex,
          n: String(p.displayName ?? '').trim().slice(0, 80),
        }
        if (p.role) row.r = String(p.role).slice(0, 40)
        return row
      })
  }

  if (batch.places?.length) {
    wire.places = [...batch.places]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(s => {
        const row: NonNullable<BatchWire['places']>[number] = {
          id: s.id,
          p: s.personSlotIndex,
          k: kindToWire(s.kind),
          page: s.pageIndex | 0,
          x: q(clamp01(s.x)),
          y: q(clamp01(s.y)),
          w: q(Math.max(1e-9, clamp01(s.width))),
          h: q(Math.max(1e-9, clamp01(s.height))),
        }
        if (s.lockedContent) {
          const lc: { t?: string; m?: string; f?: number; c?: string } = {}
          if (s.lockedContent.text != null) lc.t = String(s.lockedContent.text).slice(0, 500)
          if (s.lockedContent.mark) lc.m = s.lockedContent.mark === 'checkmark' ? 'c' : 'k'
          if (s.lockedContent.fontSizeRatio != null) lc.f = q(s.lockedContent.fontSizeRatio, 4)
          if (s.lockedContent.color) lc.c = s.lockedContent.color
          if (Object.keys(lc).length) row.lc = lc
        }
        return row
      })
  }

  if (batch.blobs.length) {
    wire.blobs = batch.blobs
      .slice()
      .sort((a, b) => a.blobId.localeCompare(b.blobId))
      .map(blob => {
        if (blob.payload.kind === 'ink') {
          return {
            id: normalizeHex32(blob.blobId),
            t: 'ink' as const,
            d: {
              epsilon: q(blob.payload.path.epsilon, 2),
              lineWidthRatio: q(blob.payload.path.lineWidthRatio, 4),
              strokes: blob.payload.path.strokes.map(s => ({
                points: s.points.map(pt => ({ x: q(pt.x), y: q(pt.y) })),
              })),
            },
          }
        }
        const d: Record<string, unknown> = {
          text: String(blob.payload.text ?? '').slice(0, 500),
        }
        if (blob.payload.fontSizeRatio != null) d.font = q(blob.payload.fontSizeRatio, 4)
        if (blob.payload.color) d.color = blob.payload.color
        return {
          id: normalizeHex32(blob.blobId),
          t: 'text' as const,
          d,
        }
      })
  }

  if (batch.fills.length) {
    wire.fills = batch.fills
      .slice()
      .sort((a, b) => a.slotId.localeCompare(b.slotId) || a.blobId.localeCompare(b.blobId))
      .map(f => ({
        s: f.slotId,
        b: normalizeHex32(f.blobId),
        p: f.personSlotIndex,
      }))
  }

  return wire
}

export function wireToBatch(wire: BatchWire, pdfSha256: string): PlacementBatch {
  if (wire.v !== 2) throw new Error(`Unsupported batch wire version ${wire.v}`)

  const people: ConstructionPerson[] | undefined = wire.people?.map(p => ({
    slotIndex: p.i,
    displayName: p.n,
    ...(p.r ? { role: p.r } : {}),
  }))

  const places: PlacementSlot[] | undefined = wire.places?.map(s => {
    const slot: PlacementSlot = {
      id: s.id,
      personSlotIndex: s.p,
      kind: kindFromWire(s.k),
      pageIndex: s.page,
      x: s.x,
      y: s.y,
      width: s.w,
      height: s.h,
    }
    if (s.lc) {
      slot.lockedContent = {
        ...(s.lc.t != null ? { text: s.lc.t } : {}),
        ...(s.lc.m === 'c'
          ? { mark: 'checkmark' as const }
          : s.lc.m === 'k'
            ? { mark: 'cross' as const }
            : {}),
        ...(s.lc.f != null ? { fontSizeRatio: s.lc.f } : {}),
        ...(s.lc.c ? { color: s.lc.c } : {}),
      }
    }
    return slot
  })

  const blobs: ContentBlob[] = (wire.blobs ?? []).map(b => {
    if (b.t === 'ink') {
      const d = b.d as SignaturePathData
      return {
        blobId: normalizeHex32(b.id),
        payload: {
          kind: 'ink',
          path: {
            epsilon: d.epsilon,
            lineWidthRatio: d.lineWidthRatio,
            strokes: d.strokes ?? [],
          },
        },
      }
    }
    const d = b.d as { text?: string; font?: number; color?: string }
    return {
      blobId: normalizeHex32(b.id),
      payload: {
        kind: 'text',
        text: d.text ?? '',
        ...(d.font != null ? { fontSizeRatio: d.font } : {}),
        ...(d.color ? { color: d.color } : {}),
      },
    }
  })

  const fills: SlotFill[] = (wire.fills ?? []).map(f => ({
    slotId: f.s,
    blobId: normalizeHex32(f.b),
    personSlotIndex: f.p,
  }))

  return {
    batchIndex: wire.bi,
    prevRoot: normalizeHex64(wire.pr || ZERO_ROOT),
    pdfSha256: normalizeHex64(pdfSha256),
    planRoot: normalizeHex64(wire.pl),
    people,
    places,
    blobs,
    fills,
  }
}

export function wireJson(batch: PlacementBatch): string {
  return JSON.stringify(batchToWire(batch))
}

export async function computeBatchRoot(batch: PlacementBatch): Promise<string> {
  return sha256HexBytes(utf8Buffer(wireJson(batch)))
}

/** Pack one batch into fixed 64-byte v2 frames. */
export function packPlacementBatch(batch: PlacementBatch): Uint8Array[] {
  const hash = hexToBytes(batch.pdfSha256)
  const json = new TextEncoder().encode(wireJson(batch))
  const checksum = crc32(json)

  const dataChunks: Uint8Array[] = []
  for (let off = 0; off < json.length; off += FRAME_BODY) {
    dataChunks.push(json.subarray(off, Math.min(json.length, off + FRAME_BODY)))
  }
  if (dataChunks.length === 0) dataChunks.push(new Uint8Array(0))

  const total = 2 + dataChunks.length
  if (total > MAX_STREAM_FRAMES) {
    throw new Error(
      `Placement batch too large (${total} frames; max ${MAX_STREAM_FRAMES})`,
    )
  }

  const frames: Uint8Array[] = []
  let seq = 0

  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_HEAD, seq++, total, hash)
    f.set(hash, FRAME_HEADER)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER + 32, json.length, false)
    // batch index in the u16 formerly used as annCount
    view.setUint16(FRAME_HEADER + 36, batch.batchIndex & 0xffff, false)
    view.setUint32(FRAME_HEADER + 38, checksum, false)
    frames.push(f)
  }

  for (const chunk of dataChunks) {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_DATA, seq++, total, hash)
    f.set(chunk, FRAME_HEADER)
    frames.push(f)
  }

  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_END, seq++, total, hash)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER, json.length, false)
    view.setUint32(FRAME_HEADER + 4, checksum, false)
    frames.push(f)
  }

  return frames
}

export function framesToHex(frames: Uint8Array[]): string[] {
  return frames.map(f => bytesToHex(f))
}

export function hexToFrame(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (clean.length !== FRAME_SIZE * 2 || !/^[0-9a-f]+$/.test(clean)) {
    throw new Error('Invalid frame hex')
  }
  const out = new Uint8Array(FRAME_SIZE)
  for (let i = 0; i < FRAME_SIZE; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export interface UnpackedPlacementBatch {
  batch: PlacementBatch
  payloadBytes: number
  frameCount: number
  checksum: number
  batchRoot: string
  wire: BatchWire
}

export async function unpackPlacementBatch(
  framesIn: Uint8Array[],
): Promise<UnpackedPlacementBatch> {
  if (framesIn.length < 2) throw new Error('Not enough frames')
  const frames = [...framesIn].sort((a, b) => (a[3] ?? 0) - (b[3] ?? 0))

  const head = frames[0]!
  if (head[0] !== STREAM_MAGIC) throw new Error('Bad stream magic')
  if (head[1] !== STREAM_VERSION_V2) {
    throw new Error(`Expected stream version ${STREAM_VERSION_V2}, got ${head[1]}`)
  }
  if (head[2] !== FRAME_HEAD) throw new Error('First frame must be HEAD')

  const total = head[4]!
  if (frames.length !== total) {
    throw new Error(`Expected ${total} frames, got ${frames.length}`)
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]![3] !== i) throw new Error(`Frame sequence gap at ${i}`)
  }

  const hash = head.subarray(FRAME_HEADER, FRAME_HEADER + 32)
  const hashPrefix = hash.subarray(0, 4)
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const payloadLen = view.getUint32(FRAME_HEADER + 32, false)
  const batchIndexHead = view.getUint16(FRAME_HEADER + 36, false)
  const checksum = view.getUint32(FRAME_HEADER + 38, false)
  const pdfSha256 = bytesToHex(hash)

  const parts: Uint8Array[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== STREAM_MAGIC) throw new Error(`Bad magic on frame ${i}`)
    if (f[1] !== STREAM_VERSION_V2) throw new Error(`Bad version on frame ${i}`)
    for (let b = 0; b < 4; b++) {
      if (f[5 + b] !== hashPrefix[b]) throw new Error(`Hash prefix mismatch on frame ${i}`)
    }
    if (f[2] === FRAME_DATA) {
      parts.push(f.subarray(FRAME_HEADER))
    } else if (f[2] === FRAME_END) {
      const endView = new DataView(f.buffer, f.byteOffset, f.byteLength)
      const endLen = endView.getUint32(FRAME_HEADER, false)
      const endCrc = endView.getUint32(FRAME_HEADER + 4, false)
      if (endLen !== payloadLen || endCrc !== checksum) {
        throw new Error('END frame checksum mismatch')
      }
    } else {
      throw new Error(`Unexpected frame type on frame ${i}`)
    }
  }

  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    joined.set(p, off)
    off += p.length
  }
  const payload = joined.subarray(0, payloadLen)
  if (crc32(payload) !== checksum) throw new Error('Payload CRC mismatch')

  const wire = JSON.parse(new TextDecoder().decode(payload)) as BatchWire
  if (!wire || wire.v !== 2) throw new Error('Invalid batch wire JSON')
  if ((wire.bi & 0xffff) !== batchIndexHead) {
    throw new Error(`Batch index mismatch: HEAD ${batchIndexHead} vs payload ${wire.bi}`)
  }

  const batch = wireToBatch(wire, pdfSha256)
  const batchRoot = await sha256HexBytes(payload.slice())

  return {
    batch: { ...batch, batchRoot },
    payloadBytes: payloadLen,
    frameCount: total,
    checksum,
    batchRoot,
    wire,
  }
}

export interface MergedPlacementState {
  pdfSha256: string
  planRoot: string
  people: ConstructionPerson[]
  slots: PlacementSlot[]
  /** blobId → payload */
  blobs: Map<string, ContentBlob['payload']>
  /** slotId → blobId */
  fills: Map<string, string>
  batches: PlacementBatch[]
  /** blob ids that appeared as FILL without a BLOB body in any batch */
  missingBlobIds: string[]
}

/**
 * Merge ordered batches (batchIndex ascending). Verifies prevRoot chain.
 */
export async function mergePlacementBatches(
  batchesIn: PlacementBatch[],
): Promise<MergedPlacementState> {
  const batches = [...batchesIn].sort((a, b) => a.batchIndex - b.batchIndex)
  if (batches.length === 0) {
    throw new Error('No placement batches')
  }

  let prevRoot = ZERO_ROOT
  let pdfSha256 = ''
  let planRoot = ''
  let people: ConstructionPerson[] = []
  let slots: PlacementSlot[] = []
  const blobs = new Map<string, ContentBlob['payload']>()
  const fills = new Map<string, string>()
  const referencedBlobIds = new Set<string>()

  for (const batch of batches) {
    if (batch.prevRoot !== prevRoot) {
      throw new Error(
        `Batch ${batch.batchIndex} prevRoot mismatch (expected ${prevRoot.slice(0, 12)}…, got ${batch.prevRoot.slice(0, 12)}…)`,
      )
    }
    if (!pdfSha256) pdfSha256 = normalizeHex64(batch.pdfSha256)
    else if (normalizeHex64(batch.pdfSha256) !== pdfSha256) {
      throw new Error('Batch pdfSha256 mismatch')
    }
    if (!planRoot) planRoot = normalizeHex64(batch.planRoot)
    else if (normalizeHex64(batch.planRoot) !== planRoot) {
      throw new Error('Batch planRoot mismatch')
    }

    if (batch.people?.length) people = batch.people
    if (batch.places?.length) slots = batch.places

    for (const blob of batch.blobs) {
      blobs.set(blob.blobId, blob.payload)
    }
    for (const f of batch.fills) {
      fills.set(f.slotId, f.blobId)
      referencedBlobIds.add(f.blobId)
    }

    const root = batch.batchRoot ?? (await computeBatchRoot(batch))
    prevRoot = root
  }

  const missingBlobIds = [...referencedBlobIds].filter(id => !blobs.has(id))

  return {
    pdfSha256,
    planRoot,
    people,
    slots,
    blobs,
    fills,
    batches,
    missingBlobIds,
  }
}

/** Expand merged state to paint-ready PdfAnnotation[] (filled + locked content). */
export function expandMergedToAnnotations(state: MergedPlacementState): PdfAnnotation[] {
  const out: PdfAnnotation[] = []
  for (const slot of state.slots) {
    const geo = {
      pageIndex: slot.pageIndex,
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
    }
    const blobId = state.fills.get(slot.id)
    if (blobId) {
      const payload = state.blobs.get(blobId)
      if (!payload) continue // missing blob — caller can warn via missingBlobIds
      if (payload.kind === 'ink') {
        out.push({
          id: slot.id,
          type: 'signature',
          ...geo,
          imageDataUrl: '',
          path: payload.path,
        })
        continue
      }
      out.push({
        id: slot.id,
        type: 'text',
        ...geo,
        text: payload.text,
        fontSizeRatio: payload.fontSizeRatio ?? 0.025,
        color: payload.color ?? '#0f172a',
      })
      continue
    }

    // Unfilled: only paint creator locked content
    if (slot.lockedContent?.mark) {
      out.push({
        id: slot.id,
        type: slot.lockedContent.mark,
        ...geo,
        color: slot.lockedContent.color,
      })
      continue
    }
    if (slot.lockedContent?.text) {
      out.push({
        id: slot.id,
        type: 'text',
        ...geo,
        text: slot.lockedContent.text,
        fontSizeRatio: slot.lockedContent.fontSizeRatio ?? 0.025,
        color: slot.lockedContent.color ?? '#0f172a',
      })
    }
  }
  return out
}

/**
 * Reconstruct paint-ready annotations from plan geometry + authorized fill
 * wire frames (BLOB/FILL payloads). Used for party-only signed document review.
 */
export async function reconstructAnnotationsFromPlanAndFills(input: {
  slots: PlacementSlot[]
  fillBatches: Array<{ framesHex?: string[] | null }>
}): Promise<{ annotations: PdfAnnotation[]; filledCount: number; missingBlobIds: string[] }> {
  const blobs = new Map<string, ContentBlob['payload']>()
  const fills = new Map<string, string>()
  const referenced = new Set<string>()

  for (const batch of input.fillBatches) {
    const hex = batch.framesHex
    if (!hex?.length) continue
    try {
      const frames = hex.map(h => hexToFrame(h))
      const unpacked = await unpackPlacementBatch(frames)
      for (const blob of unpacked.batch.blobs) {
        blobs.set(blob.blobId, blob.payload)
      }
      for (const f of unpacked.batch.fills) {
        fills.set(f.slotId, f.blobId)
        referenced.add(f.blobId)
      }
    } catch {
      /* skip malformed batch */
    }
  }

  const missingBlobIds = [...referenced].filter(id => !blobs.has(id))
  const annotations = expandMergedToAnnotations({
    pdfSha256: '',
    planRoot: '',
    people: [],
    slots: input.slots,
    blobs,
    fills,
    batches: [],
    missingBlobIds,
  })

  return {
    annotations,
    filledCount: fills.size,
    missingBlobIds,
  }
}

export function estimatePlacementBatchStats(batch: PlacementBatch) {
  const frames = packPlacementBatch(batch)
  const payloadBytes = new TextEncoder().encode(wireJson(batch)).length
  return {
    frameCount: frames.length,
    payloadBytes,
    framesHex: framesToHex(frames),
    blobCount: batch.blobs.length,
    fillCount: batch.fills.length,
    placeCount: batch.places?.length ?? 0,
  }
}

/** Pack plan lock (batch 0) after planRoot is set. */
export async function packLockedPlan(plan: ConstructionPlan): Promise<{
  batch: PlacementBatch
  frames: Uint8Array[]
  batchRoot: string
  stats: ReturnType<typeof estimatePlacementBatchStats>
}> {
  if (plan.status !== 'locked' || !plan.planRoot) {
    throw new Error('Plan must be locked')
  }
  const batch = planLockBatch(plan)
  const batchRoot = await computeBatchRoot(batch)
  const withRoot = { ...batch, batchRoot }
  const frames = packPlacementBatch(withRoot)
  return {
    batch: withRoot,
    frames,
    batchRoot,
    stats: estimatePlacementBatchStats(withRoot),
  }
}
