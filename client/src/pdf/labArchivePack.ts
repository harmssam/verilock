/**
 * Client-side pack for /pdf2 lab: annotation stream (v1) + archive manifest (v3).
 * Mirrors server 8-byte association layout so local pack matches on-chain frames.
 */
import type { PdfAnnotation } from './annotations'
import {
  ASSOC_LEN,
  FRAME_BODY,
  FRAME_DATA,
  FRAME_END,
  FRAME_HEAD,
  FRAME_HEADER,
  FRAME_SIZE,
  MAX_STREAM_FRAMES,
  STREAM_MAGIC,
  packAnnotationStream,
  framesToHex,
  slimAnnotations,
} from './annotationStream'
import { normalizeHex64 } from './placements'

const STREAM_VERSION_MANIFEST = 3

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

function hexToBytes(hex: string): Uint8Array {
  const clean = normalizeHex64(hex)
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function writeHeader(
  frame: Uint8Array,
  version: number,
  type: number,
  seq: number,
  total: number,
  pdfHash: Uint8Array,
): void {
  frame[0] = STREAM_MAGIC
  frame[1] = version & 0xff
  frame[2] = type
  frame[3] = seq & 0xff
  frame[4] = total & 0xff
  for (let i = 0; i < ASSOC_LEN; i++) {
    frame[5 + i] = pdfHash[i]!
  }
}

/** Pack arbitrary JSON into 0xA1 HEAD+DATA*+END with 8-byte association id. */
export function packJsonStreamFrames(
  pdfSha256: string,
  version: number,
  payload: unknown,
): Uint8Array[] {
  const hash = hexToBytes(pdfSha256)
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const checksum = crc32(json)
  const dataChunks: Uint8Array[] = []
  for (let off = 0; off < json.length; off += FRAME_BODY) {
    dataChunks.push(json.subarray(off, Math.min(json.length, off + FRAME_BODY)))
  }
  if (dataChunks.length === 0) dataChunks.push(new Uint8Array(0))
  const total = 2 + dataChunks.length
  if (total > MAX_STREAM_FRAMES) {
    throw new Error(`Lab stream too large (${total} frames; max ${MAX_STREAM_FRAMES})`)
  }
  const frames: Uint8Array[] = []
  let seq = 0
  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, version, FRAME_HEAD, seq++, total, hash)
    f.set(hash, FRAME_HEADER)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER + 32, json.length, false)
    view.setUint16(FRAME_HEADER + 36, 0, false)
    view.setUint32(FRAME_HEADER + 38, checksum, false)
    frames.push(f)
  }
  for (const chunk of dataChunks) {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, version, FRAME_DATA, seq++, total, hash)
    f.set(chunk, FRAME_HEADER)
    frames.push(f)
  }
  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, version, FRAME_END, seq++, total, hash)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER, json.length, false)
    view.setUint32(FRAME_HEADER + 4, checksum, false)
    frames.push(f)
  }
  return frames
}

export function associationIdHex(pdfSha256: string): string {
  return normalizeHex64(pdfSha256).slice(0, ASSOC_LEN * 2)
}

export interface LabArchivePack {
  pdfSha256: string
  associationId: string
  framesHex: string[]
  frameCount: number
  annotationFrames: number
  manifestFrames: number
  payloadBytes: number
  annotationsSlim: unknown[]
}

/**
 * Pack free-form annotations + a tiny v3 manifest (people/sigs) for hash-only demo.
 */
export async function packLabArchive(input: {
  pdfSha256: string
  annotations: PdfAnnotation[]
  displayName?: string
  walletAddress?: string | null
}): Promise<LabArchivePack> {
  const pdfSha256 = normalizeHex64(input.pdfSha256)
  const annFrames = packAnnotationStream(pdfSha256, input.annotations)
  const slim = slimAnnotations(input.annotations)
  const payloadBytes = new TextEncoder().encode(JSON.stringify(slim)).length

  const w = input.walletAddress?.replace(/\s+/g, '').toUpperCase() || undefined
  const manifest = {
    v: 3 as const,
    kind: 'archive_manifest' as const,
    pdf: pdfSha256,
    title: 'pdf2 lab archive',
    people: [
      {
        i: 1,
        n: (input.displayName || 'Lab signer').slice(0, 80),
        ...(w ? { w } : {}),
      },
    ],
    sigs: w
      ? [
          {
            i: 1,
            w,
            n: (input.displayName || 'Lab signer').slice(0, 80),
            at: Date.now(),
            t: 'drawn',
            sha: pdfSha256,
          },
        ]
      : [],
  }
  const manFrames = packJsonStreamFrames(pdfSha256, STREAM_VERSION_MANIFEST, manifest)
  const all = [...annFrames, ...manFrames]

  return {
    pdfSha256,
    associationId: associationIdHex(pdfSha256),
    framesHex: framesToHex(all),
    frameCount: all.length,
    annotationFrames: annFrames.length,
    manifestFrames: manFrames.length,
    payloadBytes,
    annotationsSlim: slim,
  }
}
