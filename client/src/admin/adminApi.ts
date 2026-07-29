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

/** Daily activity series for admin cards (always 90 UTC days, oldest → newest). */
export interface AdminStatsTimeline {
  dayCount: 90
  days: string[]
  startMs: number
  series: {
    documentsCreated: number[]
    documentsLocked: number[]
    uniqueWalletsFirstSeen: number[]
    signatures: number[]
    parties: number[]
    attestations: number[]
    dataArchives: number[]
    creditGranted: number[]
    creditSpent: number[]
    sessionsCreated: number[]
    supportTickets: number[]
  }
}

export type AdminTimelineRange = 30 | 60 | 90

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
  support: {
    total: number
    open: number
    byStatus: Record<string, number>
  }
  /** Daily activity series (90 UTC days); UI slices to 30/60/90. */
  timeline?: AdminStatsTimeline
}

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_customer'
  | 'resolved'
  | 'closed'

export interface SupportTicket {
  id: string
  publicId: string
  name: string
  email: string
  subject: string
  issue?: string | null
  walletAddress?: string | null
  status: SupportTicketStatus
  documentSlug: string | null
  createdAt: number
  updatedAt: number
  resolvedAt: number | null
  volumeNoticeSentAt?: number | null
}

export interface SupportTicketListItem extends SupportTicket {
  messageCount: number
  lastMessageAt: number
  lastMessagePreview: string | null
  lastAuthorKind: 'customer' | 'operator' | 'system' | null
}

export type SupportMessageKind =
  | 'customer'
  | 'human_reply'
  | 'auto_ack'
  | 'volume_notice'
  | 'internal'

export interface SupportTicketMessage {
  id: string
  ticketId: string
  authorKind: 'customer' | 'operator' | 'system'
  authorName: string | null
  body: string
  resendMessageId: string | null
  createdAt: number
  messageKind?: SupportMessageKind
}

export interface SupportReplyTemplate {
  id: string
  label: string
  category: string
  body: string
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
  tickets: (params?: { status?: string; q?: string; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams()
    if (params?.status) sp.set('status', params.status)
    if (params?.q) sp.set('q', params.q)
    if (params?.limit != null) sp.set('limit', String(params.limit))
    if (params?.offset != null) sp.set('offset', String(params.offset))
    const qs = sp.toString()
    return adminRequest<{
      tickets: SupportTicketListItem[]
      total: number
      statuses: SupportTicketStatus[]
      /** Global counts (not scoped to the current list filter). */
      counts?: { total: number; open: number }
    }>(`/api/admin/tickets${qs ? `?${qs}` : ''}`)
  },
  ticket: (id: string) =>
    adminRequest<{
      ticket: SupportTicket
      messages: SupportTicketMessage[]
      statuses: SupportTicketStatus[]
    }>(`/api/admin/tickets/${encodeURIComponent(id)}`),
  updateTicket: (
    id: string,
    body: { status?: SupportTicketStatus; documentSlug?: string | null },
  ) =>
    adminRequest<{ ticket: SupportTicket }>(`/api/admin/tickets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  replyTicket: (
    id: string,
    body: { body: string; status?: SupportTicketStatus; internalOnly?: boolean },
  ) =>
    adminRequest<{
      ok: true
      ticket: SupportTicket
      messages: SupportTicketMessage[]
      emailed: boolean
    }>(`/api/admin/tickets/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  supportTemplates: () =>
    adminRequest<{ templates: SupportReplyTemplate[] }>('/api/admin/support/templates'),
}
