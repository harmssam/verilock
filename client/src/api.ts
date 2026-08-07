import type {
  AttestationStatus,
  DocumentAnnotation,
  DocumentMetadata,
  SealDocument,
  VerifyResult,
} from './types'
import { loadGuestSession, loadSession } from './session'

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
      (data as { error?: string } | null)?.error ??
      (res.status === 404 ? 'Document not found' : `Request failed (${res.status})`)
    if (
      path.includes('prepare-lock') ||
      path.includes('begin-lock') ||
      path.includes('attestations') ||
      path.includes('/api/')
    ) {
      console.error('[verilock] api:error', { path, status: res.status, message, data })
    }
    const err = new Error(message) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data as T
}

/**
 * Also used for guest bearer tokens (`docs/guest-signing-plan.md`) - the header shape
 * is identical (`Bearer <token>`); the server tells wallet vs. guest apart by which
 * table (`sessions` vs `guest_sessions`) the token resolves against.
 */
export function withAuth(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/**
 * Convenience accessor for whichever session is currently active. Checks the guest
 * session first (shouldn't normally coexist with a wallet session, but guest takes
 * priority if it somehow does), then falls back to the wallet session. Returns
 * `undefined` when neither is present. Scaffolding for later tasks - existing call
 * sites are not rewired to use this yet.
 */
export function currentAuthHeader(): Record<string, string> | undefined {
  const guest = loadGuestSession()
  if (guest) return withAuth(guest.token)
  const wallet = loadSession()
  if (wallet) return withAuth(wallet.token)
  return undefined
}

/** Shared shape for on-chain data archive quote / SSE progress events. */
export interface OnChainDataQuote {
  documentId: string
  eligible: boolean
  reason?: string
  locked: boolean
  onChain: boolean
  frameCount: number
  credits: number
  framesPerCredit: number
  source: 'placements' | 'annotations' | null
  creditsCharged: number
  txHashes: string[]
  confirmedFrames: number
  balance: number | null
  broadcastReady: boolean
  creditsEnabled: boolean
  error?: string | null
  jobStatus: 'idle' | 'processing' | 'complete' | 'failed'
  alreadyPaid: boolean
  progressPercent: number
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
  /**
   * Optional PDF overlays (signature/text). Never include PDF file bytes -
   * only hash + annotations are accepted by the API.
   */
  annotations?: DocumentAnnotation[]
}

export interface SignDocumentBody {
  partyId: string
  signatureType: string
  clientSha256: string
  displayName?: string
  signatureImage?: string
  /** Raw personal invite token from email deep link (`?invite=`). */
  inviteToken?: string
}

/**
 * Guest create (`docs/guest-signing-plan.md` Task 3) - same shape as
 * `CreateDocumentBody` but no `creatorRole` (guest always creates the
 * creator party) and `creatorDisplayName` is required, not optional -
 * there is no wallet address to fall back to as a label.
 */
export interface CreateGuestDocumentBody {
  title: string
  originalFileName?: string
  type: string
  creatorDisplayName: string
  originalSha256: string
  pageCount: number
  metadata?: DocumentMetadata
  parties?: Array<{ role: string; displayName: string; required?: boolean }>
  requiredSignatures?: number
  creatorNotifyEmail?: string
  annotations?: DocumentAnnotation[]
  /** Omit when Turnstile is not wired in client-side (see DocumentJourney's createGuestDoc). */
  turnstileToken?: string
}

export interface CreateGuestDocumentResult {
  document: SealDocument
  /** Raw document key secret - shown ONCE. Never returned by the server again. */
  documentKey: string
  guestSession: { token: string; expiresAt: number }
  hashWarning?: string
}

export const api = {
  health: () => request<{ ok: boolean; app: string; chainVerify: boolean; storageMode?: string }>('/api/health'),

  /**
   * Challenge for wallet login.
   * - Omit `address` (Hub + Pay): pending session; bind wallet from public key on verify.
   *   Pay uses this so account-access + sign sheets stay consecutive (no fetch between).
   * - With `address` (legacy): session bound to that wallet up front.
   */
  challenge: (address?: string | null) =>
    request<{ token: string; nonce: string; address: string | null }>('/api/auth/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        address != null && String(address).trim() !== '' ? { address } : {},
      ),
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

  /** Desktop: start a Pay QR login room (3 min TTL). pollSecret never goes in the QR. */
  authQrStart: () =>
    request<{ id: string; pollSecret: string; expiresAt: number }>('/api/auth/qr/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),

  /**
   * Desktop: poll QR room with pollSecret. When status is `ready`, response includes
   * token+address once (room is consumed).
   */
  authQrStatus: (id: string, pollSecret: string) =>
    request<{
      status: 'pending' | 'ready' | 'expired' | 'consumed' | 'not_found'
      expiresAt?: number
      token?: string
      address?: string
    }>(`/api/auth/qr/${encodeURIComponent(id)}`, {
      headers: { 'X-VeriLock-Qr-Poll-Secret': pollSecret },
    }),

  /** Phone: after Pay verify, attach this session to the desktop QR room. */
  authQrComplete: (id: string, token: string) =>
    request<{ ok: true; address: string }>(`/api/auth/qr/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
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

  /**
   * Guest create - no `Authorization` header, no wallet involved.
   * `docs/guest-signing-plan.md` Task 3 / `POST /api/documents/guest`.
   */
  createGuestDocument: (body: CreateGuestDocumentBody) =>
    request<CreateGuestDocumentResult>('/api/documents/guest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** Construction placement plan (structure + roots). lock freezes geometry until unlock. */
  savePlacementPlan: (
    token: string,
    body: {
      originalSha256: string
      plan?: unknown
      documentId?: string
      lock?: boolean
      /** Re-open a locked plan as draft (only before fills/signatures). */
      unlock?: boolean
      planRoot?: string
      batch0FramesHex?: string[]
      batch0Root?: string
    },
  ) =>
    request<{
      originalSha256: string
      documentId: string | null
      creatorAddress: string
      status: 'draft' | 'locked'
      planRoot: string | null
      batch0Root: string | null
      slotCount: number
      personCount: number
      lockedAt: number | null
      plan: {
        pdfSha256: string
        people: Array<{ slotIndex: number; displayName: string; role?: string }>
        slots: unknown[]
        status: 'draft' | 'locked'
        planRoot?: string
        lockedAt?: number
        creatorSigningAs?: number | null
      } | null
      hasBatch0Frames: boolean
      batch0FrameCount: number
    }>('/api/placement-plans', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getPlacementPlan: (
    sha256: string,
    token?: string | null,
    opts?: { documentId?: string | null },
  ) => {
    const q =
      opts?.documentId && opts.documentId.trim()
        ? `?documentId=${encodeURIComponent(opts.documentId.trim())}`
        : ''
    return request<{
      originalSha256: string
      documentId?: string | null
      status: 'draft' | 'locked'
      planRoot: string | null
      batch0Root: string | null
      slotCount: number
      personCount: number
      lockedAt: number | null
      plan: {
        pdfSha256: string
        people: Array<{
          slotIndex: number
          displayName: string
          role?: string
          walletAddress?: string | null
        }>
        slots: Array<{
          id: string
          personSlotIndex: number
          kind: string
          pageIndex: number
          x: number
          y: number
          width: number
          height: number
          lockedContent?: {
            text?: string
            mark?: 'checkmark' | 'cross'
            fontSizeRatio?: number
            color?: string
          }
        }>
        status: 'draft' | 'locked'
        planRoot?: string
        lockedAt?: number
        creatorSigningAs?: number | null
      } | null
      hasBatch0Frames: boolean
      batch0FrameCount: number
      /** Present only for creator / parties - wire frames for reconstruction. */
      batch0FramesHex?: string[]
      fillBatchCount?: number
      lastBatchRoot?: string | null
      filledSlotIds?: string[]
      knownBlobIds?: string[]
      /** True when fill wire frames are included for this viewer. */
      fillPayloadRevealed?: boolean
      fillBatches?: Array<{
        batchIndex: number
        batchRoot: string
        prevRoot: string
        personSlotIndex: number
        signerAddress: string
        blobIds: string[]
        fills: Array<{ slotId: string; blobId: string; personSlotIndex: number }>
        createdAt: number
        frameCount: number
        /** Present only when fillPayloadRevealed. */
        framesHex?: string[]
      }>
    }>(`/api/placement-plans/${sha256.toLowerCase()}${q}`, {
      headers: token ? withAuth(token) : undefined,
    })
  },

  appendPlacementFill: (
    token: string,
    sha256: string,
    body: {
      personSlotIndex: number
      prevRoot: string
      batchRoot: string
      batchIndex: number
      framesHex?: string[]
      fills: Array<{ slotId: string; blobId: string; personSlotIndex: number }>
      blobIds: string[]
      /** Required when the same PDF is used on multiple agreements. */
      documentId?: string
    },
  ) =>
    request<{
      originalSha256: string
      status: 'draft' | 'locked'
      planRoot: string | null
      lastBatchRoot?: string | null
      filledSlotIds?: string[]
      knownBlobIds?: string[]
      fillBatchCount?: number
    }>(`/api/placement-plans/${sha256.toLowerCase()}/fills`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  features: () =>
    request<{
      emailNotifyUi: boolean
      emailNotifySendEnabled: boolean
      emailNotifyConfigured: boolean
      turnstileRequired?: boolean
      turnstileSiteKey?: string | null
      supportSendEnabled?: boolean
      /** Placement editor / plan APIs in DocumentJourney */
      pdfAnnotationUi?: boolean
      annotationStreamBroadcast?: boolean
      annotationStreamServiceWallet?: boolean
    }>('/api/features'),

  submitSupportContact: (body: {
    name: string
    email: string
    /** Issue category id (e.g. wallet_connect, other). */
    issue: string
    message: string
    /** Optional signed-in wallet - ops only, not shown on form. */
    walletAddress?: string | null
    /** Honeypot - leave empty. */
    website?: string
    formStartedAt: number
    turnstileToken?: string
  }) =>
    request<{ ok: boolean; ticketPublicId?: string }>('/api/support/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  setDocumentNotifyEmail: (token: string, docId: string, email: string | null) =>
    request<{ ok: boolean }>(`/api/documents/${docId}/notify-email`, {
      method: 'PATCH',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),

  /** Creator: send branded invite email (opaque personal link, no PDF). Requires Resend. */
  sendPartyInviteEmail: (
    token: string,
    docId: string,
    body: { partyId: string; to: string },
  ) =>
    request<{
      ok: boolean
      id: string
      to: string
      partyId: string
      inviteSentAt?: number
      /** Prior invite email rotated out (null if first send for this party). */
      previousEmail?: string | null
      previousLinksRevoked?: number
    }>(`/api/documents/${docId}/invite-email`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /**
   * Resolve opaque email invite token → document slug + party (no email, no token echo).
   * Revoked / replaced / redeemed tokens throw with status 410.
   */
  lookupInviteToken: (inviteToken: string) =>
    request<{ documentId: string; slug: string; partyId: string }>(
      `/api/invites/lookup?token=${encodeURIComponent(inviteToken)}`,
    ),

  /**
   * Creator (wallet or guest): mint a personal, link-only party invite - no email
   * required (`docs/guest-signing-plan.md` Task 5). Same rotation semantics as
   * `sendPartyInviteEmail`: minting a fresh link for a party invalidates any previous
   * link/email invite for that party.
   */
  mintPartyInvite: (token: string, docId: string, body: { partyId: string; email?: string }) =>
    request<{ inviteUrl: string; token: string; expiresAt: number }>(
      `/api/documents/${docId}/party-invites`,
      {
        method: 'POST',
        headers: { ...withAuth(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),

  /**
   * Redeem a personal party invite token into a guest signer session - no wallet,
   * no `Authorization` header (`docs/guest-signing-plan.md` Task 5). Does not consume
   * the invite (that only happens at actual sign time) - safe to call again if the
   * resulting guest session later expires.
   */
  redeemInviteAsGuest: (inviteToken: string) =>
    request<{ session: { token: string; expiresAt: number } }>('/api/auth/guest/redeem-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken }),
    }),

  /**
   * Redeem a guest creator's document key into a fresh guest creator session - the
   * "Enter document key" re-entry path for a new browser/device with no active guest
   * session (`docs/guest-signing-plan.md` Task 7 / API surface "Redeem document key").
   * No wallet, no `Authorization` header. Never consumes/rotates the key - safe to
   * call again from yet another device or after a prior session expired.
   */
  redeemDocumentKey: (body: { documentId?: string; slug?: string; documentKey: string; turnstileToken?: string }) =>
    request<{ session: { token: string; expiresAt: number } }>(
      '/api/auth/guest/redeem-document-key',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),

  /**
   * Wallet claim of a guest-owned agreement (`docs/guest-signing-plan.md` Task 6) - binds
   * `creatorAddress` to this wallet and flips `authMode` to `claimed`. Proof is either a
   * live guest creator session token for this document, or the document key typed in by
   * hand (new device / browser, or an expired session). Past guest signature rows are
   * unchanged - claim is ownership-only, never a signature rewrite.
   */
  claimDocument: (
    token: string,
    docId: string,
    body: { documentKey?: string; guestSessionToken?: string },
  ) =>
    request<{ document: SealDocument }>(`/api/documents/${docId}/claim`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** Creator share step: set total required signatures (1–10) and optional co-signer names. */
  configureCosigners: (
    token: string,
    docId: string,
    body: { requiredSignatures: number; coSignerNames?: string[] },
  ) =>
    request<{ document: SealDocument }>(`/api/documents/${docId}/cosigners`, {
      method: 'PATCH',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** Rebuild parties from construction people; creator may claim one slot or none. */
  configureSigningRoster: (
    token: string,
    docId: string,
    body: {
      parties: Array<{ displayName: string; role?: string; walletAddress?: string | null }>
      creatorSignsAsIndex: number | null
    },
  ) =>
    request<{ document: SealDocument }>(`/api/documents/${docId}/signing-roster`, {
      method: 'PUT',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  /**
   * Soft-archive / restore on this wallet’s agreements list only
   * (not on-chain data archive, not server purge).
   */
  setDocumentListArchived: (token: string, docId: string, archived: boolean) =>
    request<{ document: SealDocument }>(`/api/documents/${docId}/list-archive`, {
      method: 'PUT',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived }),
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

  nimPrices: () =>
    request<{
      usd: number
      eur: number
      cad: number
      lastUpdatedAt: number | null
      source: 'fastspot' | 'coingecko'
    }>('/api/nim-prices'),

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

  creditsConfig: () =>
    request<{
      enabled: boolean
      stripeEnabled: boolean
      stripeMarkup: number
      maxPerCheckout: number
      maxPerNimTopup: number
      packs: number[]
      stripeMinChargeCents: number
      creditsPerSeal: number
      /** Txs per credit for multi-tx data archive (ceil). Default 10. */
      framesPerDataArchiveCredit?: number
    }>('/api/credits/config'),

  /** Quote multi-tx on-chain data archive (signatures / initials / text). Creator only. */
  getOnChainDataQuote: (token: string, docId: string) =>
    request<OnChainDataQuote>(`/api/documents/${docId}/on-chain-data`, {
      headers: withAuth(token),
    }),

  /**
   * SSE stream of archive progress (one long-lived connection).
   * Prefer over polling: server pushes after each broadcast frame.
   * Uses fetch + Authorization (native EventSource cannot set headers).
   * Resolves when the job ends, the stream closes, or signal aborts.
   */
  streamOnChainDataProgress: async (
    token: string,
    docId: string,
    onProgress: (quote: OnChainDataQuote) => void,
    options?: { signal?: AbortSignal },
  ): Promise<'complete' | 'failed' | 'closed' | 'aborted'> => {
    const signal = options?.signal
    if (signal?.aborted) return 'aborted'

    const res = await fetch(`${API_BASE}/api/documents/${docId}/on-chain-data/stream`, {
      headers: {
        ...withAuth(token),
        Accept: 'text/event-stream',
      },
      signal,
    })
    if (!res.ok) {
      let message = `Request failed (${res.status})`
      try {
        const data = (await res.json()) as { error?: string }
        if (data?.error) message = data.error
      } catch {
        /* ignore */
      }
      const err = new Error(message) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    if (!res.body) {
      throw new Error('Archive progress stream unavailable')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let terminal: 'complete' | 'failed' | null = null

    const handleBlock = (block: string) => {
      let eventName = 'message'
      const dataLines: string[] = []
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart())
        }
      }
      if (dataLines.length === 0) return
      const raw = dataLines.join('\n')
      if (eventName === 'progress') {
        try {
          onProgress(JSON.parse(raw) as OnChainDataQuote)
        } catch {
          /* ignore malformed */
        }
        return
      }
      if (eventName === 'end') {
        try {
          const end = JSON.parse(raw) as { jobStatus?: string; onChain?: boolean }
          if (end.onChain || end.jobStatus === 'complete') terminal = 'complete'
          else if (end.jobStatus === 'failed') terminal = 'failed'
        } catch {
          /* ignore */
        }
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // Flush any trailing event that lacked a final blank line.
          buffer += decoder.decode()
          if (buffer.trim()) handleBlock(buffer)
          break
        }
        buffer += decoder.decode(value, { stream: true })
        // SSE events are separated by blank lines
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          if (block.trim()) handleBlock(block)
        }
        if (terminal) {
          try {
            await reader.cancel()
          } catch {
            /* ignore */
          }
          return terminal
        }
      }
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return 'aborted'
      }
      throw err
    }

    return terminal ?? 'closed'
  },

  /**
   * Start paid multi-tx archive (returns quickly; work continues in background).
   * Subscribe via streamOnChainDataProgress (SSE); fall back to getOnChainDataQuote poll.
   * alreadyPaid resumes are free. Optional notifyEmail on success.
   */
  archiveOnChainData: (
    token: string,
    docId: string,
    body?: { notifyEmail?: string | null },
  ) =>
    request<{
      documentId: string
      eligible: boolean
      reason?: string
      locked: boolean
      onChain: boolean
      frameCount: number
      credits: number
      framesPerCredit: number
      source: 'placements' | 'annotations' | null
      creditsCharged: number
      txHashes: string[]
      confirmedFrames: number
      balance: number
      broadcastReady: boolean
      creditsEnabled: boolean
      error?: string | null
      broadcastError?: string
      partialBroadcast?: boolean
      notifyEmailQueued?: boolean
      jobStatus: 'idle' | 'processing' | 'complete' | 'failed'
      alreadyPaid: boolean
      progressPercent: number
      accepted?: boolean
    }>(`/api/documents/${docId}/on-chain-data`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),

  /**
   * Recovery package for offline reconstruct (tx hashes + wire frames).
   * Creator only; download after Store forever pins frames.
   */
  getOnChainDataRecovery: (token: string, docId: string) =>
    request<{
      version: 1
      kind: 'verilock_data_archive_recovery'
      originalSha256: string
      documentId: string
      onChain: boolean
      frameCount: number
      txHashes: string[]
      framesHex: string[]
      source: 'placements' | 'annotations'
      serviceWalletAddress: string | null
      exportedAt: number
    }>(`/api/documents/${docId}/on-chain-data/recovery`, {
      headers: withAuth(token),
    }),

  /** Public: archive tx index for a PDF fingerprint (offline discovery). */
  getChainDataIndex: (sha256: string) =>
    request<{
      originalSha256: string
      found: boolean
      onChain: boolean
      frameCount: number
      confirmedFrames: number
      txHashes: string[]
      source: 'placements' | 'annotations' | null
      documentId: string | null
      serviceWalletAddress: string | null
      updatedAt: number | null
    }>(`/api/chain-data/${sha256.toLowerCase()}`),

  /**
   * Public reconstruct of on-chain data archive by PDF fingerprint.
   * auto = server index or Nimiq scan; scan = hash-only (8-byte association id).
   */
  reconstructChainData: (
    sha256: string,
    options?: { source?: 'auto' | 'wire' | 'chain' | 'scan' },
  ) => {
    const source = options?.source ?? 'auto'
    return request<{
      originalSha256: string
      source: 'wire' | 'chain' | 'scan'
      onChain: boolean
      frameCount: number
      txHashes: string[]
      integrityOk: boolean
      chainError?: string
      scanMeta?: {
        scannedTxs: number
        truncated: boolean
        streamCount: number
        scanAddresses: string[]
      }
      unpacked: {
        originalSha256: string
        source: string
        streams: Array<{ version: number; frameCount: number; pdfSha256: string }>
        placementBatches: unknown[]
        annotations: unknown[] | null
        manifest: {
          v: 3
          kind: 'archive_manifest'
          pdf: string
          pl?: string
          doc?: string
          title?: string
          people: Array<{ i: number; n: string; r?: string; w?: string }>
          sigs: Array<{
            i: number
            w: string
            n?: string
            at: number
            t?: string
            sha?: string
          }>
        } | null
      }
    }>(`/api/chain-data/${sha256.toLowerCase()}/reconstruct?source=${source}`)
  },

  creditsBalance: (token: string, options?: { syncStripe?: boolean }) =>
    request<{
      walletAddress: string
      balance: number
      flagged: boolean
      enabled: boolean
      stripeEnabled: boolean
      stripeMarkup: number
      maxPerCheckout: number
      maxPerNimTopup: number
      packs: number[]
      stripeMinChargeCents: number
      creditsPerSeal: number
      stripeSynced?: { mintedTotal: number }
    }>(`/api/credits/balance${options?.syncStripe ? '?syncStripe=1' : ''}`, {
      headers: withAuth(token),
    }),

  creditsQuote: (credits = 10) =>
    request<{
      credits: number
      feeNim: number
      feeLuna: number
      promoActive: boolean
      creditNimCost: number
      creditNimCostTotal: number
      nimUsd: number
      stripeMarkup: number
      creditStripeUsd: number
      creditStripeUsdTotal: number
      unitUsdCents: number
      totalUsdCents: number
      meetsStripeMinimum: boolean
      stripeMinChargeCents: number
      isPack: boolean
      stripeEnabled: boolean
      pricesStale: boolean
    }>(`/api/credits/quote?credits=${encodeURIComponent(String(credits))}`),

  creditsPackQuotes: () =>
    request<{
      packs: Array<{
        pack: number
        credits: number
        creditNimCostTotal: number
        /** Unit (1 credit) Stripe USD at live NIM rate, before pack floor. */
        creditStripeUsd?: number
        creditStripeUsdTotal: number
        totalUsdCents: number
        meetsStripeMinimum: boolean
        stripeEnabled: boolean
      }>
      stripeMinChargeCents: number
      stripeMarkup: number
      feeNim: number
      promoActive: boolean
    }>('/api/credits/quote?packs=1'),

  creditsLedger: (token: string, limit = 50) =>
    request<{
      entries: Array<{
        id: string
        delta: number
        balanceAfter: number
        kind: string
        createdAt: number
      }>
    }>(`/api/credits/ledger?limit=${limit}`, { headers: withAuth(token) }),

  creditsTopupInfo: () =>
    request<{
      payloadHex: string
      recipient: string | null
      feeNim: number
      feeLuna: number
    }>('/api/credits/topup-payload'),

  claimNimTopup: (token: string, txHash: string) =>
    request<{
      balance: number
      creditsMinted: number
      alreadyClaimed: boolean
      feeNim: number
    }>('/api/credits/topups/nim', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash }),
    }),

  creditsCheckout: (token: string, credits: number) =>
    request<{
      url: string
      sessionId: string
      quote: {
        creditStripeUsdTotal: number
        totalUsdCents: number
        stripeMarkup: number
      }
    }>('/api/credits/checkout', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ credits }),
    }),

  /** Fulfill Stripe Checkout after redirect (or recover if webhook missed). */
  confirmCreditsCheckout: (token: string, sessionId: string) =>
    request<{
      balance: number
      creditsMinted: number
      alreadyClaimed: boolean
      paid: boolean
      sessionId: string
    }>('/api/credits/checkout/confirm', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }),

  /** Public info for the /redeem page. */
  redeemInfo: () =>
    request<{
      enabled: boolean
      defaultCredits: number
      creditsPerSeal: number
    }>('/api/credits/redeem-info'),

  /** Redeem a one-time AppSumo / promo code onto the verified wallet. */
  redeemCode: (token: string, code: string) =>
    request<{
      balance: number
      creditsMinted: number
      alreadyClaimed: boolean
      campaign: string
    }>('/api/credits/redeem', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    }),

  payWithCredit: (token: string, docId: string, finalSha256?: string) =>
    request<
      AttestationStatus & {
        balance: number
      }
    >(`/api/documents/${docId}/pay-with-credit`, {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(finalSha256 ? { finalSha256 } : {}),
    }),
}