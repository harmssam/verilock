/**
 * Smoke test: guest subject helpers (mint/hash/classify).
 * Run from server/: node --import tsx scripts/test-guest-identity.mjs
 */
import {
  GUEST_DOC_PREFIX,
  GUEST_PARTY_PREFIX,
  guestCreatorSubject,
  guestPartySubject,
  hashGuestSecret,
  isGuestCreatorSubject,
  isGuestPartySubject,
  isGuestSubject,
  mintGuestSecretRaw,
} from '../src/guestIdentity.ts'

// mint: >= 128 bits of entropy -> 32 raw bytes -> base64url is at least 43 chars
const secretA = mintGuestSecretRaw()
const secretB = mintGuestSecretRaw()
if (secretA.length < 43) throw new Error(`mint too short: ${secretA.length} chars`)
if (secretA === secretB) throw new Error('mint produced duplicate secrets')
if (/[+/=]/.test(secretA)) throw new Error('mint did not use base64url alphabet')

// hash: deterministic sha256 hex
const hashA1 = hashGuestSecret(secretA)
const hashA2 = hashGuestSecret(secretA)
if (hashA1 !== hashA2) throw new Error('hash is not deterministic')
if (!/^[0-9a-f]{64}$/.test(hashA1)) throw new Error(`hash is not sha256 hex: ${hashA1}`)
if (hashGuestSecret(secretB) === hashA1) throw new Error('hash collided for distinct secrets')

// subject builders
const docId = 'doc-123'
const partyId = 'party-456'
if (guestCreatorSubject(docId) !== `${GUEST_DOC_PREFIX}${docId}`) {
  throw new Error('guestCreatorSubject mismatch')
}
if (guestPartySubject(partyId) !== `${GUEST_PARTY_PREFIX}${partyId}`) {
  throw new Error('guestPartySubject mismatch')
}

// classification: guest creator / guest party / real NQ address / empty string
const creatorSubject = guestCreatorSubject(docId)
const partySubject = guestPartySubject(partyId)
const walletAddress = 'NQ070000000000000000000000000000000000'
const empty = ''

if (!isGuestCreatorSubject(creatorSubject)) throw new Error('expected guest creator subject')
if (isGuestCreatorSubject(partySubject)) throw new Error('party subject misclassified as creator')
if (isGuestCreatorSubject(walletAddress)) throw new Error('wallet address misclassified as guest creator')
if (isGuestCreatorSubject(empty)) throw new Error('empty string misclassified as guest creator')

if (!isGuestPartySubject(partySubject)) throw new Error('expected guest party subject')
if (isGuestPartySubject(creatorSubject)) throw new Error('creator subject misclassified as party')
if (isGuestPartySubject(walletAddress)) throw new Error('wallet address misclassified as guest party')
if (isGuestPartySubject(empty)) throw new Error('empty string misclassified as guest party')

if (!isGuestSubject(creatorSubject)) throw new Error('expected isGuestSubject true for creator')
if (!isGuestSubject(partySubject)) throw new Error('expected isGuestSubject true for party')
if (isGuestSubject(walletAddress)) throw new Error('wallet address misclassified as guest')
if (isGuestSubject(empty)) throw new Error('empty string misclassified as guest')

console.log('OK')
