import { v4 as uuid } from 'uuid'
import {
  deleteDocumentById,
  findDocumentsByHash,
  getDocumentById,
  getDocumentBySlug,
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
  updatePartyDisplayName,
  markPartySigned,
  markPartyUnsigned,
  setDocumentFinalSha256,
  setDocumentNotifyEmail,
  updateDocumentStatus,
  updateDocumentRequiredSignatures,
  deletePartyById,
  type DocumentRecord,
  type PartyRecord,
} from './db.js'
import { buildNimiqExplorerUrl } from './explorer.js'
import { buildAttestationPayload } from './nimiq-rpc.js'
import { normalizeAddress, shortAddress } from './addresses.js'
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
 * Party status alone is not enough — status can drift without a signature record.
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
   * When set and matches creator or any party/signer wallet, reveal display names
   * and signature image URLs. Anonymous / unrelated wallets get redacted PII.
   */
  viewerAddress?: string | null
}

/**
 * True if viewer may see participant display names and signature ink images.
 * Public links stay useful (roles, wallets, seal proof) without exposing PII.
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

  return {
    id: freshDoc.id,
    slug: freshDoc.slug,
    title: freshDoc.title,
    originalFilename: freshDoc.originalFilename,
    type: freshDoc.type,
    status: freshDoc.status,
    creatorAddress: freshDoc.creatorAddress,
    originalSha256: freshDoc.originalSha256,
    finalSha256: freshDoc.finalSha256,
    pageCount: freshDoc.pageCount,
    metadata: freshDoc.metadata,
    /** PDF overlay annotations (null when none / legacy documents). */
    annotations: freshDoc.annotations,
    createdAt: freshDoc.createdAt,
    lockedAt: freshDoc.lockedAt,
    requiredSignatures: requiredCount,
    /** Whether names + signature images are included for this viewer. */
    participantDetailsRevealed: revealPrivate,
    parties: parties.map(party => {
      const base = publicParty(party)
      const hasSignature = signatures.some(sig => sig.partyId === party.id)
      return {
        ...base,
        // Never report signed without a signature row (defense in depth after reconcile).
        status: hasSignature ? ('signed' as const) : party.status === 'declined' ? party.status : ('pending' as const),
        signedAt: hasSignature ? party.signedAt : null,
        // Always redact human names for non-participants (even placeholders that look real).
        displayName: revealPrivate ? base.displayName : null,
      }
    }),
    signatures: signatures.map(sig => ({
      id: sig.id,
      partyId: sig.partyId,
      signerAddress: sig.signerAddress,
      signatureType: sig.signatureType,
      signedAt: sig.signedAt,
      // Ink images are only for creator / signees — not public share links.
      imageUrl:
        revealPrivate && signatureImageIds.has(sig.id)
          ? signatureImageUrl(doc.id, sig.id)
          : null,
      hasImage: signatureImageIds.has(sig.id),
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
      // Orphan "signed" status without a signature row — treat as still pending.
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

function publicParty(party: PartyRecord) {
  return {
    id: party.id,
    role: party.role,
    displayName: party.displayName,
    walletAddress: party.walletAddress,
    required: party.required,
    status: party.status,
    signedAt: party.signedAt,
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
   * Never includes PDF file bytes — only overlay data for reconstruction.
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
  }
  insertDocument(doc)

  // For direct seal (0 signatures), we skip parties entirely — creator seals directly.
  if (!isDirectSeal) {
    const creatorParty: PartyRecord = {
      id: uuid(),
      documentId: id,
      role: creatorRole,
      displayName: sanitizeDisplayName(
        input.creatorDisplayName?.trim() || shortAddress(input.creatorAddress),
        shortAddress(input.creatorAddress),
      ),
      walletAddress: normalizeAddress(input.creatorAddress),
      sortOrder: 0,
      required: true,
      status: 'pending',
      signedAt: null,
    }
    insertParty(creatorParty)
  }

  const priorMatches = findDocumentsByHash(doc.originalSha256).filter(existing => existing.id !== id)
  const hashWarning =
    priorMatches.length > 0
      ? `${priorMatches.length} other agreement(s) already use this PDF fingerprint. Verify the sealed record before trusting a match.`
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
      })
    }
  }

  return {
    document: publicDocument(doc, { viewerAddress: input.creatorAddress }),
    hashWarning,
  }
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
    if (list.length < 1 || list.length > 4) {
      throw new Error('Parties must be between 1 and 4')
    }
    const creatorIdx = input.creatorSignsAsIndex
    if (creatorIdx != null) {
      if (!Number.isInteger(creatorIdx) || creatorIdx < 0 || creatorIdx >= list.length) {
        throw new Error('creatorSignsAsIndex out of range')
      }
    }

    // Drop all existing parties (unsigned — already checked)
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
        `Cannot set required signatures below ${signedRequired} — that many parties have already signed`,
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

/**
 * Resolve which party this wallet should sign as, claiming an open slot atomically
 * when needed. If the client preferred a slot that was just taken, fall through to
 * the next free open party so concurrent co-signers don't both stick to "party 1".
 */
function resolveAndClaimParty(
  documentId: string,
  preferredPartyId: string,
  signer: string,
): PartyRecord {
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
    return alreadyMine
  }

  const tryClaim = (partyId: string): PartyRecord | null => {
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
      if (preferred.walletAddress) {
        if (normalizeAddress(preferred.walletAddress) === signer) {
          return preferred
        }
        // Preferred slot belongs to someone else — fall through to next open.
      } else {
        const claimed = tryClaim(preferred.id)
        if (claimed) return claimed
        // Lost the race for the preferred slot — claim another open party.
      }
    }
  }

  // Prefer lowest sort_order among currently open pending parties.
  const openParties = getPartiesForDocument(documentId).filter(
    p => p.status === 'pending' && !p.walletAddress,
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
  if (bound) return bound

  const pending = refreshed.filter(p => p.required && p.status === 'pending')
  if (pending.length === 0) {
    throw new Error('No signatures are pending on this document.')
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
        throw new Error('Document hash mismatch — reload the PDF before signing')
      }

      const signer = normalizeAddress(input.signerAddress)
      const party = resolveAndClaimParty(input.documentId, input.partyId, signer)

      const existingForParty = getSignaturesForDocument(input.documentId).find(
        sig => sig.partyId === party.id,
      )
      if (existingForParty) {
        markPartySigned(party.id)
        reconcileDocumentParties(input.documentId)
        throw new Error('This party already signed — refresh the page to continue.')
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
      insertSignature({
        id: sigId,
        documentId: input.documentId,
        partyId: party.id,
        signerAddress: signer,
        signatureType: input.signatureType,
        clientSha256: input.clientSha256.toLowerCase(),
        signedAt: Date.now(),
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
        // Already filtered out locked/locking above — only notify on first transition.
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
  return listDocumentsForAddress(address).map(doc =>
    publicDocument(doc, { viewerAddress: address }),
  )
}

export function getDocumentPublic(idOrSlug: string, viewerAddress?: string | null) {
  const doc = getDocumentById(idOrSlug) ?? getDocumentBySlug(idOrSlug)
  if (!doc) return null
  return publicDocument(doc, { viewerAddress })
}

/** Used by signature-image route — load raw records and check membership. */
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
  if (doc.status === 'locked') {
    throw new Error('Sealed agreements cannot be deleted')
  }
  if (doc.status === 'locking') {
    throw new Error('Agreements being sealed cannot be deleted')
  }
  // Only cancel before anyone has signed — protects partial multi-party work.
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