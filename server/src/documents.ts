import { v4 as uuid } from 'uuid'
import {
  deleteDocumentById,
  getDocumentById,
  getDocumentBySlug,
  getPartiesForDocument,
  getSignaturesForDocument,
  getSignatureImageIdsForDocument,
  getAttestationForDocument,
  insertDocument,
  insertParty,
  insertSignature,
  insertSignatureImage,
  listDocumentsForAddress,
  assignPartyWallet,
  updatePartyDisplayName,
  markPartySigned,
  setDocumentFinalSha256,
  updateDocumentStatus,
  type DocumentRecord,
  type PartyRecord,
} from './db.js'
import { buildNimiqExplorerUrl } from './explorer.js'
import { buildAttestationPayload } from './nimiq-rpc.js'
import { normalizeAddress, shortAddress } from './addresses.js'
import {
  sanitizeDisplayName,
  sanitizeDocumentMetadata,
  sanitizeDocumentType,
  sanitizeFilename,
} from './security.js'
import { hashSignatureImage } from './signature-image.js'
import { getSealPricing } from './sealPricing.js'

function slugFromId(id: string): string {
  return id.replace(/-/g, '').slice(0, 12)
}

const MIN_REQUIRED_SIGNATURES = 1
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

function isPlaceholderPartyName(name: string): boolean {
  const trimmed = name.trim().toLowerCase()
  return !trimmed || PLACEHOLDER_PARTY_NAMES.has(trimmed)
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

function countSignedRequiredParties(parties: PartyRecord[]): number {
  return parties.filter(p => p.required && p.status === 'signed').length
}

function signaturesComplete(doc: DocumentRecord, parties: PartyRecord[]): boolean {
  const requiredCount = resolveRequiredSignatureCount(doc, parties)
  return countSignedRequiredParties(parties) >= requiredCount
}

function signatureImageUrl(documentId: string, signatureId: string): string {
  return `/api/documents/${documentId}/signatures/${signatureId}/image`
}

export function publicDocument(doc: DocumentRecord) {
  reconcileDocumentParties(doc.id)
  const parties = getPartiesForDocument(doc.id)
  const signatures = getSignaturesForDocument(doc.id)
  const signatureImageIds = getSignatureImageIdsForDocument(doc.id)
  const attestation = getAttestationForDocument(doc.id)
  const requiredParties = parties.filter(p => p.required)
  const signedRequired = countSignedRequiredParties(parties)
  const requiredCount = resolveRequiredSignatureCount(doc, parties)

  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    originalFilename: doc.originalFilename,
    type: doc.type,
    status: doc.status,
    creatorAddress: doc.creatorAddress,
    originalSha256: doc.originalSha256,
    finalSha256: doc.finalSha256,
    pageCount: doc.pageCount,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
    requiredSignatures: requiredCount,
    parties: parties.map(publicParty),
    signatures: signatures.map(sig => ({
      id: sig.id,
      partyId: sig.partyId,
      signerAddress: sig.signerAddress,
      signatureType: sig.signatureType,
      signedAt: sig.signedAt,
      imageUrl: signatureImageIds.has(sig.id) ? signatureImageUrl(doc.id, sig.id) : null,
    })),
    signingProgress: {
      signed: signedRequired,
      required: requiredCount,
      readyToLock: signaturesComplete(doc, parties) && doc.status !== 'locked',
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

  const parties = getPartiesForDocument(documentId)
  const signatures = getSignaturesForDocument(documentId)

  for (const party of parties) {
    if (party.status === 'pending' && signatures.some(sig => sig.partyId === party.id)) {
      markPartySigned(party.id)
    }
  }

  const refreshed = getPartiesForDocument(documentId)
  const refreshedDoc = getDocumentById(documentId)!
  if (signaturesComplete(refreshedDoc, refreshed)) {
    if (doc.status === 'collecting_signatures' || doc.status === 'draft') {
      updateDocumentStatus(documentId, 'ready_to_lock')
    }
  } else if (doc.status === 'ready_to_lock') {
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
}) {
  const id = uuid()
  const slug = slugFromId(id)
  const now = Date.now()
  const type = sanitizeDocumentType(input.type)
  const creatorRole = resolveCreatorRole(type, input.creatorRole)
  const otherRole = resolveOtherRole(type, creatorRole)
  const requiredSignatures = clampRequiredSignatures(input.requiredSignatures, 2)
  const metadata = sanitizeDocumentMetadata(type, input.metadata)

  const doc: DocumentRecord = {
    id,
    slug,
    title: input.title.trim().slice(0, 120) || 'Untitled agreement',
    originalFilename: sanitizeFilename(input.originalFileName),
    type,
    status: 'collecting_signatures',
    creatorAddress: normalizeAddress(input.creatorAddress),
    originalSha256: input.originalSha256.toLowerCase(),
    finalSha256: null,
    pageCount: Math.max(1, input.pageCount),
    metadata,
    requiredSignatures,
    createdAt: now,
    lockedAt: null,
  }
  insertDocument(doc)

  const creatorParty: PartyRecord = {
    id: uuid(),
    documentId: id,
    role: creatorRole,
    displayName: sanitizeDisplayName(
      input.creatorDisplayName,
      shortAddress(input.creatorAddress),
    ),
    walletAddress: normalizeAddress(input.creatorAddress),
    sortOrder: 0,
    required: true,
    status: 'pending',
    signedAt: null,
  }
  insertParty(creatorParty)

  const extraPartyCount = Math.max(0, requiredSignatures - 1)
  const providedParties = input.parties ?? []

  for (let index = 0; index < extraPartyCount; index++) {
    const provided = providedParties[index]
    insertParty({
      id: uuid(),
      documentId: id,
      role: provided?.role || otherRole,
      displayName:
        provided?.displayName?.trim() ||
        defaultOtherDisplayName(otherRole, index, extraPartyCount),
      walletAddress: provided?.walletAddress ? normalizeAddress(provided.walletAddress) : null,
      sortOrder: index + 1,
      required: true,
      status: 'pending',
      signedAt: null,
    })
  }

  return publicDocument(doc)
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
  const doc = getDocumentById(input.documentId)
  if (!doc) throw new Error('Document not found')
  if (doc.status === 'locked' || doc.status === 'locking') {
    throw new Error('Document is already locked')
  }

  const parties = getPartiesForDocument(input.documentId)
  const party = parties.find(p => p.id === input.partyId)
  if (!party) throw new Error('Party not found')
  if (party.status === 'signed') throw new Error('Party already signed')

  const signer = normalizeAddress(input.signerAddress)

  if (party.walletAddress) {
    if (normalizeAddress(party.walletAddress) !== signer) {
      throw new Error('Wallet does not match assigned party')
    }
  } else {
    assignPartyWallet(input.partyId, signer)
  }

  const existingForParty = getSignaturesForDocument(input.documentId).find(
    sig => sig.partyId === input.partyId,
  )
  if (existingForParty) {
    markPartySigned(input.partyId)
    reconcileDocumentParties(input.documentId)
    throw new Error('This party already signed — refresh the page to continue.')
  }

  if (input.clientSha256.toLowerCase() !== doc.originalSha256) {
    throw new Error('Document hash mismatch — reload the PDF before signing')
  }

  if (partyNeedsDisplayName(party)) {
    const name = input.displayName?.trim()
    if (!name) {
      throw new Error('Your name is required before signing')
    }
    updatePartyDisplayName(
      input.partyId,
      sanitizeDisplayName(name, party.displayName),
    )
  }

  const sigId = uuid()
  insertSignature({
    id: sigId,
    documentId: input.documentId,
    partyId: input.partyId,
    signerAddress: normalizeAddress(input.signerAddress),
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

  markPartySigned(input.partyId)

  const updatedParties = getPartiesForDocument(input.documentId)
  const updatedDoc = getDocumentById(input.documentId)!
  if (signaturesComplete(updatedDoc, updatedParties)) {
    updateDocumentStatus(input.documentId, 'ready_to_lock')
  } else if (doc.status === 'draft') {
    updateDocumentStatus(input.documentId, 'collecting_signatures')
  }

  return publicDocument(getDocumentById(input.documentId)!)
}

export function prepareLock(documentId: string, finalSha256: string) {
  const doc = getDocumentById(documentId)
  if (!doc) throw new Error('Document not found')

  if (doc.status === 'locking') {
    updateDocumentStatus(documentId, 'ready_to_lock')
  }

  const parties = getPartiesForDocument(documentId)
  if (!signaturesComplete(doc, parties)) {
    const remaining = resolveRequiredSignatureCount(doc, parties) - countSignedRequiredParties(parties)
    throw new Error(`${remaining} required signature(s) still pending`)
  }

  const hash = finalSha256.toLowerCase()
  setDocumentFinalSha256(documentId, hash, 'ready_to_lock')

  return {
    document: publicDocument(getDocumentById(documentId)!),
    attestationPayload: buildAttestationPayload(documentId, hash),
    pricing: getSealPricing(),
  }
}

export function beginLock(documentId: string) {
  const doc = getDocumentById(documentId)
  if (!doc) throw new Error('Document not found')
  if (!doc.finalSha256) throw new Error('Call prepare-lock first')
  updateDocumentStatus(documentId, 'locking')
  return publicDocument(getDocumentById(documentId)!)
}

export function getMyDocuments(address: string) {
  return listDocumentsForAddress(address).map(publicDocument)
}

export function getDocumentPublic(idOrSlug: string) {
  const doc = getDocumentById(idOrSlug) ?? getDocumentBySlug(idOrSlug)
  if (!doc) return null
  return publicDocument(doc)
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
  deleteDocumentById(doc.id)
}