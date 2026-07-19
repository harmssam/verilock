/**
 * Cross-device signature ink handoff.
 * Server stores SDP/ICE signaling and optional encrypted deposits only — never plaintext ink.
 */
import { randomBytes } from 'node:crypto'
import {
  consumeSigHandoffDeposit,
  createSigHandoffRoom,
  deleteSigHandoffRoom,
  getSigHandoffRoom,
  insertSigHandoffSignal,
  listSigHandoffSignals,
  setSigHandoffStatus,
  storeSigHandoffDeposit,
  type SigHandoffRoom,
  type SigHandoffSignal,
  SIG_HANDOFF_MAX_DEPOSIT_BYTES,
} from './db.js'
import { normalizeAddress } from './addresses.js'

const SESSION_ID_BYTES = 16
const ALLOWED_MSG_TYPES = new Set(['offer', 'answer', 'ice', 'ready', 'bye'])
const MAX_PAYLOAD_JSON_CHARS = 16_384

export function generateSigHandoffId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url')
}

export function assertRoomOpen(room: SigHandoffRoom | null): asserts room is SigHandoffRoom {
  if (!room) throw new Error('Session not found')
  if (room.status === 'expired') throw new Error('Session expired — show a new QR code')
  if (room.status === 'completed') throw new Error('Session already completed')
}

export function createRoom(creatorAddress: string, documentId?: string | null): SigHandoffRoom {
  const id = generateSigHandoffId()
  return createSigHandoffRoom({
    id,
    creatorAddress,
    documentId: documentId?.trim() || null,
  })
}

export function getRoom(id: string): SigHandoffRoom | null {
  return getSigHandoffRoom(id)
}

export function postSignal(
  roomId: string,
  fromRole: 'host' | 'guest',
  msgType: string,
  payload: unknown,
): SigHandoffSignal {
  const room = getSigHandoffRoom(roomId)
  assertRoomOpen(room)
  if (!ALLOWED_MSG_TYPES.has(msgType)) {
    throw new Error('Invalid signal type')
  }
  const payloadStr = JSON.stringify(payload ?? null)
  if (payloadStr.length > MAX_PAYLOAD_JSON_CHARS) {
    throw new Error('Signal payload too large')
  }
  if (fromRole === 'guest' && room.status === 'open') {
    setSigHandoffStatus(roomId, 'connected')
  }
  return insertSigHandoffSignal({
    roomId,
    fromRole,
    msgType,
    payload: payloadStr,
  })
}

export type SigHandoffSignalParsed = {
  id: number
  roomId: string
  fromRole: 'host' | 'guest'
  msgType: string
  payload: unknown
  createdAt: number
}

export function pullSignals(
  roomId: string,
  afterId = 0,
): { room: SigHandoffRoom; messages: SigHandoffSignalParsed[] } {
  const room = getSigHandoffRoom(roomId)
  if (!room) throw new Error('Session not found')
  const messages = listSigHandoffSignals(roomId, afterId).map(m => {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(m.payload)
    } catch {
      parsed = null
    }
    return {
      id: m.id,
      roomId: m.roomId,
      fromRole: m.fromRole,
      msgType: m.msgType,
      payload: parsed,
      createdAt: m.createdAt,
    }
  })
  return { room, messages }
}

export function depositCiphertext(
  roomId: string,
  ivB64: string,
  ciphertextB64: string,
): void {
  const room = getSigHandoffRoom(roomId)
  assertRoomOpen(room)
  let iv: Buffer
  let ciphertext: Buffer
  try {
    iv = Buffer.from(ivB64, 'base64')
    ciphertext = Buffer.from(ciphertextB64, 'base64')
  } catch {
    throw new Error('Invalid deposit encoding')
  }
  if (ciphertext.length === 0) throw new Error('Empty deposit')
  if (ciphertext.length > SIG_HANDOFF_MAX_DEPOSIT_BYTES) {
    throw new Error(`Deposit too large (max ${SIG_HANDOFF_MAX_DEPOSIT_BYTES} bytes)`)
  }
  storeSigHandoffDeposit(roomId, iv, ciphertext)
}

export function takeDeposit(
  roomId: string,
  requesterAddress: string,
): { iv: string; ciphertext: string; alg: 'A256GCM' } | null {
  const room = getSigHandoffRoom(roomId)
  if (!room) throw new Error('Session not found')
  if (normalizeAddress(room.creatorAddress) !== normalizeAddress(requesterAddress)) {
    throw new Error('Only the session host can retrieve the deposit')
  }
  const pair = consumeSigHandoffDeposit(roomId)
  if (!pair) return null
  return {
    iv: pair.iv.toString('base64'),
    ciphertext: pair.ciphertext.toString('base64'),
    alg: 'A256GCM',
  }
}

export function completeRoom(roomId: string, requesterAddress: string): void {
  const room = getSigHandoffRoom(roomId)
  if (!room) throw new Error('Session not found')
  if (normalizeAddress(room.creatorAddress) !== normalizeAddress(requesterAddress)) {
    throw new Error('Only the session host can complete this session')
  }
  setSigHandoffStatus(roomId, 'completed')
}

export function cancelRoom(roomId: string, requesterAddress: string): boolean {
  const room = getSigHandoffRoom(roomId)
  if (!room) return false
  if (normalizeAddress(room.creatorAddress) !== normalizeAddress(requesterAddress)) {
    throw new Error('Only the session host can cancel this session')
  }
  return deleteSigHandoffRoom(roomId)
}

export function peekDepositAvailable(roomId: string, requesterAddress: string): boolean {
  const room = getSigHandoffRoom(roomId)
  if (!room) return false
  if (normalizeAddress(room.creatorAddress) !== normalizeAddress(requesterAddress)) {
    return false
  }
  return room.hasDeposit && !room.depositConsumed && room.status !== 'expired'
}
