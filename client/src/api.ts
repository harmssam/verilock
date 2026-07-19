import type {
  AttestationStatus,
  DocumentAnnotation,
  DocumentMetadata,
  SealDocument,
  VerifyResult,
} from './types'

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
  /**
   * Optional PDF overlays (signature/text). Never include PDF file bytes —
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

  getPlacementPlan: (sha256: string) =>
    request<{
      originalSha256: string
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
      fillBatchCount?: number
      lastBatchRoot?: string | null
      filledSlotIds?: string[]
      knownBlobIds?: string[]
    }>(`/api/placement-plans/${sha256.toLowerCase()}`),

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

  /** Experiment: pack annotations into 64B frames, index by PDF hash, optional on-chain broadcast. */
  publishAnnotationStream: (
    token: string,
    body: { originalSha256: string; annotations: unknown[]; broadcast?: boolean },
  ) =>
    request<{
      originalSha256: string
      frameCount: number
      payloadBytes: number
      framesHex: string[]
      txHashes: string[]
      onChain: boolean
      confirmedFrames: number
      annotations: unknown[]
      creatorAddress: string
      broadcastError?: string
      partialBroadcast?: boolean
      serviceWalletConfigured?: boolean
      broadcastEnabled?: boolean
    }>('/api/annotation-streams', {
      method: 'POST',
      headers: { ...withAuth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  getAnnotationStream: (sha256: string) =>
    request<{
      originalSha256: string
      creatorAddress?: string
      frameCount: number
      payloadBytes: number
      annotationCount: number
      txHashes: string[]
      onChain: boolean
      confirmedFrames?: number
      annotations: unknown[]
      serviceWalletConfigured?: boolean
      broadcastEnabled?: boolean
    }>(`/api/annotation-streams/${sha256.toLowerCase()}`),

  reconstructAnnotationStream: (sha256: string, opts?: { fallback?: 'index' | 'none' }) => {
    const q = opts?.fallback === 'none' ? '?fallback=none' : ''
    return request<{
      originalSha256: string
      annotations: unknown[]
      /** wire = packed frames from DB (same bytes as broadcast); chain = full RPC re-read */
      source: 'index' | 'chain' | 'wire'
      frameCount: number
      txHashes: string[]
      onChain: boolean
      confirmedFrames?: number
      chainError?: string
      chainSampleOk?: boolean
      integrityOk?: boolean
    }>(`/api/annotation-streams/${sha256.toLowerCase()}/reconstruct${q}`)
  },

  features: () =>
    request<{
      emailNotifyUi: boolean
      emailNotifySendEnabled: boolean
      emailNotifyConfigured: boolean
      turnstileRequired?: boolean
      turnstileSiteKey?: string | null
      supportSendEnabled?: boolean
      /** PDF lab (/pdf) — parallel to seal product path */
      pdfAnnotationUi?: boolean
      annotationStreamBroadcast?: boolean
      annotationStreamServiceWallet?: boolean
    }>('/api/features'),

  submitSupportContact: (body: {
    name: string
    email: string
    subject: string
    message: string
    /** Honeypot — leave empty. */
    website?: string
    formStartedAt: number
    turnstileToken?: string
  }) =>
    request<{ ok: boolean }>('/api/support/contact', {
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

  /** Creator: send branded invite email (personal link, no PDF). Requires Resend enabled. */
  sendPartyInviteEmail: (
    token: string,
    docId: string,
    body: { partyId: string; to: string },
  ) =>
    request<{ ok: boolean; id: string; to: string; partyId: string }>(
      `/api/documents/${docId}/invite-email`,
      {
        method: 'POST',
        headers: { ...withAuth(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    ),

  /** Creator share step: set total required signatures (1–4) and optional co-signer names. */
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
    }>('/api/credits/config'),

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