export type AppScreen = 'home' | 'agreements' | 'create' | 'document' | 'verify' | 'pricing' | 'privacy'

export interface DocumentParty {
  id: string
  role: string
  displayName: string
  walletAddress: string | null
  required: boolean
  status: 'pending' | 'signed' | 'declined'
  signedAt: number | null
}

export interface DocumentSignature {
  id: string
  partyId: string
  signerAddress: string
  signatureType: string
  signedAt: number
  imageUrl?: string | null
  /** True when an ink image exists but may be redacted for this viewer. */
  hasImage?: boolean
}

export interface DocumentAttestation {
  txHash: string
  status: string
  blockNumber: number | null
  payload: string
  explorerUrl: string
}

export interface RentalMetadata {
  propertyAddress?: string
  monthlyRent?: string
  deposit?: string
  startDate?: string
  endDate?: string
}

export interface NotesMetadata {
  notes?: string
}

export type DocumentMetadata = RentalMetadata | NotesMetadata

export const DOCUMENT_TYPES = ['rental', 'contract', 'nda', 'other'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export function documentTypeUsesNotes(type: string): boolean {
  return type === 'nda' || type === 'other'
}

const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  rental: 'Rental',
  contract: 'Contract',
  nda: 'NDA',
  other: 'Other',
}

export function documentTypeLabel(type: string): string {
  if ((DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return DOCUMENT_TYPE_LABELS[type as DocumentType]
  }
  return type.charAt(0).toUpperCase() + type.slice(1)
}

/** PDF overlay annotation stored with the document (no PDF bytes). */
export type DocumentAnnotation =
  | {
      id: string
      type: 'signature'
      pageIndex: number
      x: number
      y: number
      width: number
      height: number
      imageDataUrl: string
      /** RDP-simplified vector ink (preferred for reconstruction / future chain). */
      path?: {
        epsilon: number
        lineWidthRatio: number
        strokes: Array<{ points: Array<{ x: number; y: number }> }>
      }
      pageWidthPts?: number
      pageHeightPts?: number
    }
  | {
      id: string
      type: 'text'
      pageIndex: number
      x: number
      y: number
      width: number
      height: number
      text: string
      fontSizeRatio?: number
      color?: string
      pageWidthPts?: number
      pageHeightPts?: number
    }
  | {
      id: string
      type: 'checkmark' | 'cross'
      pageIndex: number
      x: number
      y: number
      width: number
      height: number
      color?: string
      pageWidthPts?: number
      pageHeightPts?: number
    }

export interface SealDocument {
  id: string
  slug: string
  title: string
  originalFilename: string | null
  type: string
  status: string
  creatorAddress: string
  originalSha256: string
  finalSha256: string | null
  pageCount: number
  metadata: Record<string, unknown> | null
  /**
   * Client PDF annotations for reconstruction (null/omitted when none).
   * Server never stores the PDF file — only hash + these overlays.
   */
  annotations?: DocumentAnnotation[] | null
  createdAt: number
  lockedAt: number | null
  requiredSignatures: number
  parties: DocumentParty[]
  signatures: DocumentSignature[]
  signingProgress: {
    signed: number
    required: number
    readyToLock: boolean
  }
  attestation: DocumentAttestation | null
  shareUrl: string
  verifyUrl: string
  /**
   * Server-side: true when this response includes display names + signature images
   * (viewer is creator or a signee). Omitted/false for public viewers.
   */
  participantDetailsRevealed?: boolean
}

export interface AttestationStatus {
  status: 'pending' | 'confirmed' | 'failed'
  txHash: string
  blockNumber?: number
  payload?: string
  message?: string
  error?: string
}

export interface VerifyHashMatch {
  id: string
  slug: string
  title: string
  originalFilename: string | null
  status: string
  finalSha256: string | null
  lockedAt: number | null
  createdAt: number
}

export interface VerifyResult {
  id: string
  slug: string
  title: string
  originalFilename: string | null
  type: string
  status: string
  creatorAddress: string
  originalSha256: string
  finalSha256: string | null
  metadata: Record<string, unknown> | null
  createdAt: number
  lockedAt: number | null
  attestation: DocumentAttestation | null
  signatures: DocumentSignature[]
  parties: DocumentParty[]
  participantDetailsRevealed?: boolean
}