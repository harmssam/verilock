import { isDocumentCreator } from './agreements'
import {
  loadSealInFlight,
  peekHubRedirectInUrl,
  saveSealInFlight,
  shouldResumeHubSeal,
  staleSealMessage,
} from './sealRecovery'
import type { SealDocument } from './types'

export function markSealRedirectStarted(input: {
  slug: string
  docId: string
  token: string
  address: string
}): void {
  saveSealInFlight(input)
}

export function hasActiveSealRecovery(): boolean {
  return loadSealInFlight() !== null
}

export function sealFlowIsBlocked(): boolean {
  return peekHubRedirectInUrl() || hasActiveSealRecovery()
}

export function shouldShowStaleSealNotice(
  doc: SealDocument,
  busy: boolean,
  sealInFlight: boolean,
): boolean {
  const inFlight = loadSealInFlight()
  if (!inFlight || inFlight.slug !== doc.slug) return false
  if (busy || sealInFlight) return false
  if (peekHubRedirectInUrl()) return false
  // SealCard / lockError already surface failed or in-progress seal state.
  if (doc.attestation?.status === 'failed') return false
  if (doc.status === 'locking') return false
  return true
}

export function staleSealNoticeFor(doc: SealDocument): string {
  return staleSealMessage(doc.status)
}

export function shouldAutoStartSeal(input: {
  doc: SealDocument
  address: string
  busy: boolean
  sealInFlight: boolean
  alreadyAttempted: boolean
}): boolean {
  const { doc, address, busy, sealInFlight, alreadyAttempted } = input
  if (!isDocumentCreator(doc, address)) return false
  if (!doc.signingProgress.readyToLock) return false
  if (doc.status === 'locked' || doc.status === 'locking') return false
  if (doc.attestation?.status === 'failed') return false
  if (busy || sealInFlight) return false
  if (sealFlowIsBlocked()) return false
  if (alreadyAttempted) return false
  return true
}

export function resolveHubSealResumeSlug(
  pathname: string,
  sealInFlight: ReturnType<typeof loadSealInFlight>,
): string | null {
  if (!shouldResumeHubSeal() || !sealInFlight) return null
  const pathSlug = pathname.match(/^\/d\/([^/]+)/)?.[1]
  return pathSlug ?? sealInFlight.slug
}

export { shouldResumeHubSeal, peekHubRedirectInUrl, loadSealInFlight }