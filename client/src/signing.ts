import { normalizeAddress, shortAddress } from './addresses'
import type { SealDocument, DocumentParty } from './types'

export type SigningResolution =
  | { ok: true; party: DocumentParty; reason: 'assigned' | 'open' | 'preferred' }
  | {
      ok: false
      message: string
      hint?: 'already_signed' | 'wrong_wallet' | 'complete' | 'none' | 'pick_person'
      /** Open named slots the wallet may claim (name-only parties). */
      openParties?: DocumentParty[]
    }

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

export type ResolveSigningPartyOptions = {
  /**
   * When false, do not claim unassigned open party slots.
   * Used for document organizers who chose “not signing”.
   * Default true (invitees / normal co-signers can claim open slots).
   */
  allowOpenClaim?: boolean
  /**
   * Preferred party id from a per-person invite link (`?party=`).
   * When open and pending, that slot is selected without a picker.
   */
  preferredPartyId?: string | null
}

export function resolveSigningParty(
  doc: SealDocument,
  walletAddress: string,
  options?: ResolveSigningPartyOptions,
): SigningResolution {
  const wallet = normalizeAddress(walletAddress)
  const allowOpenClaim = options?.allowOpenClaim !== false
  const preferredPartyId = options?.preferredPartyId?.trim() || null

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

  // Pre-bound addresses that are not this wallet — do not offer them as open picks.
  const open = pending.filter(p => !p.walletAddress)

  if (!allowOpenClaim) {
    // Wallet is not assigned; maybe they were supposed to use a pre-bound address.
    const boundOthers = pending.filter(p => p.walletAddress)
    if (boundOthers.length > 0 && open.length === 0) {
      return {
        ok: false,
        hint: 'wrong_wallet',
        message: `This wallet is not assigned to sign. Still waiting on: ${boundOthers
          .map(p => `${p.displayName ?? 'party'} (${shortAddress(p.walletAddress!)})`)
          .join(', ')}.`,
      }
    }
    return {
      ok: false,
      hint: 'none',
      message:
        'You are organizing this agreement and are not a signer. Share the invite so each person can sign their own fields.',
    }
  }

  // Per-person invite URL: ?party=<id>
  if (preferredPartyId) {
    const preferred = pending.find(p => p.id === preferredPartyId)
    if (preferred) {
      if (preferred.walletAddress) {
        if (normalizeAddress(preferred.walletAddress) === wallet) {
          return { ok: true, party: preferred, reason: 'assigned' }
        }
        return {
          ok: false,
          hint: 'wrong_wallet',
          message: `This invite is for ${preferred.displayName ?? 'a specific person'} and wallet ${shortAddress(preferred.walletAddress)}. Connect that wallet to continue.`,
        }
      }
      // Name-only (or unbound) slot — claim this preferred party
      return { ok: true, party: preferred, reason: 'preferred' }
    }
  }

  if (open.length === 0) {
    const waitingOn = pending
      .filter(p => p.walletAddress)
      .map(p => `${p.displayName ?? 'party'} (${shortAddress(p.walletAddress!)})`)
      .join(', ')
    return {
      ok: false,
      hint: 'wrong_wallet',
      message: waitingOn
        ? `This wallet is not assigned to sign. Still waiting on: ${waitingOn}.`
        : 'No open signing slots remain for this wallet.',
    }
  }

  // Single open name-only slot — claim it directly
  if (open.length === 1) {
    return { ok: true, party: open[0]!, reason: 'open' }
  }

  // Multiple open name-only parties — invitee must pick who they are
  return {
    ok: false,
    hint: 'pick_person',
    message: 'Choose which person you are signing as.',
    openParties: open,
  }
}
