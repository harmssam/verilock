import { shortAddress } from '../addresses'
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

/** Creator path: full lifecycle from wallet → sealed proof. */
export const CREATOR_STAGES: JourneyStage[] = [
  {
    id: 'connect',
    label: 'Connect',
    verb: 'Prove who you are',
    blurb: 'Link your Nimiq wallet. Required to create, sign, or seal.',
    privacyNote: 'Wallet only proves identity - it never sees your PDF bytes.',
  },
  {
    id: 'fingerprint',
    label: 'Fingerprint',
    verb: 'Hash the PDF locally',
    blurb: 'Drop your agreement. We compute SHA-256 on this device only.',
    privacyNote: 'The file never uploads. Only the fingerprint is registered.',
  },
  {
    id: 'share',
    label: 'Share',
    verb: 'Invite co-signers',
    blurb: 'Send a link plus the same PDF out-of-band (email, AirDrop…).',
    privacyNote: 'You control the file. We only host the agreement record + link.',
  },
  {
    id: 'sign',
    label: 'Sign',
    verb: 'Everyone confirms',
    blurb: 'Each party re-fingerprints their copy, then signs with their wallet.',
    privacyNote: 'Signers prove they hold the same bytes - still no upload.',
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

/** Invited signer path: open invite / match PDF, then sign. No create/share/seal. */
export const SIGNER_STAGES: JourneyStage[] = [
  {
    id: 'connect',
    label: 'Connect',
    verb: 'Prove who you are',
    blurb: 'Connect the Nimiq wallet you will use to sign this agreement.',
    privacyNote: 'Wallet only proves identity - it never sees your PDF bytes.',
  },
  {
    id: 'sign',
    label: 'Sign',
    verb: 'Match PDF & sign',
    blurb: 'Drop the PDF the creator sent you, confirm it matches, then sign with your wallet.',
    privacyNote: 'You prove you hold the same bytes - the file never uploads.',
  },
  {
    id: 'done',
    label: 'Done',
    verb: 'You are all set',
    blurb: 'Your signature is recorded. When everyone has signed, the agreement is sealed on Nimiq.',
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
    return {
      id: p.id,
      roleLabel: partyLabel(p),
      displayName: p.displayName || null,
      signed: p.status === 'signed' || Boolean(sig),
      walletShort: p.walletAddress
        ? shortAddress(p.walletAddress)
        : sig
          ? shortAddress(sig.signerAddress)
          : null,
      hasInk: Boolean(sig?.imageUrl),
      walletAddress: p.walletAddress,
      required: p.required,
    }
  })

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
    readyToLock: doc.signingProgress.readyToLock || directSeal,
    requiredSignatures: doc.signingProgress.required,
    signedSignatures: doc.signingProgress.signed,
    status: doc.status,
    source: doc,
  }
}

export function signedCount(doc: JourneyDoc): number {
  return doc.signedSignatures || doc.parties.filter(p => p.signed).length
}

export function requiredCount(doc: JourneyDoc): number {
  return doc.requiredSignatures || doc.parties.length
}

export function allSigned(doc: JourneyDoc): boolean {
  if (doc.directSeal) return true
  return doc.readyToLock || signedCount(doc) >= requiredCount(doc)
}

export function nextUnsignedParty(doc: JourneyDoc): JourneyParty | null {
  return doc.parties.find(p => !p.signed && p.required) ?? null
}
