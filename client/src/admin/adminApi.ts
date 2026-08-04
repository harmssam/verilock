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
  /** Content Studio reverse-proxy available (CONTENT_STUDIO_URL). */
  studioProxyEnabled?: boolean
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

/** Editable initial-contact auto-reply (contact form submit). */
export interface SupportAutoAckSettings {
  body: string
  isCustom: boolean
  updatedAt: number | null
  defaultBody: string
  maxLength: number
  placeholders: string[]
}

/** OpenCode Go API key status (admin config). Never includes the raw secret. */
export interface OpenCodeConfigStatus {
  configured: boolean
  source: 'database' | 'environment' | null
  maskedToken: string | null
  updatedAt: number | null
  hasDatabaseOverride: boolean
  hasEnvironmentKey: boolean
  model: string | null
  modelFallback: string | null
  /** True when content-studio accepted the key (blog LLM). */
  studioSynced?: boolean
  studioError?: string
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
  supportAutoAck: () =>
    adminRequest<SupportAutoAckSettings>('/api/admin/support/auto-ack'),
  saveSupportAutoAck: (body: string) =>
    adminRequest<{ ok: true } & SupportAutoAckSettings>('/api/admin/support/auto-ack', {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),
  resetSupportAutoAck: () =>
    adminRequest<{ ok: true } & SupportAutoAckSettings>('/api/admin/support/auto-ack', {
      method: 'PUT',
      body: JSON.stringify({ reset: true }),
    }),

  // ── Inbox ──────────────────────────────────────────────────────────

  inboxList: (params?: { q?: string; archived?: boolean; limit?: number; offset?: number }) => {
    const sp = new URLSearchParams()
    if (params?.q) sp.set('q', params.q)
    if (params?.archived) sp.set('archived', '1')
    if (params?.limit != null) sp.set('limit', String(params.limit))
    if (params?.offset != null) sp.set('offset', String(params.offset))
    const qs = sp.toString()
    return adminRequest<{ emails: InboxEmail[]; total: number; unreadCount: number }>(
      `/api/admin/inbox${qs ? `?${qs}` : ''}`,
    )
  },
  inboxEmail: (id: string) =>
    adminRequest<{ email: InboxEmail }>(`/api/admin/inbox/${encodeURIComponent(id)}`),
  inboxUpdate: (id: string, body: { read?: boolean; archived?: boolean }) =>
    adminRequest<{ email: InboxEmail }>(`/api/admin/inbox/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  inboxMarkAllRead: () =>
    adminRequest<{ ok: true }>('/api/admin/inbox/mark-all-read', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  inboxReply: (id: string, body: string) =>
    adminRequest<{ ok: true; email: InboxEmail }>(
      `/api/admin/inbox/${encodeURIComponent(id)}/reply`,
      { method: 'POST', body: JSON.stringify({ body }) },
    ),

  // ── X Ideas ───────────────────────────────────────────────────────

  xIdeasList: () => adminRequest<{ ideas: XIdea[] }>('/api/admin/x-ideas'),
  xIdeasCreate: (body: XIdeaInput) =>
    adminRequest<{ idea: XIdea }>('/api/admin/x-ideas', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  xIdeasUpdate: (id: string, body: XIdeaInput) =>
    adminRequest<{ idea: XIdea }>(`/api/admin/x-ideas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  xIdeasDelete: (id: string) =>
    adminRequest<{ ok: true }>(`/api/admin/x-ideas/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // ── Admin v2-specific endpoints ────────────────────────────────────

  /** Update idea pipeline status + posted_url */
  xIdeasPipeline: (id: string, body: { status?: string; posted_url?: string }) =>
    adminRequest<{ idea: XIdea }>(`/api/admin-v2/x-ideas/${encodeURIComponent(id)}/pipeline`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** Get all unique ticket tags for autocomplete */
  ticketTags: () => adminRequest<{ tags: string[] }>('/api/admin-v2/tags'),

  /** Get tags for a specific ticket */
  ticketTagsForTicket: (ticketId: string) =>
    adminRequest<{ tags: string[] }>(`/api/admin-v2/tickets/${encodeURIComponent(ticketId)}/tags`),

  /** Get tags for multiple tickets in a single batch request */
  ticketTagsBatch: (ids: string[]) =>
    adminRequest<{ tags: Record<string, string[]> }>('/api/admin-v2/tickets/tags/batch', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),

  /** Replace tags for a ticket */
  ticketTagsSet: (ticketId: string, tags: string[]) =>
    adminRequest<{ tags: string[] }>(`/api/admin-v2/tickets/${encodeURIComponent(ticketId)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    }),

  /** Get audit log entries */
  auditLog: (params?: { limit?: number; offset?: number; action?: string }) => {
    const sp = new URLSearchParams()
    if (params?.limit != null) sp.set('limit', String(params.limit))
    if (params?.offset != null) sp.set('offset', String(params.offset))
    if (params?.action) sp.set('action', params.action)
    const qs = sp.toString()
    return adminRequest<{
      entries: Array<{
        id: string; action: string; actor: string; target_type: string | null
        target_id: string | null; detail: string | null; metadata: unknown
        created_at: number
      }>
      total: number
      actions: string[]
    }>(`/api/admin-v2/audit-log${qs ? `?${qs}` : ''}`)
  },

  /** Get recent notifications */
  notifications: () =>
    adminRequest<{
      notifications: Array<{
        type: 'new_email' | 'new_ticket' | 'ticket_reply'
        title: string; subtitle: string; id: string
      }>
      total: number
    }>('/api/admin-v2/notifications'),
  /** Dismiss a notification so it stops appearing in the bell. */
  dismissNotification: (type: string, id: string) =>
    adminRequest<{ ok: true }>('/api/admin-v2/notifications/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, id }),
    }),

  // ── Config ────────────────────────────────────────────────────────────

  /** OpenCode Go API token status (masked; never the full secret). */
  openCodeConfig: () =>
    adminRequest<OpenCodeConfigStatus>('/api/admin-v2/config/opencode'),
  saveOpenCodeApiKey: (apiKey: string) =>
    adminRequest<{ ok: true } & OpenCodeConfigStatus>('/api/admin-v2/config/opencode', {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),
  clearOpenCodeApiKey: () =>
    adminRequest<{ ok: true } & OpenCodeConfigStatus>('/api/admin-v2/config/opencode', {
      method: 'PUT',
      body: JSON.stringify({ clear: true }),
    }),
}

export interface InboxEmail {
  id: string
  resendEmailId: string | null
  fromEmail: string
  fromName: string
  toEmail: string
  subject: string
  bodyText: string
  bodyHtml: string | null
  receivedAt: number
  read: boolean
  archived: boolean
  replySentAt: number | null
}

// ── X Ideas ───────────────────────────────────────────────────────────

export interface XIdea {
  id: string
  source_url: string
  copy: string
  idea_date: string
  status: string
  posted_url: string
  created_at: number
  updated_at: number
}

export interface XIdeaInput {
  source_url?: string
  copy?: string
  idea_date?: string
  status?: string
  posted_url?: string
}
