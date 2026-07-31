import { normalizeAddress, shortAddress } from '../addresses'
import { shortHash } from '../pdf/hashPdf'
import type { DocumentParty, SealDocument } from '../types'

export type JourneyStepId =
  | 'welcome'
  | 'connect'
  | 'fingerprint'
  | 'share'
  | 'sign'
  | 'seal'
  | 'verify'
  | 'done'

export type PathRole = 'creator' | 'signer' | 'verifier'

export interface JourneyStage {
  id: JourneyStepId
  label: string
  verb: string
  blurb: string
  privacyNote: string
}

/**
 * Creator path stages (rail + how-it-works).
 * Wallet login is a gate on create/sign/seal - not a numbered stage.
 */
export const CREATOR_STAGES: JourneyStage[] = [
  {
    id: 'fingerprint',
    label: 'Add document',
    verb: 'Add the document and fingerprint it locally',
    blurb:
      'Drop a PDF, PNG, JPEG, or WebP. We only register its fingerprint (no signing yet). Next you set up who signs where.',
    privacyNote:
      'Opened in your browser only - never sent to VeriLock servers. Only the fingerprint is registered.',
  },
  {
    id: 'share',
    label: 'Setup',
    verb: 'Design where people will sign',
    blurb:
      'This step is design only - not signing. Name each person, place empty signature / initial / name boxes on the document, and choose whether you are one of them (or only organizing). Continue when the layout looks right; signing and invites come next.',
    privacyNote: 'Only placement geometry is stored, not the document bytes.',
  },
  {
    id: 'sign',
    label: 'Sign',
    verb: 'Sign your fields on the document',
    blurb:
      'If you are a signer, fill in your applicable fields on the document, then sign. After you sign, invite any co-signers here. When everyone has signed, print anytime or lock on the blockchain for permanent proof.',
    privacyNote: 'You prove you hold these bytes - still no upload.',
  },
  {
    id: 'seal',
    label: 'Lock',
    verb: 'Lock on the blockchain',
    blurb:
      'Optional upgrade: one credit locks the fingerprint forever on Nimiq. Signing and print are free without a lock.',
    privacyNote: 'The chain stores a hash string - never the document.',
  },
  {
    id: 'verify',
    label: 'Verify',
    verb: 'Check anytime',
    blurb: 'Anyone can drop a document copy and prove it still matches.',
    privacyNote: 'Verification needs no wallet and never uploads the file.',
  },
]

/**
 * Invited signer path. Login is required to submit a signature, not a rail step.
 * Rail: Sign → Done (after this wallet has signed).
 */
export const SIGNER_STAGES: JourneyStage[] = [
  {
    id: 'sign',
    label: 'Sign',
    verb: 'Match document & complete your fields',
    blurb:
      'Drop the document the organizer shared with you, confirm it matches, fill your fields on the document, then bind with your wallet.',
    privacyNote: 'We never see your file. It stays on your device.',
  },
  {
    id: 'done',
    label: 'Done',
    verb: 'Your signature is recorded',
    blurb:
      'Review who signed and your recorded signature below. With the same local file, you can print a signed copy when everyone has finished. VeriLock never stores the PDF.',
    privacyNote: 'Keep your document. Anyone can re-check the fingerprint later.',
  },
]

/**
 * Verifier path: local fingerprint → record/chain lookup.
 * Step ids: `verify` (drop + hash) then `done` (match against VeriLock + Nimiq).
 */
export const VERIFIER_STAGES: JourneyStage[] = [
  {
    id: 'verify',
    label: 'Fingerprint',
    verb: 'Drop a document to fingerprint',
    blurb:
      'Drop any copy of a locked document. We compute its SHA-256 fingerprint entirely in your browser - the file never leaves this device, and we never upload it.',
    privacyNote:
      'Only the short fingerprint is used for lookup. No wallet is required for this step.',
  },
  {
    id: 'done',
    label: 'Match',
    verb: 'Check VeriLock records and the blockchain',
    blurb:
      'We look up that fingerprint in VeriLock’s local records and against the Nimiq blockchain to see whether a locked proof exists. If it matches, you get the public lock details (status, explorer link, and hash).',
    privacyNote:
      'Unless you connect with a wallet that was one of the original parties, names, signatures, and other private entries stay anonymous. Outsiders only see that the fingerprint matches a lock.',
  },
]

export function stagesForRole(role: PathRole | null): JourneyStage[] {
  if (role === 'signer') return SIGNER_STAGES
  if (role === 'verifier') return VERIFIER_STAGES
  return CREATOR_STAGES
}

export interface JourneyAccount {
  address: string
  shortAddress: string
}

export interface JourneyParty {
  id: string
  roleLabel: string
  displayName: string | null
  signed: boolean
  walletShort: string | null
  hasInk: boolean
  walletAddress: string | null
  required: boolean
  inviteEmail: string | null
  inviteSentAt: number | null
}

/** UI-facing document view over a live SealDocument. */
export interface JourneyDoc {
  id: string
  slug: string
  title: string
  fileName: string
  fileSize: number
  fingerprint: string
  fingerprintPreview: string
  shareUrl: string
  parties: JourneyParty[]
  sealed: boolean
  directSeal: boolean
  readyToLock: boolean
  requiredSignatures: number
  signedSignatures: number
  status: string
  source: SealDocument
}

export function toJourneyAccount(address: string): JourneyAccount {
  return { address, shortAddress: shortAddress(address) }
}

function partyLabel(party: DocumentParty): string {
  if (party.role === 'landlord') return 'Landlord'
  if (party.role === 'tenant') return 'Tenant'
  if (party.role === 'creator') return 'Creator'
  return party.role.charAt(0).toUpperCase() + party.role.slice(1)
}

export function toJourneyDoc(doc: SealDocument, fileSize = 0): JourneyDoc {
  const sealed =
    doc.status === 'locked' || doc.attestation?.status === 'confirmed'
  const directSeal = doc.requiredSignatures === 0
  const rawShare = doc.shareUrl || `/d/${doc.slug}`
  const shareUrl =
    rawShare.startsWith('http')
      ? rawShare
      : typeof window !== 'undefined'
        ? `${window.location.origin}${rawShare.startsWith('/') ? '' : '/'}${rawShare}`
        : rawShare

  const parties: JourneyParty[] = doc.parties.map(p => {
    const sig = doc.signatures.find(s => s.partyId === p.id)
    // Only a real signature record counts as signed - never party status alone.
    const signed = Boolean(sig)
    return {
      id: p.id,
      roleLabel: partyLabel(p),
      // Open claim slots keep displayName for invitee “Who are you?”; other PII stays redacted.
      displayName: p.displayName || null,
      signed,
      walletShort: p.walletAddress
        ? shortAddress(p.walletAddress)
        : sig
          ? shortAddress(sig.signerAddress)
          : null,
      hasInk: Boolean(sig?.imageUrl || sig?.hasImage),
      walletAddress: p.walletAddress,
      required: p.required,
      inviteEmail: p.inviteEmail ?? null,
      inviteSentAt: p.inviteSentAt ?? null,
    }
  })

  const required = doc.signingProgress.required
  const requiredPartyCount = parties.filter(p => p.required).length
  const signedFromSigs =
    requiredPartyCount > 0
      ? parties.filter(p => p.signed && p.required).length
      : doc.signatures.length
  // Never trust readyToLock when signature records are short of the requirement.
  const recordsComplete =
    directSeal || required === 0 || doc.signatures.length >= required
  const partiesComplete = directSeal || required === 0 || signedFromSigs >= required
  const readyToLock =
    directSeal ||
    (recordsComplete && partiesComplete && (doc.signingProgress.readyToLock || signedFromSigs >= required))

  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    fileName: doc.originalFilename ?? 'document.pdf',
    fileSize,
    fingerprint: doc.originalSha256,
    fingerprintPreview: shortHash(doc.originalSha256),
    shareUrl,
    parties,
    sealed,
    directSeal,
    readyToLock,
    requiredSignatures: required,
    signedSignatures: signedFromSigs,
    status: doc.status,
    source: doc,
  }
}

export function signedCount(doc: JourneyDoc): number {
  // Count parties that have a real signature (toJourneyDoc sets signed from signature rows only).
  const requiredParties = doc.parties.filter(p => p.required)
  if (requiredParties.length > 0) {
    return requiredParties.filter(p => p.signed).length
  }
  const anySigned = doc.parties.filter(p => p.signed).length
  if (anySigned > 0) return anySigned
  return doc.source.signatures.length
}

/**
 * Whether this wallet already submitted a signature on the agreement.
 * Prefer signature rows (signerAddress) - party.walletAddress may still be null
 * after an open-slot claim until a refresh binds it.
 */
export function walletHasSignedJourneyDoc(
  doc: JourneyDoc,
  walletAddress: string | null | undefined,
): boolean {
  if (!walletAddress) return false
  const me = normalizeAddress(walletAddress)
  if (
    doc.source.signatures.some(s => normalizeAddress(s.signerAddress) === me)
  ) {
    return true
  }
  return doc.parties.some(
    p => p.signed && p.walletAddress && normalizeAddress(p.walletAddress) === me,
  )
}

export function requiredCount(doc: JourneyDoc): number {
  if (doc.directSeal) return 0
  if (typeof doc.requiredSignatures === 'number' && doc.requiredSignatures > 0) {
    return doc.requiredSignatures
  }
  const requiredParties = doc.parties.filter(p => p.required).length
  return requiredParties > 0 ? requiredParties : doc.parties.length
}

/**
 * True only when every required signature has a real signature record.
 * Does not treat server readyToLock alone as sufficient (guards status drift).
 */
export function allSigned(doc: JourneyDoc): boolean {
  if (doc.directSeal) return true
  const need = requiredCount(doc)
  if (need === 0) return true
  if (doc.source.signatures.length < need) return false
  return signedCount(doc) >= need
}

export function nextUnsignedParty(doc: JourneyDoc): JourneyParty | null {
  return doc.parties.find(p => !p.signed && p.required) ?? null
}
