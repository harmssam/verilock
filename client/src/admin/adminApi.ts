/**
 * Admin portal API client (cookie session, credentials: include).
 */
const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
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

export interface AdminFeatures {
  adminEnabled: boolean
  turnstileRequired: boolean
  turnstileSiteKey: string | null
}

export interface AdminMe {
  authenticated: boolean
  username?: string
  expiresAt?: number
}

export interface AdminStats {
  generatedAt: number
  documents: {
    total: number
    byStatus: Record<string, number>
    locked: number
    withLockedAt: number
    createdLast24h: number
    createdLast7d: number
  }
  wallets: {
    uniqueCreators: number
    uniqueSigners: number
    uniquePartyWallets: number
    uniqueAll: number
  }
  signatures: {
    total: number
  }
  parties: {
    total: number
    withWallet: number
  }
  attestations: {
    total: number
    byStatus: Record<string, number>
  }
  dataArchives: {
    total: number
    onChain: number
  }
  sessions: {
    verifiedActive: number
  }
  credits: {
    accountsWithBalance: number
    totalBalance: number
  }
  recentDocuments: Array<{
    id: string
    slug: string
    title: string
    status: string
    creatorAddress: string
    createdAt: number
    lockedAt: number | null
  }>
}

export const adminApi = {
  features: () => adminRequest<AdminFeatures>('/api/admin/features'),
  me: () => adminRequest<AdminMe>('/api/admin/me'),
  login: (body: {
    username: string
    password: string
    turnstileToken?: string | null
    website?: string
  }) =>
    adminRequest<{ ok: true; username: string; expiresAt: number }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () =>
    adminRequest<{ ok: true }>('/api/admin/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  stats: () => adminRequest<AdminStats>('/api/admin/stats'),
}
