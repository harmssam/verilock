import { withAuth } from '../api'
import type { EncryptedPackage, SigHandoffRole, SigHandoffRoomStatus } from './types'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const message =
      (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data as T
}

export type SignalMessage = {
  id: number
  from: SigHandoffRole
  type: string
  payload: unknown
  createdAt: number
}

export async function createHandoffSession(
  token: string,
  documentId?: string,
): Promise<{ sessionId: string; expiresAt: number; status: SigHandoffRoomStatus }> {
  return request('/api/sig-handoff', {
    method: 'POST',
    headers: { ...withAuth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(documentId ? { documentId } : {}),
  })
}

export async function getHandoffSession(sessionId: string): Promise<{
  sessionId: string
  status: SigHandoffRoomStatus
  expiresAt: number
  hasDeposit: boolean
}> {
  return request(`/api/sig-handoff/${encodeURIComponent(sessionId)}`)
}

export async function postSignal(
  sessionId: string,
  body: { from: SigHandoffRole; type: string; payload: unknown },
  hostToken?: string | null,
): Promise<{ ok: boolean; id: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (body.from === 'host' && hostToken) {
    Object.assign(headers, withAuth(hostToken))
  }
  return request(`/api/sig-handoff/${encodeURIComponent(sessionId)}/signal`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

export async function pollSignals(
  sessionId: string,
  after = 0,
): Promise<{
  status: SigHandoffRoomStatus
  expiresAt: number
  hasDeposit: boolean
  messages: SignalMessage[]
}> {
  return request(
    `/api/sig-handoff/${encodeURIComponent(sessionId)}/signal?after=${after}`,
  )
}

export async function depositEncrypted(
  sessionId: string,
  pkg: EncryptedPackage,
): Promise<{ ok: boolean }> {
  return request(`/api/sig-handoff/${encodeURIComponent(sessionId)}/deposit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iv: pkg.iv, ciphertext: pkg.ciphertext, alg: 'A256GCM' }),
  })
}

export async function takeDeposit(
  token: string,
  sessionId: string,
): Promise<EncryptedPackage | null> {
  try {
    return await request(`/api/sig-handoff/${encodeURIComponent(sessionId)}/deposit`, {
      headers: withAuth(token),
    })
  } catch (err) {
    const status = (err as Error & { status?: number }).status
    if (status === 404) return null
    throw err
  }
}

export async function completeHandoff(token: string, sessionId: string): Promise<void> {
  await request(`/api/sig-handoff/${encodeURIComponent(sessionId)}/complete`, {
    method: 'POST',
    headers: withAuth(token),
  })
}

export async function cancelHandoff(token: string, sessionId: string): Promise<void> {
  await request(`/api/sig-handoff/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: withAuth(token),
  })
}
