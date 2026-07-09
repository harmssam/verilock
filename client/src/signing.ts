import { normalizeAddress, shortAddress } from './addresses'
import type { SealDocument, DocumentParty } from './types'

export type SigningResolution =
  | { ok: true; party: DocumentParty; reason: 'assigned' | 'open' }
  | { ok: false; message: string; hint?: 'already_signed' | 'wrong_wallet' | 'complete' | 'none' }

const PLACEHOLDER_PARTY_NAMES = new Set([
  'invited signer',
  'invited tenant',
  'invited landlord',
  'signer',
  'tenant',
  'landlord',
])

/** Matches "Invited signer", "Invited tenant 2", etc. */
const PLACEHOLDER_PARTY_NAME_RE =
  /^(invited\s+)?(signer|tenant|landlord)(\s+\d+)?$/i

export function isPlaceholderPartyName(name: string | null | undefined): boolean {
  // null/undefined: treat as needing a real name (or redacted for public viewers).
  if (name == null) return true
  const trimmed = name.trim().toLowerCase()
  return (
    !trimmed ||
    PLACEHOLDER_PARTY_NAMES.has(trimmed) ||
    PLACEHOLDER_PARTY_NAME_RE.test(trimmed)
  )
}

export function looksLikeAddressLabel(name: string | null | undefined): boolean {
  if (name == null) return false
  return /^NQ[1-9A-HJ-NP-Z]{2,}…[1-9A-HJ-NP-Z]{4}$/i.test(name.trim())
}

export function formatPartyRole(role: string): string {
  if (role === 'landlord' || role === 'tenant') return role
  if (role === 'creator') return 'agreement creator'
  return role
}

export function partyNeedsSignerName(party: DocumentParty): boolean {
  if (party.role === 'creator') return true
  return isPlaceholderPartyName(party.displayName) || looksLikeAddressLabel(party.displayName)
}

export function resolveSigningParty(
  doc: SealDocument,
  walletAddress: string,
): SigningResolution {
  const wallet = normalizeAddress(walletAddress)

  const existingSig = doc.signatures.find(sig => normalizeAddress(sig.signerAddress) === wallet)
  if (existingSig) {
    const signedParty = doc.parties.find(p => p.id === existingSig.partyId)
    const waiting = doc.signingProgress.signed < doc.signingProgress.required
    return {
      ok: false,
      hint: 'already_signed',
      message: waiting
        ? `You already signed as ${signedParty?.displayName ?? 'a party'}. Waiting for other signatures.`
        : 'You already signed. Sealing will start automatically once your wallet is connected.',
    }
  }

  const pending = doc.parties.filter(p => p.status === 'pending' && p.required)

  if (pending.length === 0) {
    return {
      ok: false,
      hint: 'complete',
      message:
        doc.signingProgress.readyToLock || doc.status === 'ready_to_lock'
          ? 'All signatures are in. Sealing on the blockchain will start automatically — approve the transaction in your wallet.'
          : 'No signatures are pending on this document.',
    }
  }

  const assigned = pending.find(
    p => p.walletAddress && normalizeAddress(p.walletAddress) === wallet,
  )
  if (assigned) {
    return { ok: true, party: assigned, reason: 'assigned' }
  }

  const open = pending.find(p => !p.walletAddress)
  if (open) {
    return { ok: true, party: open, reason: 'open' }
  }

  const waitingOn = pending
    .map(p => `${p.displayName} (${shortAddress(p.walletAddress!)})`)
    .join(', ')

  return {
    ok: false,
    hint: 'wrong_wallet',
    message: `This wallet is not assigned to sign. Still waiting on: ${waitingOn}. Connect with the wallet that created the agreement, or the invited signer.`,
  }
}