/** Cross-device signature ink handoff types (client). */

export type SigHandoffPayload = {
  v: 1
  format: 'png'
  mime: 'image/png'
  /** Base64 PNG (no data-URL prefix). */
  imageB64: string
  width: number
  height: number
  capturedAt: number
  sessionId: string
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
