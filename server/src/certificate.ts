import { getAttestationForDocument, getDocumentById, getDocumentBySlug } from './db.js'
import { publicDocument } from './documents.js'
import { buildNimiqExplorerUrl } from './explorer.js'

export function buildCertificate(idOrSlug: string) {
  const doc = getDocumentById(idOrSlug) ?? getDocumentBySlug(idOrSlug)
  if (!doc) return null

  const publicDoc = publicDocument(doc)
  const attestation = getAttestationForDocument(doc.id)

  return {
    v: 1,
    app: 'verilock',
    documentId: doc.id,
    slug: doc.slug,
    title: doc.title,
    originalFilename: doc.originalFilename,
    type: doc.type,
    status: doc.status,
    originalSha256: doc.originalSha256,
    finalSha256: doc.finalSha256,
    metadata: doc.metadata,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
    parties: publicDoc.parties,
    signatures: publicDoc.signatures,
    attestation: attestation
      ? {
          txHash: attestation.txHash,
          payload: attestation.payload,
          blockNumber: attestation.blockNumber,
          senderAddress: attestation.senderAddress,
          status: attestation.status,
          explorerUrl: buildNimiqExplorerUrl(attestation.txHash),
        }
      : null,
    verifyUrl: `/v/${doc.slug}`,
    generatedAt: new Date().toISOString(),
  }
}