/**
 * Pack PDF annotations into ≤64-byte Nimiq basic-tx data frames.
 * Magic 0xA1 distinguishes annotation streams from seal attestation (0x01).
 */
import type { PdfAnnotation, SignaturePathData } from './annotations'

export const STREAM_MAGIC = 0xa1
export const STREAM_VERSION = 1
export const FRAME_SIZE = 64
/** 8-byte association id (first 8 of PDF hash) + body @ 13. Legacy: 4-byte @5 + body @9. */
export const ASSOC_LEN = 8
export const FRAME_HEADER = 5 + ASSOC_LEN // 13
export const FRAME_BODY = FRAME_SIZE - FRAME_HEADER // 51
export const FRAME_HEADER_LEGACY = 9
export const ASSOC_LEN_LEGACY = 4
/** Keep in sync with server MAX_STREAM_FRAMES. */
export const MAX_STREAM_FRAMES = 128

export const FRAME_HEAD = 1
export const FRAME_DATA = 2
export const FRAME_END = 3

/** Slim wire form - no PNG; path for signatures; geometry for marks/text. */
export type StreamAnnotation =
  | {
      t: 's'
      page: number
      x: number
      y: number
      w: number
      h: number
      path?: SignaturePathData
    }
  | {
      t: 'x' // text
      page: number
      x: number
      y: number
      w: number
      h: number
      text: string
      font?: number
      color?: string
    }
  | {
      t: 'c' | 'k' // checkmark | cross (x-mark)
      page: number
      x: number
      y: number
      w: number
      h: number
      color?: string
    }

/** Shorten floats in wire JSON (big win for long signature paths). */
function q(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return 0
  const p = 10 ** digits
  return Math.round(n * p) / p
}

function slimPath(path: SignaturePathData): SignaturePathData {
  return {
    epsilon: q(path.epsilon, 2),
    lineWidthRatio: q(path.lineWidthRatio, 4),
    strokes: path.strokes.map(s => ({
      points: s.points.map(p => ({ x: q(p.x), y: q(p.y) })),
    })),
  }
}

export function slimAnnotations(annotations: PdfAnnotation[]): StreamAnnotation[] {
  const out: StreamAnnotation[] = []
  for (const a of annotations) {
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
      continue
    }
    if (a.type === 'text') {
      out.push({
        t: 'x',
        page: a.pageIndex,
        x: q(a.x),
        y: q(a.y),
        w: q(a.width),
        h: q(a.height),
        text: a.text,
        ...(a.fontSizeRatio != null ? { font: q(a.fontSizeRatio, 4) } : {}),
        color: a.color ?? '#0f172a',
      })
      continue
    }
    if (a.type === 'checkmark' || a.type === 'cross') {
      out.push({
        t: a.type === 'checkmark' ? 'c' : 'k',
        page: a.pageIndex,
        x: q(a.x),
        y: q(a.y),
        w: q(a.width),
        h: q(a.height),
        color: a.color ?? (a.type === 'checkmark' ? '#0f766e' : '#b91c1c'),
      })
    }
  }
  return out
}

export function expandStreamAnnotations(stream: StreamAnnotation[]): PdfAnnotation[] {
  return stream.map((a, i) => {
    const id = `stream_${i}`
    const geo = {
      pageIndex: a.page,
      x: a.x,
      y: a.y,
      width: a.w,
      height: a.h,
    }
    if (a.t === 's') {
      return {
        id,
        type: 'signature' as const,
        ...geo,
        imageDataUrl: '',
        ...(a.path ? { path: a.path } : {}),
      }
    }
    if (a.t === 'x') {
      return {
        id,
        type: 'text' as const,
        ...geo,
        text: a.text,
        fontSizeRatio: a.font ?? 0.025,
        color: a.color ?? '#0f172a',
      }
    }
    return {
      id,
      type: (a.t === 'c' ? 'checkmark' : 'cross') as 'checkmark' | 'cross',
      ...geo,
      color: a.color ?? (a.t === 'c' ? '#0f766e' : '#b91c1c'),
    }
  })
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('pdf hash must be 64 hex chars')
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
  pdfHash: Uint8Array,
): void {
  frame[0] = STREAM_MAGIC
  frame[1] = STREAM_VERSION
  frame[2] = type
  frame[3] = seq & 0xff
  frame[4] = total & 0xff
  for (let i = 0; i < ASSOC_LEN; i++) {
    frame[5 + i] = pdfHash[i]!
  }
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function detectFrameLayout(
  frame: Uint8Array,
  expectedPdfHash?: string | null,
): { header: number; assocLen: number } {
  if (frame.length !== FRAME_SIZE || frame[0] !== STREAM_MAGIC) {
    return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
  }
  if (expectedPdfHash) {
    const clean = expectedPdfHash.replace(/^0x/i, '').toLowerCase()
    const hash = new Uint8Array(32)
    for (let i = 0; i < 32; i++) hash[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
    if (eqBytes(frame.subarray(5, 5 + ASSOC_LEN), hash.subarray(0, ASSOC_LEN))) {
      return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
    }
    if (eqBytes(frame.subarray(5, 9), hash.subarray(0, ASSOC_LEN_LEGACY))) {
      return { header: FRAME_HEADER_LEGACY, assocLen: ASSOC_LEN_LEGACY }
    }
  }
  if (frame[2] === FRAME_HEAD) {
    const fullNew = frame.subarray(FRAME_HEADER, FRAME_HEADER + 32)
    const fullLegacy = frame.subarray(FRAME_HEADER_LEGACY, FRAME_HEADER_LEGACY + 32)
    if (eqBytes(frame.subarray(5, 5 + ASSOC_LEN), fullNew.subarray(0, ASSOC_LEN))) {
      return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
    }
    if (eqBytes(frame.subarray(5, 9), fullLegacy.subarray(0, ASSOC_LEN_LEGACY))) {
      return { header: FRAME_HEADER_LEGACY, assocLen: ASSOC_LEN_LEGACY }
    }
  }
  return { header: FRAME_HEADER, assocLen: ASSOC_LEN }
}

/** Pack annotations into fixed 64-byte frames (HEAD + DATA* + END). */
export function packAnnotationStream(
  pdfSha256: string,
  annotations: PdfAnnotation[],
): Uint8Array[] {
  const hash = hexToBytes(pdfSha256)
  const slim = slimAnnotations(annotations)
  const json = new TextEncoder().encode(JSON.stringify(slim))
  const checksum = crc32(json)

  const dataChunks: Uint8Array[] = []
  for (let off = 0; off < json.length; off += FRAME_BODY) {
    dataChunks.push(json.subarray(off, Math.min(json.length, off + FRAME_BODY)))
  }
  if (dataChunks.length === 0) {
    dataChunks.push(new Uint8Array(0))
  }

  const total = 2 + dataChunks.length // HEAD + DATAs + END
  if (total > MAX_STREAM_FRAMES) {
    throw new Error(
      `Annotation stream too large (${total} frames; max ${MAX_STREAM_FRAMES} for experiment)`,
    )
  }

  const frames: Uint8Array[] = []
  let seq = 0

  // HEAD: full hash (32) + payloadLen u32 + annCount u16 + reserved
  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_HEAD, seq++, total, hash)
    f.set(hash, FRAME_HEADER)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER + 32, json.length, false)
    view.setUint16(FRAME_HEADER + 36, slim.length, false)
    view.setUint32(FRAME_HEADER + 38, checksum, false)
    frames.push(f)
  }

  for (const chunk of dataChunks) {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_DATA, seq++, total, hash)
    f.set(chunk, FRAME_HEADER)
    frames.push(f)
  }

  // END: echo checksum + payloadLen
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

export interface UnpackedStream {
  pdfSha256: string
  annotations: PdfAnnotation[]
  slim: StreamAnnotation[]
  payloadBytes: number
  frameCount: number
  checksum: number
}

export function unpackAnnotationStream(framesIn: Uint8Array[]): UnpackedStream {
  if (framesIn.length < 2) throw new Error('Not enough frames')
  const frames = [...framesIn].sort((a, b) => (a[3] ?? 0) - (b[3] ?? 0))

  const head = frames[0]!
  if (head[0] !== STREAM_MAGIC) throw new Error('Bad stream magic')
  if (head[1] !== STREAM_VERSION) throw new Error('Unsupported stream version')
  if (head[2] !== FRAME_HEAD) throw new Error('First frame must be HEAD')

  const total = head[4]!
  if (frames.length !== total) {
    throw new Error(`Expected ${total} frames, got ${frames.length}`)
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i]![3] !== i) throw new Error(`Frame sequence gap at ${i}`)
  }

  const { header: hdr, assocLen } = detectFrameLayout(head)
  const hash = head.subarray(hdr, hdr + 32)
  const assoc = hash.subarray(0, assocLen)
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const payloadLen = view.getUint32(hdr + 32, false)
  const annCount = view.getUint16(hdr + 36, false)
  const checksum = view.getUint32(hdr + 38, false)
  const pdfSha256 = bytesToHex(hash)

  const parts: Uint8Array[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== STREAM_MAGIC) throw new Error(`Bad magic on frame ${i}`)
    if (f[1] !== STREAM_VERSION) throw new Error(`Bad version on frame ${i}`)
    for (let b = 0; b < assocLen; b++) {
      if (f[5 + b] !== assoc[b]) throw new Error(`Association id mismatch on frame ${i}`)
    }
    const { header: fh } = detectFrameLayout(f, pdfSha256)
    if (f[2] === FRAME_DATA) {
      // body may be zero-padded
      parts.push(f.subarray(fh))
    } else if (f[2] === FRAME_END) {
      const endView = new DataView(f.buffer, f.byteOffset, f.byteLength)
      const endLen = endView.getUint32(fh, false)
      const endCrc = endView.getUint32(fh + 4, false)
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

  const slim = JSON.parse(new TextDecoder().decode(payload)) as StreamAnnotation[]
  if (!Array.isArray(slim)) throw new Error('Invalid stream JSON')
  if (slim.length !== annCount) {
    throw new Error(`Annotation count mismatch: HEAD ${annCount} vs payload ${slim.length}`)
  }
  return {
    pdfSha256,
    annotations: expandStreamAnnotations(slim),
    slim,
    payloadBytes: payloadLen,
    frameCount: total,
    checksum,
  }
}

export function estimateStreamStats(pdfSha256: string, annotations: PdfAnnotation[]) {
  const frames = packAnnotationStream(pdfSha256, annotations)
  const slim = slimAnnotations(annotations)
  const payloadBytes = new TextEncoder().encode(JSON.stringify(slim)).length
  return {
    frameCount: frames.length,
    payloadBytes,
    framesHex: framesToHex(frames),
    slim,
  }
}
