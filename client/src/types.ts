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
}

export interface AttestationStatus {
  status: 'pending' | 'confirmed' | 'failed'
  txHash: string
  blockNumber?: number
  payload?: string
  message?: string
  error?: string
}

export interface VerifyResult {
  title: string
  originalFilename: string | null
  status: string
  originalSha256: string
  finalSha256: string | null
  lockedAt: number | null
  attestation: DocumentAttestation | null
  signatures: DocumentSignature[]
  parties: DocumentParty[]
}