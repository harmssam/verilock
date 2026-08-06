import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { v4 as uuid } from 'uuid'
import {
  assignPartyWallet,
  claimDocumentToWallet as dbClaimDocumentToWallet,
  deleteDocumentById,
  findDocumentsByHash,
  getDocumentById,
  getDocumentBySlug,
  getDocumentDataArchive,
  getDocumentListArchivedAt,
  getDocumentListArchivedMap,
  getGuestSession,
  getPartiesForDocument,
  getPartyById,
  getSignaturesForDocument,
  getSignatureImageIdsForDocument,
  getAttestationForDocument,
  insertDocument,
  insertParty,
  insertSignature,
  insertSignatureImage,
  listDocumentsForAddress,
  claimPartyWalletIfOpen,
  isUniqueConstraintError,
  runInTransaction,
  setDocumentListArchived,
  updatePartyDisplayName,
  markPartySigned,
  markPartyUnsigned,
  setDocumentFinalSha256,
  setDocumentNotifyEmail,
  updateDocumentStatus,
  updateDocumentRequiredSignatures,
  deletePartyById,
  getActiveInviteForParty,
  getPartyInviteByTokenHash,
  insertPartyInvite,
  markPartyInviteRedeemed,
  revokeActivePartyInvites,
  type DocumentRecord,
  type PartyInviteRecord,
  type PartyRecord,
} from './db.js'
import { buildNimiqExplorerUrl } from './explorer.js'
import { documentDeepLink } from './email/resend.js'
import { buildAttestationPayload } from './nimiq-rpc.js'
import { normalizeAddress, shortAddress } from './addresses.js'
import {
  guestCreatorSubject,
  guestPartySubject,
  hashGuestSecret,
  mintGuestSecretRaw,
} from './guestIdentity.js'
import {
  sanitizeAnnotations,
  sanitizeDisplayName,
  sanitizeDocumentMetadata,
  sanitizeDocumentType,
  sanitizeFilename,
  sanitizeTitle,
} from './security.js'
import { hashSignatureImage } from './signature-image.js'
import { getSealPricing } from './sealPricing.js'
import { dataArchiveSummaryForDocument } from './documentDataArchive.js'

function slugFromId(id: string): string {
  return id.replace(/-/g, '').slice(0, 12)
}

export function assertDocumentCreator(documentId: string, requesterAddress: string): DocumentRecord {
  const doc = getDocumentById(documentId)
  if (!doc) throw new Error('Document not found')
  if (normalizeAddress(doc.creatorAddress) !== normalizeAddress(requesterAddress)) {
    throw new Error('Only the creator can seal this agreement')
  }
  return doc
}

export function assertSealBroadcastAllowed(documentId: string, requesterAddress: string): DocumentRecord {
  const doc = assertDocumentCreator(documentId, requesterAddress)
  if (!doc.finalSha256) throw new Error('Document not prepared for lock')
  if (doc.status !== 'ready_to_lock' && doc.status !== 'locking') {
    throw new Error('Document is not in seal flow')
  }
  return doc
}

const MIN_REQUIRED_SIGNATURES = 0
const MAX_REQUIRED_SIGNATURES = 10

function clampRequiredSignatures(value: number | undefined, fallback: number): number {
  const parsed = Number.isFinite(value) ? Math.floor(value!) : fallback
  return Math.max(MIN_REQUIRED_SIGNATURES, Math.min(MAX_REQUIRED_SIGNATURES, parsed))
}

const PLACEHOLDER_PARTY_NAMES = new Set([
  'invited signer',
  'invited tenant',
  'invited landlord',
  'signer',
  'tenant',
  'landlord',
])

/** Matches "Invited signer", "Invited tenant 2", etc. */
const PLACEHOLDER_PARTY_NAME_RE =
  /^(invited\s+)?(signer|tenant|landlord)(\s+\d+)?$/i

function isPlaceholderPartyName(name: string): boolean {
  const trimmed = name.trim().toLowerCase()
  return (
    !trimmed ||
    PLACEHOLDER_PARTY_NAMES.has(trimmed) ||
    PLACEHOLDER_PARTY_NAME_RE.test(trimmed)
  )
}

function looksLikeAddressLabel(name: string): boolean {
  return /^NQ[1-9A-HJ-NP-Z]{2,}…[1-9A-HJ-NP-Z]{4}$/i.test(name.trim())
}

function partyNeedsDisplayName(party: PartyRecord): boolean {
  if (party.role === 'creator') return true
  return isPlaceholderPartyName(party.displayName) || looksLikeAddressLabel(party.displayName)
}

function resolveCreatorRole(type: string, role?: string): string {
  if (type === 'rental') {
    if (role === 'landlord' || role === 'tenant') return role
    return 'landlord'
  }
  return 'signer'
}

function resolveOtherRole(type: string, creatorRole: string): string {
  if (type === 'rental') {
    return creatorRole === 'landlord' ? 'tenant' : 'landlord'
  }
  return 'signer'
}

function defaultOtherDisplayName(role: string, index: number, total: number): string {
  if (role === 'tenant') {
    return total === 1 ? 'Invited tenant' : `Invited tenant ${index + 1}`
  }
  if (role === 'landlord') {
    return total === 1 ? 'Invited landlord' : `Invited landlord ${index + 1}`
  }
  return total === 1 ? 'Invited signer' : `Invited signer ${index + 1}`
}

function resolveRequiredSignatureCount(doc: DocumentRecord, parties: PartyRecord[]): number {
  if (doc.requiredSignatures > 0) return doc.requiredSignatures
  return parties.filter(p => p.required).length
}

/**
 * Count required parties that have a real signature row.
 * Party status alone is not enough - status can drift without a signature record.
 */
function countSignedRequiredParties(
  parties: PartyRecord[],
  signatures: Array<{ partyId: string }>,
): number {
  const signedPartyIds = new Set(signatures.map(sig => sig.partyId))
  return parties.filter(p => p.required && signedPartyIds.has(p.id)).length
}

function signaturesComplete(
  doc: DocumentRecord,
  parties: PartyRecord[],
  signatures: Array<{ partyId: string }>,
): boolean {
  const requiredCount = resolveRequiredSignatureCount(doc, parties)
  if (requiredCount === 0) return true
  // Need enough signature records overall and enough required parties covered.
  if (signatures.length < requiredCount) return false
  return countSignedRequiredParties(parties, signatures) >= requiredCount
}

function signatureImageUrl(documentId: string, signatureId: string): string {
  return `/api/documents/${documentId}/signatures/${signatureId}/image`
}

export interface PublicDocumentOptions {
  /**
   * When set and matches creator or any party/signer wallet, reveal full participant
   * PII (all display names, invite emails, signature image URLs).
   * Open name-only claim slots still expose display names to everyone — needed for
   * the invitee “Who are you?” picker. Anonymous / unrelated wallets otherwise get
   * redacted emails and ink.
   */
  viewerAddress?: string | null
  /**
   * Viewer-scoped soft archive timestamp (hide from Inbox / Completed).
   * Pass from a batch map on list endpoints; omit to look up when viewer is set.
   */
  listArchivedAt?: number | null
}

/**
 * True if viewer may see full participant details (all names, invite emails, ink images).
 * Open unclaimed party labels are still returned on the public document for claim UX
 * even when this is false — see publicDocument parties mapping.
 */
export function canRevealParticipantDetails(
  doc: Pick<DocumentRecord, 'creatorAddress'>,
  parties: Array<Pick<PartyRecord, 'walletAddress'>>,
  signatures: Array<{ signerAddress: string }>,
  viewerAddress: string | null | undefined,
): boolean {
  if (!viewerAddress) return false
  const me = normalizeAddress(viewerAddress)
  if (normalizeAddress(doc.creatorAddress) === me) return true
  if (parties.some(p => p.walletAddress && normalizeAddress(p.walletAddress) === me)) return true
  if (signatures.some(s => normalizeAddress(s.signerAddress) === me)) return true
  return false
}

export function publicDocument(doc: DocumentRecord, options?: PublicDocumentOptions) {
  reconcileDocumentParties(doc.id)
  // Re-read after reconcile may repair party status / document status.
  const freshDoc = getDocumentById(doc.id) ?? doc
  const parties = getPartiesForDocument(doc.id)
  const signatures = getSignaturesForDocument(doc.id)
  const signatureImageIds = getSignatureImageIdsForDocument(doc.id)
  const attestation = getAttestationForDocument(doc.id)
  const signedRequired = countSignedRequiredParties(parties, signatures)
  const requiredCount = resolveRequiredSignatureCount(freshDoc, parties)
  const revealPrivate = canRevealParticipantDetails(
    freshDoc,
    parties,
    signatures,
    options?.viewerAddress,
  )

  let listArchivedAt: number | null = null
  if (options?.viewerAddress && revealPrivate) {
    if (options.listArchivedAt !== undefined) {
      listArchivedAt =
        typeof options.listArchivedAt === 'number' && options.listArchivedAt > 0
          ? options.listArchivedAt
          : null
    } else {
      listArchivedAt = getDocumentListArchivedAt(options.viewerAddress, freshDoc.id)
    }
  }

  return {
    id: freshDoc.id,
    slug: freshDoc.slug,
    title: freshDoc.title,
    originalFilename: freshDoc.originalFilename,
    type: freshDoc.type,
    status: freshDoc.status,
    creatorAddress: freshDoc.creatorAddress,
    /** `wallet` | `guest` | `claimed` - see `docs/guest-signing-plan.md`. */
    authMode: freshDoc.authMode,
    originalSha256: freshDoc.originalSha256,
    finalSha256: freshDoc.finalSha256,
    pageCount: freshDoc.pageCount,
    metadata: freshDoc.metadata,
    /** PDF overlay annotations (null when none / legacy documents). */
    annotations: freshDoc.annotations,
    /**
     * Optional upsell: multi-tx on-chain storage of signatures / fields.
     * Creator-only (null for other viewers).
     */
    dataArchive:
      options?.viewerAddress &&
      normalizeAddress(freshDoc.creatorAddress) === normalizeAddress(options.viewerAddress)
        ? dataArchiveSummaryForDocument(freshDoc.id)
        : null,
    /**
     * Viewer-scoped soft archive (hide from default agreements list).
     * Null/omitted when not a participant or not archived. Not on-chain data archive.
     */
    listArchivedAt,
    createdAt: freshDoc.createdAt,
    lockedAt: freshDoc.lockedAt,
    requiredSignatures: requiredCount,
    /** Whether names + signature images are included for this viewer. */
    participantDetailsRevealed: revealPrivate,
    parties: parties.map(party => {
      const base = publicParty(party, revealPrivate)
      const hasSignature = signatures.some(sig => sig.partyId === party.id)
      /**
       * Open name-only slots (pending, no wallet bound yet) are the claim identity for
       * invitees (“Who are you?”). Surface those labels even when the viewer is not yet a
       * participant — otherwise the picker falls back to role labels like “signer”.
       * Invite emails and signature ink stay redacted via revealPrivate.
       */
      const isOpenClaimSlot =
        party.required &&
        !hasSignature &&
        party.status !== 'declined' &&
        !party.walletAddress
      return {
        ...base,
        // Never report signed without a signature row (defense in depth after reconcile).
        status: hasSignature ? ('signed' as const) : party.status === 'declined' ? party.status : ('pending' as const),
        signedAt: hasSignature ? party.signedAt : null,
        displayName:
          revealPrivate || isOpenClaimSlot ? base.displayName : null,
      }
    }),
    signatures: signatures.map(sig => ({
      id: sig.id,
      partyId: sig.partyId,
      signerAddress: sig.signerAddress,
      signatureType: sig.signatureType,
      signedAt: sig.signedAt,
      // Ink images are only for creator / signees - not public share links.
      imageUrl:
        revealPrivate && signatureImageIds.has(sig.id)
          ? signatureImageUrl(doc.id, sig.id)
          : null,
      hasImage: signatureImageIds.has(sig.id),
      invitedAsEmail: revealPrivate ? sig.invitedAsEmail : null,
      // `wallet` | `guest` - not privacy-sensitive (unlike names/ink), exposed
      // unconditionally so certificates/public views honestly label auth method.
      authMethod: sig.authMethod,
    })),
    signingProgress: {
      signed: signedRequired,
      required: requiredCount,
      readyToLock:
        signaturesComplete(freshDoc, parties, signatures) && freshDoc.status !== 'locked',
    },
    attestation: attestation
      ? {
          txHash: attestation.txHash,
          status: attestation.status,
          blockNumber: attestation.blockNumber,
          payload: attestation.payload,
          explorerUrl: buildNimiqExplorerUrl(attestation.txHash),
        }
      : null,
    shareUrl: `/d/${doc.slug}`,
    verifyUrl: `/v/${doc.slug}`,
  }
}

function reconcileDocumentParties(documentId: string): void {
  const doc = getDocumentById(documentId)
  if (!doc) return
  // Never rewrite party/signature state after the seal is final.
  if (doc.status === 'locked') return

  const parties = getPartiesForDocument(documentId)
  const signatures = getSignaturesForDocument(documentId)
  const signedPartyIds = new Set(signatures.map(sig => sig.partyId))

  for (const party of parties) {
    const hasSig = signedPartyIds.has(party.id)
    if (party.status === 'pending' && hasSig) {
      markPartySigned(party.id)
    } else if (party.status === 'signed' && !hasSig) {
      // Orphan "signed" status without a signature row - treat as still pending.
      markPartyUnsigned(party.id)
    }
  }

  const refreshed = getPartiesForDocument(documentId)
  const refreshedDoc = getDocumentById(documentId)!
  if (signaturesComplete(refreshedDoc, refreshed, signatures)) {
    if (refreshedDoc.status === 'collecting_signatures' || refreshedDoc.status === 'draft') {
      updateDocumentStatus(documentId, 'ready_to_lock')
    }
  } else if (refreshedDoc.status === 'ready_to_lock') {
    // Incomplete collection must not stay sealable (e.g. status drift / bad data).
    updateDocumentStatus(documentId, 'collecting_signatures')
  }
}

function publicParty(party: PartyRecord, revealPrivate: boolean) {
  return {
    id: party.id,
    role: party.role,
    displayName: party.displayName,
    walletAddress: party.walletAddress,
    required: party.required,
    status: party.status,
    signedAt: party.signedAt,
    // Invite recipient is PII - only for creator / participants.
    inviteEmail: revealPrivate ? party.inviteEmail : null,
    inviteSentAt: revealPrivate ? party.inviteSentAt : null,
  }
}

export function createDocument(input: {
  title: string
  originalFileName?: string
  type: string
  creatorAddress: string
  creatorRole?: string
  creatorDisplayName?: string
  originalSha256: string
  pageCount: number
  metadata?: Record<string, unknown>
  requiredSignatures?: number
  parties?: Array<{ role: string; displayName: string; walletAddress?: string; required?: boolean }>
  /** Optional; stored for ready-to-seal email (never returned in public document). */
  creatorNotifyEmail?: string | null
  /**
   * Optional client PDF annotations (normalized geometry + signature/text).
   * Never includes PDF file bytes - only overlay data for reconstruction.
   */
  annotations?: unknown
}) {
  const id = uuid()
  const slug = slugFromId(id)
  const now = Date.now()
  const type = sanitizeDocumentType(input.type)
  const creatorRole = resolveCreatorRole(type, input.creatorRole)
  const otherRole = resolveOtherRole(type, creatorRole)
  const requiredSignatures = clampRequiredSignatures(input.requiredSignatures, 2)
  const metadata = sanitizeDocumentMetadata(type, input.metadata)
  const annotations = sanitizeAnnotations(input.annotations)

  const isDirectSeal = requiredSignatures === 0
  const organizerLabel = sanitizeDisplayName(
    input.creatorDisplayName?.trim() || shortAddress(input.creatorAddress),
    shortAddress(input.creatorAddress),
  )
  const doc: DocumentRecord = {
    id,
    slug,
    title: sanitizeTitle(input.title),
    originalFilename: sanitizeFilename(input.originalFileName),
    type,
    status: isDirectSeal ? 'ready_to_lock' : 'collecting_signatures',
    creatorAddress: normalizeAddress(input.creatorAddress),
    originalSha256: input.originalSha256.toLowerCase(),
    finalSha256: null,
    pageCount: Math.max(1, input.pageCount),
    metadata,
    annotations,
    requiredSignatures,
    createdAt: now,
    lockedAt: null,
    creatorNotifyEmail: input.creatorNotifyEmail ?? null,
    readyToSealEmailSentAt: null,
    // Survives roster rebuild - invite emails always know who organized.
    creatorDisplayName: isDirectSeal ? null : organizerLabel,
    // Wallet-native create path (guest creation is a separate function - see guest-signing-plan.md).
    authMode: 'wallet',
    creatorDocumentKeyHash: null,
    creatorDocumentKeyCreatedAt: null,
    claimedAt: null,
    claimedFromGuest: false,
  }
  insertDocument(doc)

  // For direct seal (0 signatures), we skip parties entirely - creator seals directly.
  if (!isDirectSeal) {
    const creatorParty: PartyRecord = {
      id: uuid(),
      documentId: id,
      role: creatorRole,
      displayName: organizerLabel,
      walletAddress: normalizeAddress(input.creatorAddress),
      sortOrder: 0,
      required: true,
      status: 'pending',
      signedAt: null,
      inviteEmail: null,
      inviteSentAt: null,
    }
    insertParty(creatorParty)
  }

  const priorMatches = findDocumentsByHash(doc.originalSha256).filter(existing => existing.id !== id)
  const hashWarning =
    priorMatches.length > 0
      ? `${priorMatches.length} other agreement(s) already use this PDF fingerprint. The same file always matches the same records, so a shared template can show multiple agreements when verified. Edit the document if you want this one unique.`
      : undefined

  if (!isDirectSeal) {
    const extraPartyCount = Math.max(0, requiredSignatures - 1)
    const providedParties = input.parties ?? []

    for (let index = 0; index < extraPartyCount; index++) {
      const provided = providedParties[index]
      const fallbackName = defaultOtherDisplayName(otherRole, index, extraPartyCount)
      const providedName = provided?.displayName?.trim()
      insertParty({
        id: uuid(),
        documentId: id,
        role: provided?.role || otherRole,
        displayName: providedName
          ? sanitizeDisplayName(providedName, fallbackName)
          : fallbackName,
        walletAddress: provided?.walletAddress ? normalizeAddress(provided.walletAddress) : null,
        sortOrder: index + 1,
        required: true,
        status: 'pending',
        signedAt: null,
        inviteEmail: null,
        inviteSentAt: null,
      })
    }
  }

  return {
    document: publicDocument(doc, { viewerAddress: input.creatorAddress }),
    hashWarning,
  }
}

/**
 * Guest-native sibling of `createDocument` - no Nimiq wallet involved.
 *
 * Differences from the wallet path:
 * - `creatorAddress` is the guest sentinel `guest:doc:{id}` (`guestCreatorSubject`),
 *   never a real wallet address.
 * - The creator party always gets `walletAddress: null` - unlike `createDocument`,
 *   which binds the creator's own wallet to their party immediately, a guest
 *   creator has no wallet to bind. It only ever gets one via a later claim
 *   (out of scope here - see `docs/guest-signing-plan.md` Task 6).
 * - Direct seal (0 required signatures) is rejected - guest agreements are always
 *   multi-party free-sign; 0-signature stays wallet-only (locked decision #4).
 * - A display name is required up front (no `shortAddress()` fallback - that
 *   produces a garbled label for a guest sentinel string).
 * - Mints a one-time **document key** (`documentKey` in the return value). This is
 *   the ONLY place the raw secret ever exists - the caller (route) must return it
 *   to the client once and never log or persist it anywhere except as
 *   `creatorDocumentKeyHash` in the DB (already handled below).
 */
export function createGuestDocument(input: {
  title: string
  originalFileName?: string
  type: string
  creatorDisplayName?: string
  originalSha256: string
  pageCount: number
  metadata?: Record<string, unknown>
  requiredSignatures?: number
  parties?: Array<{ role: string; displayName: string; required?: boolean }>
  /** Optional; stored for ready-to-seal email (never returned in public document). */
  creatorNotifyEmail?: string | null
  /**
   * Optional client PDF annotations (normalized geometry + signature/text).
   * Never includes PDF file bytes - only overlay data for reconstruction.
   */
  annotations?: unknown
}): {
  document: ReturnType<typeof publicDocument>
  hashWarning?: string
  /** Raw document key - shown once, caller (route) returns it in the response and never logs/persists it raw. */
  documentKey: string
} {
  const requiredSignatures = clampRequiredSignatures(input.requiredSignatures, 2)
  if (requiredSignatures === 0) {
    throw new Error('Guest agreements must have at least one required signature')
  }
  if (!input.creatorDisplayName?.trim()) {
    throw new Error('Your name is required')
  }

  const id = uuid()
  const slug = slugFromId(id)
  const now = Date.now()
  const type = sanitizeDocumentType(input.type)
  const creatorRole = resolveCreatorRole(type, undefined)
  const otherRole = resolveOtherRole(type, creatorRole)
  const metadata = sanitizeDocumentMetadata(type, input.metadata)
  const annotations = sanitizeAnnotations(input.annotations)

  const organizerLabel = sanitizeDisplayName(input.creatorDisplayName.trim(), 'Organizer')
  const creatorAddress = normalizeAddress(guestCreatorSubject(id))

  const documentKeyRaw = mintGuestSecretRaw()
  const creatorDocumentKeyHash = hashGuestSecret(documentKeyRaw)

  const doc: DocumentRecord = {
    id,
    slug,
    title: sanitizeTitle(input.title),
    originalFilename: sanitizeFilename(input.originalFileName),
    type,
    status: 'collecting_signatures',
    creatorAddress,
    originalSha256: input.originalSha256.toLowerCase(),
    finalSha256: null,
    pageCount: Math.max(1, input.pageCount),
    metadata,
    annotations,
    requiredSignatures,
    createdAt: now,
    lockedAt: null,
    creatorNotifyEmail: input.creatorNotifyEmail ?? null,
    readyToSealEmailSentAt: null,
    // Guest agreements are never direct-seal (rejected above) - always set.
    creatorDisplayName: organizerLabel,
    authMode: 'guest',
    creatorDocumentKeyHash,
    creatorDocumentKeyCreatedAt: now,
    claimedAt: null,
    claimedFromGuest: false,
  }
  insertDocument(doc)

  const creatorParty: PartyRecord = {
    id: uuid(),
    documentId: id,
    role: creatorRole,
    displayName: organizerLabel,
    // No wallet to bind for a guest creator - only a later claim can set this.
    walletAddress: null,
    sortOrder: 0,
    required: true,
    status: 'pending',
    signedAt: null,
    inviteEmail: null,
    inviteSentAt: null,
  }
  insertParty(creatorParty)

  const priorMatches = findDocumentsByHash(doc.originalSha256).filter(existing => existing.id !== id)
  const hashWarning =
    priorMatches.length > 0
      ? `${priorMatches.length} other agreement(s) already use this PDF fingerprint. The same file always matches the same records, so a shared template can show multiple agreements when verified. Edit the document if you want this one unique.`
      : undefined

  const extraPartyCount = Math.max(0, requiredSignatures - 1)
  const providedParties = input.parties ?? []

  for (let index = 0; index < extraPartyCount; index++) {
    const provided = providedParties[index]
    const fallbackName = defaultOtherDisplayName(otherRole, index, extraPartyCount)
    const providedName = provided?.displayName?.trim()
    insertParty({
      id: uuid(),
      documentId: id,
      role: provided?.role || otherRole,
      displayName: providedName
        ? sanitizeDisplayName(providedName, fallbackName)
        : fallbackName,
      // Guest co-signer parties never start with a wallet - self-bind on claim/sign.
      walletAddress: null,
      sortOrder: index + 1,
      required: true,
      status: 'pending',
      signedAt: null,
      inviteEmail: null,
      inviteSentAt: null,
    })
  }

  return {
    document: publicDocument(doc, { viewerAddress: guestCreatorSubject(id) }),
    hashWarning,
    documentKey: documentKeyRaw,
  }
}

/**
 * Wallet claim bridge (`docs/guest-signing-plan.md` Task 6 "Claim ownership").
 *
 * Named `claimGuestDocumentToWallet` here (distinct from `db.ts`'s
 * `claimDocumentToWallet`, imported above as `dbClaimDocumentToWallet`) to avoid a
 * same-name collision across modules despite the plan using the same name for both
 * the DB-layer and domain-layer functions.
 *
 * ONE-SHOT: the real race guard is `dbClaimDocumentToWallet`'s
 * `WHERE auth_mode = 'guest'` UPDATE - this function's own `authMode` re-check
 * inside the transaction is defense in depth, not the source of truth.
 *
 * Existing guest SIGNATURE rows are never rewritten - `authMethod` stays `'guest'`
 * forever on those rows (the plan's core design promise: past guest signatures stay
 * guest-attributed even after claim).
 *
 * Existing PARTY INVITES and any already-redeemed co-signer `guest_sessions` rows
 * continue to work completely unchanged after claim - nothing here touches
 * `party_invites` or other parties' `guest_sessions` rows. See the plan's "Ugly
 * states" note: "Mid-flight claim -> co-signers still guest-invite".
 */
export function claimGuestDocumentToWallet(input: {
  documentId: string
  walletAddress: string
  /** Raw document key - one of this or guestSessionToken must prove creator ownership. */
  documentKey?: string | null
  /** Raw guest bearer token for a live creator session on this exact doc - alternative proof. */
  guestSessionToken?: string | null
}): ReturnType<typeof publicDocument> {
  const doc = getDocumentById(input.documentId)
  if (!doc) throw new Error('Document not found')

  if (doc.authMode === 'wallet') {
    throw new Error('This agreement was created with a wallet and cannot be claimed')
  }
  if (doc.authMode === 'claimed') {
    throw new Error('This agreement has already been claimed')
  }

  // Prove creator ownership - guestSessionToken checked first (more specific/current
  // signal) when both are somehow provided.
  if (input.guestSessionToken) {
    const session = getGuestSession(input.guestSessionToken)
    if (!session || session.role !== 'creator' || session.documentId !== doc.id) {
      throw new Error(
        'Your session for this agreement is no longer valid - enter your document key instead',
      )
    }
  } else if (input.documentKey) {
    if (!doc.creatorDocumentKeyHash) {
      throw new Error('This document has no active document key')
    }
    const providedHash = Buffer.from(hashGuestSecret(input.documentKey), 'hex')
    const storedHash = Buffer.from(doc.creatorDocumentKeyHash, 'hex')
    if (
      providedHash.length !== storedHash.length ||
      !timingSafeEqual(providedHash, storedHash)
    ) {
      throw new Error('Incorrect document key')
    }
  } else {
    throw new Error('Provide your document key or claim from the browser where you created this agreement')
  }

  runInTransaction(() => {
    // Defense against a race that already flipped authMode between the check above
    // and now - the DB-level `WHERE auth_mode = 'guest'` guard below is the real
    // source of truth, this is just an earlier, clearer error for the common case.
    const fresh = getDocumentById(doc.id)
    if (!fresh || fresh.authMode !== 'guest') {
      throw new Error('This agreement has already been claimed')
    }

    const claimed = dbClaimDocumentToWallet(doc.id, input.walletAddress, Date.now())
    if (!claimed) {
      throw new Error('This agreement has already been claimed')
    }

    // Creator party is always inserted first (sortOrder 0) - same convention used by
    // `redeemDocumentKey` / `addGuestSignature`'s creator-role resolution.
    const parties = getPartiesForDocument(doc.id).slice().sort((a, b) => a.sortOrder - b.sortOrder)
    const creatorParty = parties[0]
    if (creatorParty) {
      const alreadySigned = getSignaturesForDocument(doc.id).some(
        sig => sig.partyId === creatorParty.id,
      )
      // v1 rule (plan "Claim ownership" #4): only bind the creator party's wallet when
      // it hasn't signed yet as a guest. If it already guest-signed, leave the party
      // wallet null forever and rely on `document.creatorAddress` for ownership - the
      // signature row itself is never touched either way.
      if (!alreadySigned) {
        assignPartyWallet(creatorParty.id, input.walletAddress)
      }
    }
  })

  return publicDocument(getDocumentById(doc.id)!, { viewerAddress: input.walletAddress })
}

/**
 * Replace the signing roster from construction (named people).
 * Creator may claim one person slot or none (organizer-only).
 * Requires no signatures yet.
 */
function isValidNimiqAddressShape(address: string): boolean {
  const clean = normalizeAddress(address)
  return /^NQ[0-9A-Z]{34}$/.test(clean)
}

export function configureSigningRoster(
  documentId: string,
  requesterAddress: string,
  input: {
    parties: Array<{ displayName: string; role?: string; walletAddress?: string | null }>
    /** 0-based index into parties the creator wallet claims; null = creator does not sign */
    creatorSignsAsIndex: number | null
  },
): ReturnType<typeof publicDocument> {
  return runInTransaction(() => {
    const doc = getDocumentById(documentId)
    if (!doc) throw new Error('Document not found')
    if (normalizeAddress(doc.creatorAddress) !== normalizeAddress(requesterAddress)) {
      throw new Error('Only the creator can modify this agreement')
    }
    if (doc.status === 'locked' || doc.status === 'locking') {
      throw new Error('Cannot change signers after sealing has started')
    }

    const signatures = getSignaturesForDocument(documentId)
    if (signatures.length > 0) {
      throw new Error('Cannot rebuild signing roster after someone has signed')
    }

    const list = Array.isArray(input.parties) ? input.parties : []
    if (list.length < 1 || list.length > 10) {
      throw new Error('Parties must be between 1 and 10')
    }
    const creatorIdx = input.creatorSignsAsIndex
    if (creatorIdx != null) {
      if (!Number.isInteger(creatorIdx) || creatorIdx < 0 || creatorIdx >= list.length) {
        throw new Error('creatorSignsAsIndex out of range')
      }
    }

    // Drop all existing parties (unsigned - already checked)
    for (const p of getPartiesForDocument(documentId)) {
      deletePartyById(p.id)
    }

    const type = sanitizeDocumentType(doc.type)
    const creatorAddr = normalizeAddress(doc.creatorAddress)
    const seenWallets = new Set<string>()

    for (let i = 0; i < list.length; i++) {
      const entry = list[i]!
      const role =
        entry.role && entry.role.trim()
          ? entry.role.trim().slice(0, 40)
          : type === 'rental'
            ? i === 0
              ? 'landlord'
              : i === 1
                ? 'tenant'
                : 'signer'
            : 'signer'
      const fallback = `Person ${i + 1}`
      const name = entry.displayName?.trim()
        ? sanitizeDisplayName(entry.displayName, fallback)
        : fallback
      const isCreatorSlot = creatorIdx === i

      let wallet: string | null = null
      if (isCreatorSlot) {
        wallet = creatorAddr
      } else if (entry.walletAddress && String(entry.walletAddress).trim()) {
        if (!isValidNimiqAddressShape(String(entry.walletAddress))) {
          throw new Error(`Invalid Nimiq address for ${name}`)
        }
        wallet = normalizeAddress(String(entry.walletAddress))
      }

      if (wallet) {
        if (seenWallets.has(wallet)) {
          throw new Error('Each person must have a unique wallet address when addresses are set')
        }
        seenWallets.add(wallet)
      }

      insertParty({
        id: uuid(),
        documentId,
        role,
        displayName: name,
        walletAddress: wallet,
        sortOrder: i,
        required: true,
        status: 'pending',
        signedAt: null,
        inviteEmail: null,
        inviteSentAt: null,
      })
    }

    updateDocumentRequiredSignatures(documentId, list.length)
    updateDocumentStatus(documentId, 'collecting_signatures')

    return publicDocument(getDocumentById(documentId)!, {
      viewerAddress: requesterAddress,
    })
  })
}

/**
 * Creator configures total required signatures after create (step 3 / share).
 * Starts solo (1); can expand to 2–4 with optional co-signer display names.
 * Cannot change after lock, or remove parties that already signed.
 */
export function configureDocumentCosigners(
  documentId: string,
  requesterAddress: string,
  input: {
    requiredSignatures: number
    /** Optional names for co-signer slots (index 0 = first invited party). */
    coSignerNames?: string[]
  },
): ReturnType<typeof publicDocument> {
  return runInTransaction(() => {
    const doc = getDocumentById(documentId)
    if (!doc) throw new Error('Document not found')
    if (normalizeAddress(doc.creatorAddress) !== normalizeAddress(requesterAddress)) {
      throw new Error('Only the creator can modify this agreement')
    }
    if (doc.status === 'locked' || doc.status === 'locking') {
      throw new Error('Cannot change signers after sealing has started')
    }

    const parties = getPartiesForDocument(documentId)
    const signatures = getSignaturesForDocument(documentId)
    const signedPartyIds = new Set(signatures.map(s => s.partyId))
    const signedRequired = countSignedRequiredParties(parties, signatures)

    const nextRequired = clampRequiredSignatures(input.requiredSignatures, doc.requiredSignatures)
    if (nextRequired < 1) {
      throw new Error('At least one signature is required')
    }
    if (nextRequired < signedRequired) {
      throw new Error(
        `Cannot set required signatures below ${signedRequired} - that many parties have already signed`,
      )
    }

    const type = sanitizeDocumentType(doc.type)
    const creatorParty =
      parties.find(p => p.walletAddress && normalizeAddress(p.walletAddress) === normalizeAddress(doc.creatorAddress)) ??
      parties.find(p => p.sortOrder === 0) ??
      parties[0]
    if (!creatorParty) {
      throw new Error('Agreement is missing a creator party')
    }

    const creatorRole = creatorParty.role
    const otherRole = resolveOtherRole(type, creatorRole === 'landlord' || creatorRole === 'tenant' ? creatorRole : 'signer')
    const names = input.coSignerNames ?? []

    // Desired co-signer slots (everyone except creator party).
    const desiredOthers = Math.max(0, nextRequired - 1)
    const otherParties = parties
      .filter(p => p.id !== creatorParty.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    // When shrinking, drop unsigned/unclaimed open slots anywhere (not only trailing).
    // Keep signed or wallet-claimed parties; fail only if remaining locked slots exceed desired.
    if (otherParties.length > desiredOthers) {
      const removable = otherParties.filter(
        p => !signedPartyIds.has(p.id) && !p.walletAddress,
      )
      const lockedCount = otherParties.length - removable.length
      if (lockedCount > desiredOthers) {
        throw new Error(
          'Cannot remove a party that has already signed or claimed a wallet slot',
        )
      }
      const toRemove = removable.slice(desiredOthers - lockedCount)
      for (const party of toRemove) {
        deletePartyById(party.id)
      }
    }

    // Refresh after deletes; compact sortOrder so slots stay dense.
    let remainingOthers = getPartiesForDocument(documentId)
      .filter(p => p.id !== creatorParty.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

    // Update names on existing co-signer slots when provided.
    for (let i = 0; i < remainingOthers.length; i++) {
      const party = remainingOthers[i]!
      const provided = names[i]?.trim()
      if (!provided) continue
      if (signedPartyIds.has(party.id)) continue
      updatePartyDisplayName(party.id, sanitizeDisplayName(provided, party.displayName))
    }

    // Insert missing co-signer slots.
    // First co-signer uses the counterpart role (e.g. tenant); further slots are generic signers.
    for (let i = remainingOthers.length; i < desiredOthers; i++) {
      const providedName = names[i]?.trim()
      const slotRole = i === 0 ? otherRole : 'signer'
      const fallbackName = defaultOtherDisplayName(slotRole, i, desiredOthers)
      insertParty({
        id: uuid(),
        documentId,
        role: slotRole,
        displayName: providedName
          ? sanitizeDisplayName(providedName, fallbackName)
          : fallbackName,
        walletAddress: null,
        sortOrder: i + 1,
        required: true,
        status: 'pending',
        signedAt: null,
        inviteEmail: null,
        inviteSentAt: null,
      })
    }

    updateDocumentRequiredSignatures(documentId, nextRequired)

    // Expanding after creator signed alone: leave ready_to_lock if more sigs needed.
    const refreshed = getDocumentById(documentId)!
    const refreshedParties = getPartiesForDocument(documentId)
    const refreshedSigs = getSignaturesForDocument(documentId)
    if (signaturesComplete(refreshed, refreshedParties, refreshedSigs)) {
      if (refreshed.status === 'collecting_signatures' || refreshed.status === 'draft') {
        updateDocumentStatus(documentId, 'ready_to_lock')
      }
    } else if (refreshed.status === 'ready_to_lock') {
      updateDocumentStatus(documentId, 'collecting_signatures')
    }

    reconcileDocumentParties(documentId)
    const finalDoc = getDocumentById(documentId)!
    return publicDocument(finalDoc, { viewerAddress: requesterAddress })
  })
}

/** SHA-256 hex of raw invite token (never store the raw token). */
export function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

/** URL-safe opaque token (≥128 bits entropy). */
export function mintInviteTokenRaw(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Mint a personal, link-only party invite (no email send) - the guest-capable
 * sibling of `sendPartyInviteEmail` (`./email/inviteSigner.js`). Lives here rather
 * than a new file because it's really just an invite-table operation with the
 * same creator-assertion + rotation pattern as the other invite helpers already
 * in this file (`hashInviteToken`, `mintInviteTokenRaw`) - no guest-specific logic
 * is needed inside it. `assertDocumentCreator` already accepts a wallet address OR
 * a guest creator subject via `normalizeAddress`, so a link invite works identically
 * for a wallet-creator's document (see plan's Authorization matrix: "Mint personal
 * invite" is `wallet: yes`, `guest creator: yes`).
 *
 * Link invites and email invites share ONE active-invite-per-party slot (rotating
 * one revokes the other) - this is deliberate, matches `sendPartyInviteEmail`'s
 * existing single-active-invite-per-party model. Do not try to support both
 * simultaneously for the same party.
 */
export function mintLinkPartyInvite(input: {
  documentId: string
  requesterAddress: string
  partyId: string
  /** Optional - if provided, also usable as an email-channel record; the link is still returned. */
  email?: string | null
}): { inviteUrl: string; token: string; expiresAt: number } {
  const doc = assertDocumentCreator(input.documentId, input.requesterAddress)

  if (doc.status === 'locked') {
    throw new Error('This agreement is already locked')
  }

  const party = getPartyById(input.partyId)
  if (!party || party.documentId !== doc.id) {
    throw new Error('Party not found on this agreement')
  }
  if (!party.required) {
    throw new Error('This party is not a required signer')
  }
  if (party.status === 'signed') {
    throw new Error('This person has already signed')
  }

  const rawToken = mintInviteTokenRaw()
  const tokenHash = hashInviteToken(rawToken)
  const inviteId = uuid()
  const now = Date.now()
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30-day invite expiry, matches email invites

  const base = documentDeepLink(doc.slug)
  // Same query param shape as the email flow (`?invite=`) - existing `GET /api/invites/lookup`
  // and client `?invite=` parsing already understand this, no client changes needed for this part.
  const inviteUrl = `${base}${base.includes('?') ? '&' : '?'}invite=${encodeURIComponent(rawToken)}`

  runInTransaction(() => {
    revokeActivePartyInvites(party.id, now)
    insertPartyInvite({
      id: inviteId,
      documentId: doc.id,
      partyId: party.id,
      email: input.email?.trim() || '',
      tokenHash,
      channel: 'link',
      createdAt: now,
      expiresAt,
      revokedAt: null,
      redeemedAt: null,
      redeemedByWallet: null,
      resendMessageId: null,
    })
  })

  return { inviteUrl, token: rawToken, expiresAt }
}

const INVITE_LINK_REQUIRED =
  'Open the personal invite link from your email to sign as this person.'

/**
 * Resolve which party this wallet should sign as, claiming an open slot atomically
 * when needed. If the client preferred a slot that was just taken, fall through to
 * the next free open party so concurrent co-signers don't both stick to "party 1".
 *
 * Parties with an active email invite can only be claimed when `invitePartyId`
 * matches that party (token already validated by caller).
 *
 * `docAuthMode` gates the open/no-invite claim path itself (see plan's locked decision:
 * "Guest open share without `?invite=` must not allow guest sign... Wallet-native open
 * claim can remain for `auth_mode=wallet` docs only"): on a guest document (not yet
 * claimed to a wallet), a wallet may only claim/sign a party via a matching invite -
 * never via open claim, even when that party currently has no active invite record.
 * Written as `docAuthMode === 'guest'` (not `!== 'wallet'`) so a future `'claimed'`
 * document - which should behave like wallet-native going forward - isn't accidentally
 * over-restricted by this check once Task 6's claim flow lands.
 */
function resolveAndClaimParty(
  documentId: string,
  preferredPartyId: string,
  signer: string,
  docAuthMode: string,
  options?: { invitePartyId?: string | null },
): PartyRecord {
  const invitePartyId = options?.invitePartyId ?? null
  const canAccessParty = (partyId: string): boolean => {
    if (docAuthMode === 'guest') return invitePartyId === partyId
    const active = getActiveInviteForParty(partyId)
    if (!active) return true
    return invitePartyId === partyId
  }

  const signatures = getSignaturesForDocument(documentId)
  if (signatures.some(sig => normalizeAddress(sig.signerAddress) === signer)) {
    throw new Error('You already signed this agreement')
  }

  const parties = getPartiesForDocument(documentId)

  // Wallet already bound to a pending party (prior partial claim / invite).
  const alreadyMine = parties.find(
    p =>
      p.status === 'pending' &&
      p.walletAddress &&
      normalizeAddress(p.walletAddress) === signer,
  )
  if (alreadyMine) {
    if (signatures.some(sig => sig.partyId === alreadyMine.id)) {
      markPartySigned(alreadyMine.id)
      throw new Error('You already signed this agreement')
    }
    if (!canAccessParty(alreadyMine.id)) {
      throw new Error(INVITE_LINK_REQUIRED)
    }
    return alreadyMine
  }

  const tryClaim = (partyId: string): PartyRecord | null => {
    if (!canAccessParty(partyId)) return null
    if (!claimPartyWalletIfOpen(partyId, signer)) return null
    const claimed = getPartyById(partyId)
    if (!claimed || claimed.status !== 'pending') return null
    if (!claimed.walletAddress || normalizeAddress(claimed.walletAddress) !== signer) {
      return null
    }
    return claimed
  }

  const preferred = parties.find(p => p.id === preferredPartyId)
  if (preferred) {
    if (preferred.documentId !== documentId) {
      throw new Error('Party not found')
    }
    if (preferred.status === 'pending') {
      if (!canAccessParty(preferred.id)) {
        throw new Error(INVITE_LINK_REQUIRED)
      }
      if (preferred.walletAddress) {
        if (normalizeAddress(preferred.walletAddress) === signer) {
          return preferred
        }
        // Preferred slot belongs to someone else - fall through to next open.
      } else {
        const claimed = tryClaim(preferred.id)
        if (claimed) return claimed
        // Lost the race for the preferred slot - claim another open party.
      }
    }
  }

  // Prefer lowest sort_order among currently open pending parties (skip email-gated).
  const openParties = getPartiesForDocument(documentId).filter(
    p => p.status === 'pending' && !p.walletAddress && canAccessParty(p.id),
  )
  for (const open of openParties) {
    const claimed = tryClaim(open.id)
    if (claimed) return claimed
  }

  // Re-check assignment after races (another writer may have bound us, or only
  // pre-assigned wallets remain).
  const refreshed = getPartiesForDocument(documentId)
  const bound = refreshed.find(
    p =>
      p.status === 'pending' &&
      p.walletAddress &&
      normalizeAddress(p.walletAddress) === signer,
  )
  if (bound) {
    if (!canAccessParty(bound.id)) {
      throw new Error(INVITE_LINK_REQUIRED)
    }
    return bound
  }

  const pending = refreshed.filter(p => p.required && p.status === 'pending')
  if (pending.length === 0) {
    throw new Error('No signatures are pending on this document.')
  }

  // Prefer a clear invite error when the preferred slot is email-gated.
  if (preferred && getActiveInviteForParty(preferred.id) && invitePartyId !== preferred.id) {
    throw new Error(INVITE_LINK_REQUIRED)
  }

  const waitingOn = pending
    .map(p =>
      p.walletAddress
        ? `${p.displayName} (${shortAddress(p.walletAddress)})`
        : p.displayName,
    )
    .join(', ')
  throw new Error(
    `This wallet is not assigned to sign. Still waiting on: ${waitingOn}. Connect with the wallet that created the agreement, or the invited signer.`,
  )
}

export function addSignature(input: {
  documentId: string
  partyId: string
  signerAddress: string
  signatureType: string
  clientSha256: string
  displayName?: string
  signatureImage?: Buffer
  signatureImageSha256?: string
  /** Raw personal invite token from email deep link (`?invite=`). */
  inviteToken?: string | null
}) {
  try {
    let becameReadyToLock = false
    const publicDoc = runInTransaction(() => {
      const doc = getDocumentById(input.documentId)
      if (!doc) throw new Error('Document not found')
      if (doc.status === 'locked' || doc.status === 'locking') {
        throw new Error('Document is already locked')
      }

      if (input.clientSha256.toLowerCase() !== doc.originalSha256) {
        throw new Error('Document hash mismatch - reload the PDF before signing')
      }

      const signer = normalizeAddress(input.signerAddress)

      let inviteForSign: PartyInviteRecord | null = null
      const rawToken = input.inviteToken?.trim() || ''
      if (rawToken) {
        inviteForSign = getPartyInviteByTokenHash(hashInviteToken(rawToken))
        if (!inviteForSign || inviteForSign.documentId !== input.documentId) {
          throw new Error(
            'This invite link is invalid or has expired. Ask the organizer to resend the invite.',
          )
        }
      }

      // Token wins over client partyId so a forwarded email always maps to its slot.
      const preferredPartyId = inviteForSign?.partyId ?? input.partyId
      const party = resolveAndClaimParty(input.documentId, preferredPartyId, signer, doc.authMode, {
        invitePartyId: inviteForSign?.partyId ?? null,
      })

      // Defense in depth: never sign an email-gated party without the matching invite.
      const activeOnParty = getActiveInviteForParty(party.id)
      if (activeOnParty && (!inviteForSign || inviteForSign.id !== activeOnParty.id)) {
        throw new Error(INVITE_LINK_REQUIRED)
      }

      const existingForParty = getSignaturesForDocument(input.documentId).find(
        sig => sig.partyId === party.id,
      )
      if (existingForParty) {
        markPartySigned(party.id)
        reconcileDocumentParties(input.documentId)
        throw new Error('This party already signed - refresh the page to continue.')
      }

      // Refresh display-name needs from post-claim row.
      const partyRow = getPartyById(party.id) ?? party
      if (partyNeedsDisplayName(partyRow)) {
        const name = input.displayName?.trim()
        if (!name) {
          throw new Error('Your name is required before signing')
        }
        updatePartyDisplayName(party.id, sanitizeDisplayName(name, partyRow.displayName))
      }

      const sigId = uuid()
      const invitedAsEmail = inviteForSign?.email ?? null
      const inviteId = inviteForSign?.id ?? null
      insertSignature({
        id: sigId,
        documentId: input.documentId,
        partyId: party.id,
        signerAddress: signer,
        signatureType: input.signatureType,
        clientSha256: input.clientSha256.toLowerCase(),
        signedAt: Date.now(),
        invitedAsEmail,
        inviteId,
        // Wallet-native sign path (guest signing is a separate function - see guest-signing-plan.md).
        authMethod: 'wallet',
        signerSubject: null,
      })

      if (inviteForSign) {
        markPartyInviteRedeemed(inviteForSign.id, signer)
      }

      if (input.signatureImage) {
        if (input.signatureType !== 'drawn') {
          throw new Error('Signature image is only allowed for drawn signatures')
        }
        insertSignatureImage({
          signatureId: sigId,
          imageBlob: input.signatureImage,
          contentType: 'image/png',
          byteSize: input.signatureImage.length,
          imageSha256: input.signatureImageSha256 ?? hashSignatureImage(input.signatureImage),
        })
      }

      markPartySigned(party.id)

      const updatedParties = getPartiesForDocument(input.documentId)
      const updatedSignatures = getSignaturesForDocument(input.documentId)
      const updatedDoc = getDocumentById(input.documentId)!
      if (signaturesComplete(updatedDoc, updatedParties, updatedSignatures)) {
        // Already filtered out locked/locking above - only notify on first transition.
        becameReadyToLock = doc.status !== 'ready_to_lock'
        updateDocumentStatus(input.documentId, 'ready_to_lock')
      } else if (doc.status === 'draft') {
        updateDocumentStatus(input.documentId, 'collecting_signatures')
      }

      return publicDocument(getDocumentById(input.documentId)!, {
        viewerAddress: signer,
      })
    })

    if (becameReadyToLock) {
      // Lazy import avoids circular deps; fire-and-forget so sign response is fast
      void import('./email/readyToSeal.js').then(({ notifyCreatorReadyToSeal }) =>
        notifyCreatorReadyToSeal(input.documentId),
      )
    }

    return publicDoc
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new Error(
        'Another signer claimed this slot at the same time. Refresh and try again if you still need to sign.',
      )
    }
    throw err
  }
}

/**
 * Guest-native sibling of `addSignature` - no Nimiq wallet involved.
 *
 * Unlike `addSignature`, there is no open-slot-claiming step: `resolveAndClaimParty`
 * is wallet-claim-specific (it calls `claimPartyWalletIfOpen`, which would incorrectly
 * SET `document_parties.wallet_address` to a guest sentinel - guest parties keep
 * `wallet_address = null` always; binding a real wallet only happens later via wallet
 * claim, out of scope here). Instead, the guest session that authenticated this request
 * (Task 2's `requireWalletOrGuestCreator` / `requireWalletOrGuestSigner` middleware) has
 * ALREADY deterministically identified which party this is via `guestRole`/`guestPartyId`.
 * The route must never accept a client-supplied partyId for the guest path - enforced here
 * by the type signature simply not having one.
 */
export function addGuestSignature(input: {
  documentId: string
  /** From the guest session that authenticated this request - NEVER derive from request body. */
  guestRole: 'creator' | 'signer'
  /** Non-null only when guestRole === 'signer'. */
  guestPartyId: string | null
  signatureType: string
  clientSha256: string
  displayName?: string
  signatureImage?: Buffer
  signatureImageSha256?: string
}): ReturnType<typeof publicDocument> {
  try {
    let becameReadyToLock = false
    const publicDoc = runInTransaction(() => {
      const doc = getDocumentById(input.documentId)
      if (!doc) throw new Error('Document not found')
      if (doc.status === 'locked' || doc.status === 'locking') {
        throw new Error('Document is already locked')
      }

      if (input.clientSha256.toLowerCase() !== doc.originalSha256) {
        throw new Error('Document hash mismatch - reload the PDF before signing')
      }

      let party: PartyRecord
      if (input.guestRole === 'creator') {
        // Creator guest sessions carry no partyId - resolve by convention, mirroring
        // `redeemDocumentKey` (`guestAuth.ts`) and `createGuestDocument`'s insert order:
        // the creator party is always inserted first at sortOrder 0.
        const parties = getPartiesForDocument(input.documentId)
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
        const creatorParty = parties[0]
        if (!creatorParty) throw new Error('Document has no creator party')
        party = creatorParty
      } else {
        // Not reachable yet (no route wires a signer-role guest session here this task
        // - see plan Task 5), but implemented correctly now so that task needs no changes.
        const found = input.guestPartyId ? getPartyById(input.guestPartyId) : null
        if (!found || found.documentId !== input.documentId) {
          throw new Error('Party not found')
        }
        party = found
      }

      const existingForParty = getSignaturesForDocument(input.documentId).find(
        sig => sig.partyId === party.id,
      )
      if (existingForParty) {
        markPartySigned(party.id)
        reconcileDocumentParties(input.documentId)
        throw new Error('This party already signed - refresh the page to continue.')
      }

      const partyRow = getPartyById(party.id) ?? party
      if (partyNeedsDisplayName(partyRow)) {
        const name = input.displayName?.trim()
        if (!name) {
          throw new Error('Your name is required before signing')
        }
        updatePartyDisplayName(party.id, sanitizeDisplayName(name, partyRow.displayName))
      }

      const sigId = uuid()
      insertSignature({
        id: sigId,
        documentId: input.documentId,
        partyId: party.id,
        // Always party-scoped, even for a creator-role guest session - the plan's
        // "v1 pragmatic approach": signature rows use guest:party:{partyId}, distinct
        // from document.creatorAddress which stays guest:doc:{id}.
        signerAddress: guestPartySubject(party.id),
        signatureType: input.signatureType,
        clientSha256: input.clientSha256.toLowerCase(),
        signedAt: Date.now(),
        // No invite involved for the creator-signs-alone case; Task 5 will pass through
        // invite data for the signer case if/when needed.
        invitedAsEmail: null,
        inviteId: null,
        authMethod: 'guest',
        // Not populated in v1 - see docs/guest-signing-plan.md "Signatures" section.
        signerSubject: null,
      })

      if (input.signatureImage) {
        if (input.signatureType !== 'drawn') {
          throw new Error('Signature image is only allowed for drawn signatures')
        }
        insertSignatureImage({
          signatureId: sigId,
          imageBlob: input.signatureImage,
          contentType: 'image/png',
          byteSize: input.signatureImage.length,
          imageSha256: input.signatureImageSha256 ?? hashSignatureImage(input.signatureImage),
        })
      }

      markPartySigned(party.id)

      const updatedParties = getPartiesForDocument(input.documentId)
      const updatedSignatures = getSignaturesForDocument(input.documentId)
      const updatedDoc = getDocumentById(input.documentId)!
      if (signaturesComplete(updatedDoc, updatedParties, updatedSignatures)) {
        becameReadyToLock = doc.status !== 'ready_to_lock'
        updateDocumentStatus(input.documentId, 'ready_to_lock')
      } else if (doc.status === 'draft') {
        updateDocumentStatus(input.documentId, 'collecting_signatures')
      }

      // Viewer is the acting guest's OWN subject (creator subject for a creator
      // session, even though the signature row itself used the party subject) so the
      // response reveals full detail to them - mirrors `addSignature`'s
      // `viewerAddress: signer` (the acting wallet).
      return publicDocument(getDocumentById(input.documentId)!, {
        viewerAddress:
          input.guestRole === 'creator'
            ? guestCreatorSubject(input.documentId)
            : guestPartySubject(party.id),
      })
    })

    if (becameReadyToLock) {
      void import('./email/readyToSeal.js').then(({ notifyCreatorReadyToSeal }) =>
        notifyCreatorReadyToSeal(input.documentId),
      )
    }

    return publicDoc
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new Error(
        'Another signer claimed this slot at the same time. Refresh and try again if you still need to sign.',
      )
    }
    throw err
  }
}

export function setCreatorNotifyEmail(
  documentId: string,
  requesterAddress: string,
  email: string | null,
) {
  assertDocumentCreator(documentId, requesterAddress)
  setDocumentNotifyEmail(documentId, email)
  return { ok: true as const }
}

export function prepareLock(documentId: string, finalSha256: string, requesterAddress: string) {
  const doc = assertDocumentCreator(documentId, requesterAddress)

  if (doc.status === 'locking') {
    updateDocumentStatus(documentId, 'ready_to_lock')
  }

  const parties = getPartiesForDocument(documentId)
  const signatures = getSignaturesForDocument(documentId)
  if (!signaturesComplete(doc, parties, signatures)) {
    const requiredCount = resolveRequiredSignatureCount(doc, parties)
    const remaining = Math.max(0, requiredCount - countSignedRequiredParties(parties, signatures))
    throw new Error(`${remaining} required signature(s) still pending`)
  }

  const hash = finalSha256.toLowerCase()
  setDocumentFinalSha256(documentId, hash, 'ready_to_lock')

  return {
    document: publicDocument(getDocumentById(documentId)!, {
      viewerAddress: requesterAddress,
    }),
    attestationPayload: buildAttestationPayload(documentId, hash),
    pricing: getSealPricing(),
  }
}

export function beginLock(documentId: string, requesterAddress: string) {
  const doc = assertDocumentCreator(documentId, requesterAddress)
  if (!doc.finalSha256) throw new Error('Call prepare-lock first')
  updateDocumentStatus(documentId, 'locking')
  return publicDocument(getDocumentById(documentId)!, {
    viewerAddress: requesterAddress,
  })
}

export function getMyDocuments(address: string) {
  const docs = listDocumentsForAddress(address)
  const archivedMap = getDocumentListArchivedMap(
    address,
    docs.map(d => d.id),
  )
  return docs.map(doc =>
    publicDocument(doc, {
      viewerAddress: address,
      listArchivedAt: archivedMap.get(doc.id) ?? null,
    }),
  )
}

/**
 * Soft-archive (or restore) an agreement on this wallet’s list only.
 * Distinct from on-chain data archive and from server purge.
 */
export function setMyDocumentListArchived(
  documentId: string,
  requesterAddress: string,
  archived: boolean,
) {
  const doc = getDocumentById(documentId) ?? getDocumentBySlug(documentId)
  if (!doc) throw new Error('Document not found')
  const parties = getPartiesForDocument(doc.id)
  const signatures = getSignaturesForDocument(doc.id)
  if (!canRevealParticipantDetails(doc, parties, signatures, requesterAddress)) {
    throw new Error('Only participants can archive this agreement from their list')
  }
  const listArchivedAt = setDocumentListArchived(requesterAddress, doc.id, archived)
  return publicDocument(doc, {
    viewerAddress: requesterAddress,
    listArchivedAt,
  })
}

export function getDocumentPublic(idOrSlug: string, viewerAddress?: string | null) {
  const doc = getDocumentById(idOrSlug) ?? getDocumentBySlug(idOrSlug)
  if (!doc) return null
  return publicDocument(doc, { viewerAddress })
}

/** Used by signature-image route - load raw records and check membership. */
export function viewerMayAccessSignatureImage(
  documentId: string,
  viewerAddress: string | null | undefined,
): boolean {
  const doc = getDocumentById(documentId) ?? getDocumentBySlug(documentId)
  if (!doc) return false
  const parties = getPartiesForDocument(doc.id)
  const signatures = getSignaturesForDocument(doc.id)
  return canRevealParticipantDetails(doc, parties, signatures, viewerAddress)
}

export function deleteDocument(idOrSlug: string, requesterAddress: string): void {
  const doc = getDocumentById(idOrSlug) ?? getDocumentBySlug(idOrSlug)
  if (!doc) {
    throw new Error('Document not found')
  }
  if (normalizeAddress(doc.creatorAddress) !== normalizeAddress(requesterAddress)) {
    throw new Error('Only the creator can delete this agreement')
  }
  if (doc.status === 'locking') {
    throw new Error('Agreements being sealed cannot be deleted')
  }

  // Sealed + full data archive on Nimiq: allow purging VeriLock server copy only.
  // Fingerprint and multi-tx archive remain on-chain permanently.
  if (doc.status === 'locked') {
    const archive = getDocumentDataArchive(doc.id)
    if (!archive?.onChain) {
      throw new Error(
        'Sealed agreements can only be removed from VeriLock after signatures and fields are stored on the Nimiq blockchain',
      )
    }
    deleteDocumentById(doc.id)
    return
  }

  // Draft / in-progress: only cancel before anyone has signed.
  const signatures = getSignaturesForDocument(doc.id)
  if (signatures.length > 0) {
    throw new Error('Cannot cancel after a signature has been recorded')
  }
  const parties = getPartiesForDocument(doc.id)
  if (parties.some(p => p.status === 'signed')) {
    throw new Error('Cannot cancel after a signature has been recorded')
  }
  deleteDocumentById(doc.id)
}