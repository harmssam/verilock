import { normalizeAddress } from './addresses'
import { resolveSigningParty } from './signing'
import { documentTypeLabel, type SealDocument } from './types'

export type AgreementBucket = 'needs_you' | 'ready_to_seal' | 'waiting' | 'locked'

export interface AgreementView {
  bucket: AgreementBucket
  headline: string
  detail: string
  cta: string
}

export const BUCKET_ORDER: AgreementBucket[] = [
  'needs_you',
  'ready_to_seal',
  'waiting',
  'locked',
]

export const BUCKET_LABELS: Record<AgreementBucket, string> = {
  needs_you: 'Needs your action',
  ready_to_seal: 'Ready to lock',
  waiting: 'Waiting on others',
  locked: 'Locked',
}

export function isDocumentCreator(
  doc: Pick<SealDocument, 'creatorAddress'>,
  address: string | null,
): boolean {
  if (!address) return false
  return normalizeAddress(doc.creatorAddress) === normalizeAddress(address)
}

/**
 * Creator or any party/signer wallet may see display names + signature images.
 * Prefer server `participantDetailsRevealed` when present (authoritative).
 * When the flag is missing (older payloads), fall back to local wallet match.
 * Re-fetch with a session token if the open doc is still redacted — see useRevealDocumentOnAuth.
 */
export function canRevealParticipantDetails(
  doc: Pick<SealDocument, 'creatorAddress' | 'parties' | 'signatures' | 'participantDetailsRevealed'>,
  address: string | null,
): boolean {
  if (typeof doc.participantDetailsRevealed === 'boolean') {
    return doc.participantDetailsRevealed
  }
  if (!address) return false
  if (isDocumentCreator(doc, address)) return true
  const me = normalizeAddress(address)
  if (doc.parties.some(p => p.walletAddress && normalizeAddress(p.walletAddress) === me)) {
    return true
  }
  if (doc.signatures.some(s => normalizeAddress(s.signerAddress) === me)) {
    return true
  }
  return false
}

/**
 * Creator may cancel only before anyone has signed (and never once sealing/sealed).
 */
export function canDeleteDocument(
  doc: Pick<SealDocument, 'status' | 'creatorAddress' | 'signatures' | 'parties'> & {
    signingProgress?: SealDocument['signingProgress']
  },
  address: string | null,
): boolean {
  if (!address || !isDocumentCreator(doc, address)) return false
  if (doc.status === 'locked' || doc.status === 'locking') return false
  if (doc.signatures.length > 0) return false
  if (doc.parties.some(p => p.status === 'signed')) return false
  if (doc.signingProgress && doc.signingProgress.signed > 0) return false
  return true
}

/**
 * Creator may purge VeriLock server records for a locked agreement only when
 * signatures/fields are already stored on the Nimiq blockchain (data archive).
 * On-chain fingerprint + archive txs remain; only our app metadata is removed.
 */
export function canPurgeServerCopy(
  doc: Pick<SealDocument, 'status' | 'creatorAddress' | 'dataArchive' | 'attestation'>,
  address: string | null,
): boolean {
  if (!address || !isDocumentCreator(doc, address)) return false
  if (doc.status !== 'locked' && doc.attestation?.status !== 'confirmed') return false
  return Boolean(doc.dataArchive?.onChain)
}

/** Locked fingerprint + full data archive on Nimiq. */
export function isFullyOnChain(
  doc: Pick<SealDocument, 'status' | 'dataArchive' | 'attestation'>,
): boolean {
  const locked = doc.status === 'locked' || doc.attestation?.status === 'confirmed'
  return locked && Boolean(doc.dataArchive?.onChain)
}

export function isCollectingSignatures(doc: SealDocument): boolean {
  if (doc.status === 'locked') return false
  if (doc.signingProgress.required === 0) return false
  return doc.signingProgress.signed < doc.signingProgress.required
}

export function isSigningComplete(doc: SealDocument): boolean {
  if (doc.signingProgress.required === 0) return true
  return doc.signingProgress.signed >= doc.signingProgress.required
}

export function isSealingPhase(doc: SealDocument): boolean {
  if (doc.status === 'locked' || doc.attestation?.status === 'confirmed') return false
  if (doc.signingProgress.required === 0) {
    return doc.status !== 'locked'
  }
  return (
    doc.status === 'locking' ||
    doc.status === 'ready_to_lock' ||
    (doc.signingProgress.signed >= doc.signingProgress.required && doc.status !== 'locked')
  )
}

export function getAgreementView(doc: SealDocument, address: string | null): AgreementView {
  const { signed, required, readyToLock } = doc.signingProgress
  const progress = required === 0 ? 'direct lock' : `${signed}/${required} signed`

  if (doc.status === 'locked' || doc.attestation?.status === 'confirmed') {
    const fullyBackedUp = Boolean(doc.dataArchive?.onChain)
    return {
      bucket: 'locked',
      headline: fullyBackedUp
        ? 'Fingerprint + data on blockchain'
        : 'Locked on-chain',
      detail: progress,
      cta: 'View',
    }
  }

  const creator = isDocumentCreator(doc, address)

  if (doc.status === 'locking' && doc.attestation?.status !== 'failed') {
    return {
      bucket: 'ready_to_seal',
      headline: doc.attestation?.status === 'pending' ? 'Confirming lock' : 'Locking in progress',
      detail: progress,
      cta: 'View',
    }
  }

  if (doc.attestation?.status === 'failed' && doc.status !== 'locked') {
    return {
      bucket: 'ready_to_seal',
      headline: 'Lock again',
      detail: progress,
      cta: 'Lock now',
    }
  }

  if (readyToLock || doc.status === 'ready_to_lock') {
    if (creator) {
      const headline =
        doc.signingProgress.required === 0
          ? 'Ready to lock on-chain'
          : 'All signed — lock on-chain'
      return {
        bucket: 'ready_to_seal',
        headline,
        detail: progress,
        cta: 'Lock now',
      }
    }
    return {
      bucket: 'waiting',
      headline: 'Waiting to lock',
      detail: progress,
      cta: 'View',
    }
  }

  if (address) {
    const resolution = resolveSigningParty(doc, address)
    if (resolution.ok) {
      return {
        bucket: 'needs_you',
        headline: 'Your signature needed',
        detail: progress,
        cta: 'Sign now',
      }
    }
    if (resolution.hint === 'already_signed') {
      return {
        bucket: 'waiting',
        headline: 'You signed — waiting on others',
        detail: progress,
        cta: 'View & share',
      }
    }
    if (resolution.hint === 'complete') {
      return creator
        ? {
            bucket: 'ready_to_seal',
            headline:
              doc.signingProgress.required === 0
                ? 'Ready to lock on-chain'
                : 'All signed — lock on-chain',
            detail: progress,
            cta: 'Lock now',
          }
        : {
            bucket: 'waiting',
            headline: 'Waiting to lock',
            detail: progress,
            cta: 'View',
          }
    }
  }

  if (creator) {
    if (doc.signingProgress.required === 0) {
      return {
        bucket: 'ready_to_seal',
        headline: 'Ready to lock on-chain',
        detail: progress,
        cta: 'Lock now',
      }
    }
    return {
      bucket: 'waiting',
      headline: 'Waiting for signatures',
      detail: progress,
      cta: 'Share & view',
    }
  }

  return {
    bucket: 'waiting',
    headline: 'In progress',
    detail: progress,
    cta: 'View',
  }
}

export function groupAgreements(
  docs: SealDocument[],
  address: string | null,
): Record<AgreementBucket, SealDocument[]> {
  const groups: Record<AgreementBucket, SealDocument[]> = {
    needs_you: [],
    ready_to_seal: [],
    waiting: [],
    locked: [],
  }

  for (const doc of docs) {
    groups[getAgreementView(doc, address).bucket].push(doc)
  }

  return groups
}

/** Case-insensitive match on title, filename, type label, and hash prefixes. */
export function filterAgreements(docs: SealDocument[], query: string): SealDocument[] {
  const q = query.trim().toLowerCase()
  if (!q) return docs

  // Strip ellipsis / non-hex noise so short-hash UI strings still match.
  const qHex = q.replace(/[^0-9a-f]/g, '')

  return docs.filter(doc => {
    if (doc.title.toLowerCase().includes(q)) return true
    if (doc.originalFilename?.toLowerCase().includes(q)) return true
    if (doc.type.toLowerCase().includes(q)) return true
    if (documentTypeLabel(doc.type).toLowerCase().includes(q)) return true
    if (qHex.length >= 2) {
      const original = doc.originalSha256.toLowerCase()
      const final = doc.finalSha256?.toLowerCase() ?? ''
      if (original.includes(qHex) || final.includes(qHex)) return true
    }
    return false
  })
}

export function countActionable(docs: SealDocument[], address: string | null): number {
  return docs.filter(doc => {
    const bucket = getAgreementView(doc, address).bucket
    return bucket === 'needs_you' || bucket === 'ready_to_seal'
  }).length
}