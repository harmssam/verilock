import type { EncryptedPackage, SigHandoffPayload } from './types'

const AES_ALG = 'AES-GCM'
const KEY_BITS = 256
const IV_BYTES = 12

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

function assertPayload(raw: unknown, sessionId: string): SigHandoffPayload {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid signature payload')
  const o = raw as Record<string, unknown>
  if (o.v !== 1) throw new Error('Unsupported payload version')
  if (o.format !== 'png' || o.mime !== 'image/png') throw new Error('Unsupported image format')
  if (typeof o.imageB64 !== 'string' || !o.imageB64) throw new Error('Missing image data')
  if (typeof o.sessionId !== 'string' || o.sessionId !== sessionId) {
    throw new Error('Payload session mismatch')
  }
  if (typeof o.width !== 'number' || typeof o.height !== 'number') {
    throw new Error('Invalid image dimensions')
  }
  if (typeof o.capturedAt !== 'number') throw new Error('Invalid capture time')
  // Rough size guard (~400 KiB base64)
  if (o.imageB64.length > 550_000) throw new Error('Signature image too large')
  return {
    v: 1,
    format: 'png',
    mime: 'image/png',
    imageB64: o.imageB64,
    width: o.width,
    height: o.height,
    capturedAt: o.capturedAt,
    sessionId: o.sessionId,
  }
}

export function payloadToBlob(payload: SigHandoffPayload): Blob {
  const bytes = b64ToBytes(payload.imageB64)
  return new Blob([toArrayBuffer(bytes)], { type: 'image/png' })
}

export async function blobToPayload(
  blob: Blob,
  sessionId: string,
  width: number,
  height: number,
): Promise<SigHandoffPayload> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  return {
    v: 1,
    format: 'png',
    mime: 'image/png',
    imageB64: bytesToB64(buf),
    width,
    height,
    capturedAt: Date.now(),
    sessionId,
  }
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
