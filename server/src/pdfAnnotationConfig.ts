/**
 * PDF annotation lab + Nimiq stream — parallel to the seal product path.
 * Seal (attestations, credits, DocumentJourney) never depends on these flags.
 *
 * PDF_ANNOTATION_UI — serve /pdf SPA + stream APIs (default: on)
 * ANNOTATION_STREAM_BROADCAST — multi-tx on-chain publish (prod: explicit true)
 */
import { isAnnotationStreamBroadcastEnabled } from './annotationStream.js'
import { isServiceWalletConfigured } from './serviceWallet.js'

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw == null || raw === '') return fallback
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true
  return fallback
}

/** Lab UI + reconstruct/pack APIs. Independent of seal. Default on. */
export function isPdfAnnotationUiEnabled(): boolean {
  return envFlag('PDF_ANNOTATION_UI', true)
}

export function pdfAnnotationFeaturesPublic(): {
  pdfAnnotationUi: boolean
  annotationStreamBroadcast: boolean
  annotationStreamServiceWallet: boolean
} {
  return {
    pdfAnnotationUi: isPdfAnnotationUiEnabled(),
    annotationStreamBroadcast: isAnnotationStreamBroadcastEnabled(),
    annotationStreamServiceWallet: isServiceWalletConfigured(),
  }
}
