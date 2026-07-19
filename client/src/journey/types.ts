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
 * Wallet login is a gate on create/sign/seal — not a numbered stage.
 */
export const CREATOR_STAGES: JourneyStage[] = [
  {
    id: 'fingerprint',
    label: 'Add PDF',
    verb: 'Add the PDF and fingerprint it locally',
    blurb:
      'Drop the agreement file. We only register its fingerprint — no signing yet. Next you arrange who signs where.',
    privacyNote: 'The file never uploads. Only the fingerprint is registered.',
  },
  {
    id: 'share',
    label: 'Create and Invite',
    verb: 'Name people, place fields, invite signers',
    blurb:
      'Name each signer, place their boxes on the PDF, and choose whether you are one of them (or only organizing). Continue when the layout looks right — you can come back to edit until someone signs.',
    privacyNote: 'Only placement geometry is stored — not the PDF bytes.',
  },
  {
    id: 'sign',
    label: 'Sign',
    verb: 'Sign your fields on the PDF',
    blurb:
      'If you are a signer, fill only your highlighted fields on the document, then bind with your wallet. Organizers skip this step.',
    privacyNote: 'You prove you hold these bytes - still no upload.',
  },
  {
    id: 'seal',
    label: 'Seal',
    verb: 'Lock on Nimiq',
    blurb: 'One Nimiq transaction anchors the fingerprint forever (seal fee applies).',
    privacyNote: 'The chain stores a hash string - never the document.',
  },
  {
    id: 'verify',
    label: 'Verify',
    verb: 'Check anytime',
    blurb: 'Anyone can drop a PDF copy and prove it still matches.',
    privacyNote: 'Verification needs no wallet and never uploads the file.',
  },
]

/**
 * Invited signer path. Login is required to submit a signature, not a rail step.
 */
export const SIGNER_STAGES: JourneyStage[] = [
  {
    id: 'sign',
    label: 'Complete',
    verb: 'Match PDF & complete your fields',
    blurb:
      'Drop the PDF the creator sent you, confirm it matches, fill your fields on the document, then bind with your wallet.',
    privacyNote: 'You prove you hold the same file — it never uploads.',
  },
  {
    id: 'done',
    label: 'Done',
    verb: 'Thanks — you are done',
    blurb:
      'Your fields and wallet signature are recorded. The creator seals the agreement on Nimiq when everyone has finished. You can close this page.',
    privacyNote: 'Keep your PDF. Anyone can re-check the fingerprint later.',
  },
]

/** Verifier path: local fingerprint lookup only. */
export const VERIFIER_STAGES: JourneyStage[] = [
  {
    id: 'verify',
    label: 'Verify',
    verb: 'Check a PDF anytime',
    blurb: 'Drop a copy of a sealed document to prove its fingerprint still matches on-chain.',
    privacyNote: 'Verification needs no wallet and never uploads the file.',
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
    // Only a real signature record counts as signed — never party status alone.
    const signed = Boolean(sig)
    return {
      id: p.id,
      roleLabel: partyLabel(p),
      // Server nulls displayName for non-participants
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
 * Prefer signature rows (signerAddress) — party.walletAddress may still be null
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
