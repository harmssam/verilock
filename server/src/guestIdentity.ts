/**
 * Guest identity helpers (pure, no DB access).
 *
 * Guest signing lets a document creator/signer act without a Nimiq wallet.
 * Guest subjects are deliberately NOT valid Nimiq address shapes -
 * `isValidNimiqAddressShape` (`documents.ts` / `placementPlans.ts`) already
 * rejects them since it requires the `NQ` prefix + fixed-length pattern.
 * This module is the single source of truth for guest subject strings so
 * call sites never hand-roll the `guest:doc:` / `guest:party:` prefixes.
 *
 * See `docs/guest-signing-plan.md` for the full guest-signing design.
 */
import { createHash, randomBytes } from 'node:crypto'

export const GUEST_DOC_PREFIX = 'guest:doc:'
export const GUEST_PARTY_PREFIX = 'guest:party:'

/** Sentinel `creator_address` / viewer subject for a guest-created document. */
export function guestCreatorSubject(documentId: string): string {
  return `${GUEST_DOC_PREFIX}${documentId}`
}

/** Sentinel `signer_address` / viewer subject for a guest co-signer party. */
export function guestPartySubject(partyId: string): string {
  return `${GUEST_PARTY_PREFIX}${partyId}`
}

export function isGuestCreatorSubject(s: string): boolean {
  return s.startsWith(GUEST_DOC_PREFIX)
}

export function isGuestPartySubject(s: string): boolean {
  return s.startsWith(GUEST_PARTY_PREFIX)
}

export function isGuestSubject(s: string): boolean {
  return isGuestCreatorSubject(s) || isGuestPartySubject(s)
}

/** SHA-256 hex digest - used to store guest document keys / session tokens hash-only. */
export function hashGuestSecret(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Mints a high-entropy raw secret (32 bytes, base64url - ~256 bits).
 * Used for BOTH the document key (organizer capability secret) and guest
 * session bearer tokens. Callers store `hashGuestSecret(raw)` only.
 */
export function mintGuestSecretRaw(): string {
  return randomBytes(32).toString('base64url')
}
