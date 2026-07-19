/** Cross-device signature ink handoff types (client). */

import type { SignaturePathData } from '../pdf/annotations'

/**
 * v2: primary ink is unit-square RDP vectors (same as placement fills).
 * Optional PNG is only a preview / wallet-image convenience.
 */
export type SigHandoffPayload = {
  v: 2
  format: 'vector'
  sessionId: string
  capturedAt: number
  /** Primary: simplified stroke path in unit square. */
  path: SignaturePathData
  /** Optional PNG (no data-URL prefix) for host preview / wallet image. */
  imageB64?: string
  mime?: 'image/png'
  width?: number
  height?: number
}

/** @deprecated v1 PNG-only packages may still decrypt for one release if needed. */
export type SigHandoffPayloadV1 = {
  v: 1
  format: 'png'
  mime: 'image/png'
  imageB64: string
  width: number
  height: number
  capturedAt: number
  sessionId: string
}

/** Result delivered to the host UI after decrypt. */
export type HandoffInkResult = {
  path: SignaturePathData
  /** data:image/png;… when PNG was included or synthesized for preview. */
  imageDataUrl: string
  /** PNG blob for wallet signature image when available. */
  blob: Blob | null
  rawPoints: number
  simplifiedPoints: number
  epsilon: number
}

export type SigHandoffRole = 'host' | 'guest'

export type SigHandoffSignalType = 'offer' | 'answer' | 'ice' | 'ready' | 'bye'

export type SigHandoffRoomStatus = 'open' | 'connected' | 'completed' | 'expired'

export type EncryptedPackage = {
  iv: string
  ciphertext: string
  alg: 'A256GCM'
}

export type HostPhase =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'connecting'
  | 'connected'
  | 'received'
  | 'error'
  | 'closed'

export type GuestPhase =
  | 'loading'
  | 'ready'
  | 'connecting'
  | 'connected'
  | 'preview'
  | 'sending'
  | 'sent'
  | 'error'
