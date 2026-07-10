import { v4 as uuid } from 'uuid'
import {
  captureCreditReservation,
  releaseCreditReservation,
} from './credits.js'
import {
  createAttestation,
  getAttestationByTxHash,
  getAttestationForDocument,
  getCreditReservation,
  getDocumentById,
  getPendingAttestations,
  lockDocument,
  replaceAttestationForDocument,
  updateAttestation,
  updateDocumentStatus,
  type AttestationRecord,
} from './db.js'
import { assertDocumentCreator } from './documents.js'
import {
  buildAttestationPayload,
  isTransactionNotFoundError,
  normalizeTxHash,
  verifyAttestation,
} from './nimiq-rpc.js'
import { getServiceWalletAddress } from './serviceWallet.js'

const SKIP_CHAIN_VERIFY = process.env.SKIP_CHAIN_VERIFY === 'true'
const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 180_000
/** Give Hub/client broadcasts more time — Albatross can lag public RPC briefly. */
const NOT_FOUND_FAIL_AFTER_MS = 90_000

const TX_NOT_ON_CHAIN_MESSAGE_HUB =
  'Seal transaction was not found on the Nimiq blockchain. Tap Retry seal to sign again in Hub.'
const TX_NOT_ON_CHAIN_MESSAGE_CREDIT =
  'Credit seal proof was not found on the Nimiq blockchain yet. Tap Retry seal — your credit is returned if the proof never lands.'

export type AttestationResult =
  | { status: 'confirmed'; txHash: string; blockNumber?: number; payload: string }
  | { status: 'pending'; txHash: string; message: string }
  | { status: 'failed'; txHash: string; error: string }

function markAttestationFailed(txHash: string, error: string): AttestationResult {
  const att = getAttestationByTxHash(txHash)
  if (att) {
    updateAttestation(txHash, {
      status: 'failed',
      resolvedAt: Date.now(),
      error,
    })
    const doc = getDocumentById(att.documentId)
    if (doc?.status === 'locking') {
      updateDocumentStatus(att.documentId, 'ready_to_lock')
    }
    // Return prepaid credit if this was a credit-paid seal attempt.
    const reservation = getCreditReservation(att.documentId)
    if (reservation && reservation.status === 'held') {
      releaseCreditReservation(att.documentId, error)
    }
  }
  return { status: 'failed', txHash, error }
}

function isPendingError(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes('not found') ||
    lower.includes('pending') ||
    lower.includes('confirmations')
  )
}

export async function submitAttestation(
  documentId: string,
  txHash: string,
  senderAddress: string,
): Promise<AttestationResult> {
  const doc = assertDocumentCreator(documentId, senderAddress)
  if (!doc.finalSha256) throw new Error('Document not prepared for lock')
  if (doc.status !== 'ready_to_lock' && doc.status !== 'locking') {
    throw new Error('Document is not ready to lock')
  }

  const cleanHash = normalizeTxHash(txHash)
  const payload = buildAttestationPayload(documentId, doc.finalSha256)
  const now = Date.now()

  const existingByTx = getAttestationByTxHash(cleanHash)
  if (existingByTx) {
    if (existingByTx.documentId !== documentId) {
      throw new Error('Transaction already used')
    }
    return resolveAttestation(cleanHash)
  }

  const existingByDoc = getAttestationForDocument(documentId)
  if (existingByDoc) {
    if (existingByDoc.status === 'confirmed') {
      return resolveAttestation(existingByDoc.txHash)
    }
    if (existingByDoc.txHash === cleanHash) {
      return resolveAttestation(cleanHash)
    }
    const otherTx = getAttestationByTxHash(cleanHash)
    if (otherTx && otherTx.documentId !== documentId) {
      throw new Error('Transaction already used')
    }
    replaceAttestationForDocument(documentId, {
      txHash: cleanHash,
      senderAddress,
      payload,
      finalSha256: doc.finalSha256,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      error: null,
    })
    return resolveAttestation(cleanHash)
  }

  try {
    createAttestation({
      id: uuid(),
      documentId,
      txHash: cleanHash,
      senderAddress,
      payload,
      finalSha256: doc.finalSha256,
      blockNumber: null,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.toLowerCase().includes('unique constraint failed')) throw err
    const raced = getAttestationForDocument(documentId)
    if (!raced) throw err
    if (raced.txHash === cleanHash || raced.status === 'confirmed') {
      return resolveAttestation(raced.txHash)
    }
    replaceAttestationForDocument(documentId, {
      txHash: cleanHash,
      senderAddress,
      payload,
      finalSha256: doc.finalSha256,
      status: 'pending',
      createdAt: now,
      resolvedAt: null,
      error: null,
    })
  }

  return resolveAttestation(cleanHash)
}

export async function resolveAttestation(txHash: string): Promise<AttestationResult> {
  const att = getAttestationByTxHash(txHash)
  if (!att) throw new Error('Attestation not found')

  if (att.status === 'confirmed') {
    return {
      status: 'confirmed',
      txHash: att.txHash,
      blockNumber: att.blockNumber ?? undefined,
      payload: att.payload,
    }
  }

  if (att.status === 'failed') {
    return { status: 'failed', txHash: att.txHash, error: att.error ?? 'Attestation failed' }
  }

  const doc = getDocumentById(att.documentId)
  if (!doc) throw new Error('Document not found')

  try {
    if (SKIP_CHAIN_VERIFY) {
      updateAttestation(txHash, {
        status: 'confirmed',
        blockNumber: 1,
        resolvedAt: Date.now(),
        error: null,
      })
      lockDocument(att.documentId, Date.now())
      captureCreditReservation(att.documentId, txHash)
      return { status: 'confirmed', txHash, blockNumber: 1, payload: att.payload }
    }

    const creditRes = getCreditReservation(att.documentId)
    const paymentMode =
      creditRes && (creditRes.status === 'held' || creditRes.status === 'captured')
        ? 'credit'
        : 'auto'

    const { tx, paymentMode: resolvedMode } = await verifyAttestation(txHash, {
      senderAddress: att.senderAddress,
      docId: att.documentId,
      finalSha256: att.finalSha256,
      paymentMode,
      serviceWalletAddress: getServiceWalletAddress(),
    })

    updateAttestation(txHash, {
      status: 'confirmed',
      blockNumber: tx.blockNumber ?? null,
      resolvedAt: Date.now(),
      error: null,
    })
    lockDocument(att.documentId, Date.now())
    if (resolvedMode === 'credit') {
      captureCreditReservation(att.documentId, txHash)
    }

    return {
      status: 'confirmed',
      txHash,
      blockNumber: tx.blockNumber,
      payload: att.payload,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (isPendingError(message)) {
      if (isTransactionNotFoundError(message) && Date.now() - att.createdAt > NOT_FOUND_FAIL_AFTER_MS) {
        const creditRes = getCreditReservation(att.documentId)
        const isCredit =
          creditRes &&
          (creditRes.status === 'held' ||
            creditRes.status === 'captured' ||
            creditRes.serviceTxHash === att.txHash)
        return markAttestationFailed(
          txHash,
          isCredit ? TX_NOT_ON_CHAIN_MESSAGE_CREDIT : TX_NOT_ON_CHAIN_MESSAGE_HUB,
        )
      }
      return { status: 'pending', txHash, message }
    }
    return markAttestationFailed(txHash, message)
  }
}

export function getAttestationStatus(txHash: string): AttestationResult {
  const att = getAttestationByTxHash(txHash)
  if (!att) throw new Error('Attestation not found')
  if (att.status === 'confirmed') {
    return {
      status: 'confirmed',
      txHash: att.txHash,
      blockNumber: att.blockNumber ?? undefined,
      payload: att.payload,
    }
  }
  if (att.status === 'failed') {
    return { status: 'failed', txHash: att.txHash, error: att.error ?? 'Failed' }
  }
  return { status: 'pending', txHash: att.txHash, message: 'Waiting for confirmations' }
}

let pollerStarted = false

export function startAttestationPoller(): void {
  if (pollerStarted || SKIP_CHAIN_VERIFY) return
  pollerStarted = true

  setInterval(async () => {
    const pending = getPendingAttestations()
    const now = Date.now()
    for (const att of pending) {
      if (now - att.createdAt > POLL_TIMEOUT_MS) {
        markAttestationFailed(att.txHash, 'Confirmation timed out')
        continue
      }
      try {
        await resolveAttestation(att.txHash)
      } catch {
        // keep pending
      }
    }
  }, POLL_INTERVAL_MS)
}