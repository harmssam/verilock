import { randomBytes } from 'node:crypto'
import { v4 as uuid } from 'uuid'
import {
  assertPayLoginQrPollSecret,
  createPayLoginQr,
  createSession,
  getPayLoginQr,
  getSession,
  markPayLoginQrReady,
  markSessionVerified,
  consumePayLoginQr,
  type PayLoginQrRecord,
} from './db.js'
import { normalizeAddress } from './addresses.js'

/** Short-lived QR login rooms (desktop poll + phone complete). */
export const PAY_LOGIN_QR_TTL_MS = 3 * 60 * 1000
/** Desktop session lifetime after successful QR login (same as normal login). */
const DESKTOP_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function generatePayLoginQrId(): string {
  return randomBytes(18).toString('base64url')
}

export function generatePayLoginPollSecret(): string {
  return randomBytes(24).toString('base64url')
}

export function startPayLoginQr(): { id: string; pollSecret: string; expiresAt: number } {
  const id = generatePayLoginQrId()
  const pollSecret = generatePayLoginPollSecret()
  const row = createPayLoginQr(id, pollSecret, PAY_LOGIN_QR_TTL_MS)
  return { id: row.id, pollSecret, expiresAt: row.expiresAt }
}

/**
 * Phone finished Pay verify. Mint a fresh desktop session so devices are independent.
 * Does not need pollSecret (phone only has public id from QR).
 */
export function completePayLoginQrFromPhoneSession(
  qrId: string,
  phoneSessionToken: string,
): { ok: true; address: string } {
  const phone = getSession(phoneSessionToken)
  if (!phone || !phone.verified) {
    throw new Error('Verified wallet session required')
  }
  if (!phone.address?.trim()) {
    throw new Error('Wallet address missing from session')
  }

  const qr = getPayLoginQr(qrId)
  if (!qr) throw new Error('QR login session not found')
  if (qr.expiresAt < Date.now() || qr.status === 'expired') {
    throw new Error('QR login session expired')
  }
  if (qr.status === 'consumed') {
    throw new Error('QR login session already used')
  }
  if (qr.status === 'ready') {
    // Idempotent: same phone may retry complete after success.
    return { ok: true, address: qr.address ?? normalizeAddress(phone.address) }
  }
  if (qr.status !== 'pending') {
    throw new Error('QR login session is not available')
  }

  const desktopToken = uuid()
  const address = normalizeAddress(phone.address)
  // Dummy nonce - session is already verified; never used for challenge.
  createSession(desktopToken, address, `qr-login:${qrId}`, DESKTOP_SESSION_TTL_MS)
  markSessionVerified(desktopToken, phone.publicKey ?? '', address)

  markPayLoginQrReady(qrId, {
    desktopToken,
    address,
    publicKey: phone.publicKey ?? '',
  })

  return { ok: true, address }
}

/**
 * Desktop poll: requires pollSecret. If ready, return token once and consume.
 */
export function pollPayLoginQr(
  id: string,
  pollSecret: string,
): {
  status: 'pending' | 'ready' | 'expired' | 'consumed' | 'not_found'
  expiresAt?: number
  token?: string
  address?: string
} {
  let row: PayLoginQrRecord
  try {
    row = assertPayLoginQrPollSecret(id, pollSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) return { status: 'not_found' }
    throw err
  }

  if (row.status === 'expired' || row.expiresAt < Date.now()) {
    return { status: 'expired', expiresAt: row.expiresAt }
  }
  if (row.status === 'consumed') {
    return { status: 'consumed', expiresAt: row.expiresAt }
  }
  if (row.status === 'pending') {
    return { status: 'pending', expiresAt: row.expiresAt }
  }

  // ready → consume and hand token
  try {
    const creds = consumePayLoginQr(id, pollSecret)
    if (!creds) {
      return { status: 'pending', expiresAt: row.expiresAt }
    }
    return {
      status: 'ready',
      expiresAt: row.expiresAt,
      token: creds.token,
      address: creds.address,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/already used/i.test(message)) return { status: 'consumed', expiresAt: row.expiresAt }
    if (/expired/i.test(message)) return { status: 'expired', expiresAt: row.expiresAt }
    if (/poll secret/i.test(message)) throw err
    throw err
  }
}

export type { PayLoginQrRecord }
