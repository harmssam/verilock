import type { SignaturePathData } from '../pdf/annotations'
import type { EncryptedPackage, HandoffInkResult, SigHandoffPayload } from './types'

const AES_ALG = 'AES-GCM'
const KEY_BITS = 256
const IV_BYTES = 12
const MAX_STROKES = 64
const MAX_POINTS_PER_STROKE = 2_000
const MAX_TOTAL_POINTS = 8_000

function te(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** Copy into a standalone ArrayBuffer for Web Crypto BufferSource typing. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

export async function generatePayloadKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_ALG, length: KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function exportKeyB64url(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  return bytesToB64url(raw)
}

export async function importKeyB64url(b64url: string): Promise<CryptoKey> {
  const raw = b64urlToBytes(b64url)
  if (raw.byteLength !== KEY_BITS / 8) {
    throw new Error('Invalid encryption key')
  }
  return crypto.subtle.importKey('raw', toArrayBuffer(raw), { name: AES_ALG }, false, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptPayload(
  key: CryptoKey,
  sessionId: string,
  payload: SigHandoffPayload,
): Promise<EncryptedPackage> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const plaintext = te(JSON.stringify(payload))
  const aad = te(sessionId)
  const cipherBuf = await crypto.subtle.encrypt(
    { name: AES_ALG, iv: toArrayBuffer(iv), additionalData: toArrayBuffer(aad) },
    key,
    toArrayBuffer(plaintext),
  )
  return {
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(new Uint8Array(cipherBuf)),
    alg: 'A256GCM',
  }
}

export async function decryptPayload(
  key: CryptoKey,
  sessionId: string,
  pkg: Pick<EncryptedPackage, 'iv' | 'ciphertext'>,
): Promise<SigHandoffPayload> {
  const iv = b64ToBytes(pkg.iv)
  const ciphertext = b64ToBytes(pkg.ciphertext)
  const aad = te(sessionId)
  let plainBuf: ArrayBuffer
  try {
    plainBuf = await crypto.subtle.decrypt(
      {
        name: AES_ALG,
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad),
      },
      key,
      toArrayBuffer(ciphertext),
    )
  } catch {
    throw new Error('Could not decrypt signature — wrong key or tampered data')
  }
  const text = new TextDecoder().decode(plainBuf)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid signature payload')
  }
  return assertPayload(parsed, sessionId)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function assertPath(raw: unknown): SignaturePathData {
  if (!raw || typeof raw !== 'object') throw new Error('Missing signature path')
  const o = raw as Record<string, unknown>
  const epsilon = Number(o.epsilon)
  const lineWidthRatio = Number(o.lineWidthRatio)
  if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon > 50) {
    throw new Error('Invalid path epsilon')
  }
  if (!Number.isFinite(lineWidthRatio) || lineWidthRatio <= 0 || lineWidthRatio > 0.5) {
    throw new Error('Invalid path line width')
  }
  if (!Array.isArray(o.strokes) || o.strokes.length === 0) {
    throw new Error('Signature path has no strokes')
  }
  if (o.strokes.length > MAX_STROKES) throw new Error('Too many strokes')

  let totalPoints = 0
  const strokes: SignaturePathData['strokes'] = []
  for (const s of o.strokes) {
    if (!s || typeof s !== 'object') throw new Error('Invalid stroke')
    const pts = (s as { points?: unknown }).points
    if (!Array.isArray(pts) || pts.length === 0) continue
    if (pts.length > MAX_POINTS_PER_STROKE) throw new Error('Stroke too long')
    totalPoints += pts.length
    if (totalPoints > MAX_TOTAL_POINTS) throw new Error('Signature path too large')
    const points: Array<{ x: number; y: number }> = []
    for (const p of pts) {
      if (!p || typeof p !== 'object') throw new Error('Invalid point')
      const x = clamp01(Number((p as { x: unknown }).x))
      const y = clamp01(Number((p as { y: unknown }).y))
      points.push({ x, y })
    }
    if (points.length) strokes.push({ points })
  }
  if (strokes.length === 0) throw new Error('Signature path has no points')
  return {
    epsilon,
    lineWidthRatio,
    strokes,
  }
}

function assertPayload(raw: unknown, sessionId: string): SigHandoffPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid signature payload')
  const o = raw as Record<string, unknown>

  // Legacy PNG-only packages are no longer accepted — re-scan with a new QR.
  if (o.v === 1) {
    throw new Error('Outdated phone link — open a new QR code on your computer')
  }
  if (o.v !== 2) throw new Error('Unsupported payload version')
  if (o.format !== 'vector') throw new Error('Unsupported signature format')
  if (typeof o.sessionId !== 'string' || o.sessionId !== sessionId) {
    throw new Error('Payload session mismatch')
  }
  if (typeof o.capturedAt !== 'number') throw new Error('Invalid capture time')

  const path = assertPath(o.path)

  let imageB64: string | undefined
  if (typeof o.imageB64 === 'string' && o.imageB64) {
    if (o.imageB64.length > 550_000) throw new Error('Signature image too large')
    imageB64 = o.imageB64
  }

  return {
    v: 2,
    format: 'vector',
    sessionId: o.sessionId,
    capturedAt: o.capturedAt,
    path,
    ...(imageB64
      ? {
          imageB64,
          mime: 'image/png' as const,
          width: typeof o.width === 'number' ? o.width : undefined,
          height: typeof o.height === 'number' ? o.height : undefined,
        }
      : {}),
  }
}

/** Build encrypted-ready payload from stroke pad result. */
export function strokeResultToPayload(
  sessionId: string,
  path: SignaturePathData,
  imageDataUrl?: string,
  width?: number,
  height?: number,
): SigHandoffPayload {
  if (!path.strokes?.length) throw new Error('Draw a signature before sending')
  let imageB64: string | undefined
  if (imageDataUrl?.startsWith('data:image/png')) {
    const comma = imageDataUrl.indexOf(',')
    if (comma >= 0) imageB64 = imageDataUrl.slice(comma + 1)
  } else if (imageDataUrl && !imageDataUrl.includes(',')) {
    imageB64 = imageDataUrl
  }
  return {
    v: 2,
    format: 'vector',
    sessionId,
    capturedAt: Date.now(),
    path: {
      epsilon: path.epsilon,
      lineWidthRatio: path.lineWidthRatio,
      strokes: path.strokes.map(s => ({
        points: s.points.map(p => ({ x: p.x, y: p.y })),
      })),
    },
    ...(imageB64
      ? {
          imageB64,
          mime: 'image/png' as const,
          width,
          height,
        }
      : {}),
  }
}

/** Host: decrypt package → UI-ready ink (vectors primary). */
export function payloadToHandoffResult(payload: SigHandoffPayload): HandoffInkResult {
  const path = payload.path
  const simplifiedPoints = path.strokes.reduce((n, s) => n + s.points.length, 0)
  let imageDataUrl = ''
  let blob: Blob | null = null
  if (payload.imageB64) {
    const bytes = b64ToBytes(payload.imageB64)
    blob = new Blob([toArrayBuffer(bytes)], { type: 'image/png' })
    imageDataUrl = `data:image/png;base64,${payload.imageB64}`
  }
  return {
    path,
    imageDataUrl,
    blob,
    rawPoints: simplifiedPoints,
    simplifiedPoints,
    epsilon: path.epsilon,
  }
}

/** @deprecated Prefer strokeResultToPayload — kept name for call-site clarity. */
export function payloadToBlob(payload: SigHandoffPayload): Blob | null {
  return payloadToHandoffResult(payload).blob
}

/** Pack for WebRTC datachannel (JSON over string). */
export function packEncrypted(pkg: EncryptedPackage): string {
  return JSON.stringify(pkg)
}

export function unpackEncrypted(raw: string): EncryptedPackage {
  const o = JSON.parse(raw) as EncryptedPackage
  if (!o?.iv || !o?.ciphertext) throw new Error('Invalid encrypted package')
  return { iv: o.iv, ciphertext: o.ciphertext, alg: 'A256GCM' }
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToB64url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlToBytes(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 0 ? '' : '='.repeat(4 - (b64url.length % 4))
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad
  return b64ToBytes(b64)
}
