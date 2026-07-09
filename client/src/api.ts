import type { AttestationStatus, DocumentMetadata, SealDocument, VerifyResult } from './types'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options)
  const data = await res.json()
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? `Request failed (${res.status})`
    if (
      path.includes('prepare-lock') ||
      path.includes('begin-lock') ||
      path.includes('attestations') ||
      path.includes('/api/')
    ) {
      console.error('[verilock] api:error', { path, status: res.status, message, data })
    }
    throw new Error(message)
  }
  return data as T
}

export function withAuth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

export interface CreateDocumentBody {
  title: string
  originalFileName?: string
  type: string
  creatorRole: string
  creatorDisplayName: string
  originalSha256: string
  pageCount: number
  requiredSignatures: number
  parties?: Array<{ role: string; displayName: string; required?: boolean }>
  metadata?: DocumentMetadata
  /** Optional ready-to-seal notification email (UI hidden until domain ready). */
  creatorNotifyEmail?: string
}

export interface SignDocumentBody {
  partyId: string
  signatureType: string
  clientSha256: string
  displayName?: string
  signatureImage?: string
}

export const api = {
  health: () => request<{ ok: boolean; app: string; chainVerify: boolean; storageMode?: string }>('/api/health'),

  challenge: (address: string) =>
    request<{ token: string; nonce: string; address: string }>('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    }),

  verify: (
    token: string,
    body: { publicKey: string; signature: string; authScheme?: 'hub' | 'pay' },
  ) =>
    request<{ ok: boolean; address: string; verified: boolean }>('/api/auth/verify', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  me: (token: string) =>
    request<{ address: string; documents: SealDocument[] }>('/api/me', {
      headers: withAuth(token),
    }),

  createDocument: (token: string, body: CreateDocumentBody) =>
    request<{ document: SealDocument; hashWarning?: string }>('/api/documents', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  features: () =>
    request<{
      emailNotifyUi: boolean
      emailNotifySendEnabled: boolean
      emailNotifyConfigured: boolean
    }>('/api/features'),

  setDocumentNotifyEmail: (token: string, docId: string, email: string | null) =>
    request<{ ok: boolean }>(`/api/documents/${docId}/notify-email`, {
      method: 'PATCH',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),

  getDocument: (id: string, token?: string | null) =>
    request<{ document: SealDocument }>(
      `/api/documents/${id}`,
      token ? { headers: withAuth(token) } : {},
    ),

  deleteDocument: (token: string, docId: string) =>
    request<{ ok: boolean }>(`/api/documents/${docId}`, {
      method: 'DELETE',
      headers: withAuth(token),
    }),

  signDocument: (token: string, docId: string, body: SignDocumentBody) =>
    request<{ document: SealDocument }>(`/api/documents/${docId}/signatures`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  sealPricing: () =>
    request<{
      feeNim: number
      feeLuna: number
      baseFeeNim: number
      promoActive: boolean
      promoLabel: string | null
      promoEndsLabel: string | null
    }>('/api/seal-pricing'),

  walletBalance: (token: string) =>
    request<{
      address: string
      balanceLuna: number
      requiredLuna: number
      sufficient: boolean
    }>('/api/wallet-balance', {
      headers: withAuth(token),
    }),

  nimPrices: () =>
    request<{
      usd: number
      eur: number
      cad: number
      lastUpdatedAt: number | null
      source: 'fastspot'
    }>('/api/nim-prices'),

  prepareLock: (token: string, docId: string, finalSha256: string) =>
    request<{
      document: SealDocument
      attestationPayload: string
      pricing: {
        feeNim: number
        feeLuna: number
        baseFeeNim: number
        promoActive: boolean
        promoLabel: string | null
        promoEndsLabel: string | null
      }
    }>(
      `/api/documents/${docId}/prepare-lock`,
      {
        method: 'POST',
        headers: { ...withAuth(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalSha256 }),
      },
    ),

  beginLock: (token: string, docId: string) =>
    request<{ document: SealDocument }>(`/api/documents/${docId}/begin-lock`, {
      method: 'POST',
      headers: { ...withAuth(token) },
    }),

  broadcastTransaction: (token: string, documentId: string, serializedTx: string) =>
    request<{ hash: string }>('/api/transactions/broadcast', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, serializedTx }),
    }),

  submitAttestation: (token: string, docId: string, txHash: string) =>
    request<AttestationStatus>(`/api/documents/${docId}/attestations`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash }),
    }),

  attestationStatus: (token: string, txHash: string) =>
    request<AttestationStatus>(`/api/attestations/status/${txHash}`, {
      headers: withAuth(token),
    }),

  verifyDocument: (idOrSlug: string, token?: string | null) =>
    request<VerifyResult>(
      `/api/verify/${idOrSlug}`,
      token ? { headers: withAuth(token) } : {},
    ),

  verifyHash: (sha256: string) =>
    request<{
      matches: Array<{
        id: string
        slug: string
        title: string
        originalFilename: string | null
        status: string
        finalSha256: string | null
        createdAt: number
        lockedAt: number | null
      }>
    }>(
      '/api/verify/hash',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256 }),
      },
    ),

  certificate: (idOrSlug: string) => request<Record<string, unknown>>(`/api/documents/${idOrSlug}/certificate`),
}