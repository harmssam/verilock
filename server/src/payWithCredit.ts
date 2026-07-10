import { v4 as uuid } from 'uuid'
import { normalizeAddress } from './addresses.js'
import {
  captureCreditReservation,
  releaseCreditReservation,
  reserveCreditForDocument,
  setReservationServiceTx,
} from './credits.js'
import { isCreditsEnabled } from './creditsConfig.js'
import {
  createAttestation,
  getAttestationForDocument,
  getDocumentById,
  replaceAttestationForDocument,
  updateDocumentStatus,
} from './db.js'
import { assertDocumentCreator, prepareLock } from './documents.js'
import { buildAttestationPayload } from './nimiq-rpc.js'
import {
  resolveAttestation,
  type AttestationResult,
} from './attestations.js'
import {
  broadcastCreditSealProof,
  getServiceWalletAddress,
  isServiceWalletConfigured,
} from './serviceWallet.js'

/**
 * Reserve 1 credit, broadcast minimal proof from service wallet, submit attestation.
 */
export async function payWithCreditAndSeal(
  documentId: string,
  creatorAddress: string,
  finalSha256?: string,
): Promise<AttestationResult & { balance: number }> {
  if (!isCreditsEnabled()) {
    throw new Error('Credits are not enabled')
  }
  if (!isServiceWalletConfigured()) {
    throw new Error('Service wallet is not configured for credit seals')
  }

  const address = normalizeAddress(creatorAddress)
  let doc = assertDocumentCreator(documentId, address)

  const hash = (finalSha256 ?? doc.finalSha256 ?? doc.originalSha256).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Valid finalSha256 required')
  }

  if (doc.status === 'locked') {
    const existing = getAttestationForDocument(documentId)
    if (existing?.status === 'confirmed') {
      const { getCreditBalance } = await import('./db.js')
      const resolved = await resolveAttestation(existing.txHash)
      return { ...resolved, balance: getCreditBalance(address) }
    }
    throw new Error('Document is already locked')
  }

  // Ensure prepared
  if (doc.status !== 'ready_to_lock' && doc.status !== 'locking') {
    prepareLock(documentId, hash, address)
    doc = getDocumentById(documentId)!
  } else if (!doc.finalSha256) {
    prepareLock(documentId, hash, address)
    doc = getDocumentById(documentId)!
  }

  const { balance, reservation } = reserveCreditForDocument(documentId, address)

  // Idempotent: if we already broadcast a service tx for this hold, resume
  if (reservation.serviceTxHash) {
    const result = await resolveAttestation(reservation.serviceTxHash)
    if (result.status === 'confirmed') {
      captureCreditReservation(documentId, reservation.serviceTxHash)
    }
    return { ...result, balance }
  }

  if (doc.status === 'ready_to_lock') {
    updateDocumentStatus(documentId, 'locking')
  }

  let txHash: string
  let senderAddress: string
  try {
    const broadcast = await broadcastCreditSealProof({
      documentId,
      finalSha256: hash,
    })
    txHash = broadcast.txHash
    senderAddress = broadcast.senderAddress
    setReservationServiceTx(documentId, txHash)
  } catch (err) {
    releaseCreditReservation(
      documentId,
      err instanceof Error ? err.message : 'Service wallet broadcast failed',
    )
    const fresh = getDocumentById(documentId)
    if (fresh?.status === 'locking') {
      updateDocumentStatus(documentId, 'ready_to_lock')
    }
    throw err
  }

  const payload = buildAttestationPayload(documentId, hash)
  const now = Date.now()
  const existing = getAttestationForDocument(documentId)

  try {
    if (existing) {
      if (existing.status === 'confirmed') {
        captureCreditReservation(documentId, existing.txHash)
        const resolved = await resolveAttestation(existing.txHash)
        return { ...resolved, balance }
      }
      replaceAttestationForDocument(documentId, {
        txHash,
        senderAddress,
        payload,
        finalSha256: hash,
        status: 'pending',
        createdAt: now,
        resolvedAt: null,
        error: null,
      })
    } else {
      createAttestation({
        id: uuid(),
        documentId,
        txHash,
        senderAddress,
        payload,
        finalSha256: hash,
        blockNumber: null,
        status: 'pending',
        createdAt: now,
        resolvedAt: null,
        error: null,
      })
    }
  } catch (err) {
    // If attestation row fails, still try resolve / release
    console.error('[credits] attestation row error', err)
  }

  const result = await resolveAttestation(txHash)
  if (result.status === 'confirmed') {
    captureCreditReservation(documentId, txHash)
  } else if (result.status === 'failed') {
    releaseCreditReservation(documentId, result.error)
  }

  return { ...result, balance }
}

export function serviceWalletReady(): boolean {
  return isServiceWalletConfigured() && Boolean(getServiceWalletAddress())
}
