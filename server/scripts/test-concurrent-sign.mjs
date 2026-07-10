/**
 * Concurrent multi-party sign regression:
 * two wallets both prefer the first open party slot; both must succeed on distinct parties.
 *
 * Usage (from server/):
 *   node --import tsx scripts/test-concurrent-sign.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const dataDir = mkdtempSync(join(tmpdir(), 'verilock-sign-'))
process.env.DATABASE_PATH = join(dataDir, 'test.db')
process.env.DATA_DIR = dataDir

const { createDocument, addSignature, getDocumentPublic } = await import('../src/documents.ts')

const HASH = randomBytes(32).toString('hex')
const CREATOR = 'NQ01 CREATORWALLET000000000000000000000'
const TENANT_A = 'NQ02 TENANTONEWALLET00000000000000000000'
const TENANT_B = 'NQ03 TENANTTWOWALLET00000000000000000000'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const { document: created } = createDocument({
  title: 'Concurrent lease',
  type: 'other',
  creatorAddress: CREATOR,
  creatorRole: 'creator',
  creatorDisplayName: 'Creator',
  originalSha256: HASH,
  pageCount: 1,
  requiredSignatures: 3,
})

const openParties = created.parties.filter(p => !p.walletAddress)
assert(openParties.length === 2, `expected 2 open parties, got ${openParties.length}`)
const preferredSlot = openParties[0].id

// Both signers race for the same preferred open slot.
const results = await Promise.allSettled([
  Promise.resolve().then(() =>
    addSignature({
      documentId: created.id,
      partyId: preferredSlot,
      signerAddress: TENANT_A,
      signatureType: 'typed',
      clientSha256: HASH,
      displayName: 'Tenant A',
    }),
  ),
  Promise.resolve().then(() =>
    addSignature({
      documentId: created.id,
      partyId: preferredSlot,
      signerAddress: TENANT_B,
      signatureType: 'typed',
      clientSha256: HASH,
      displayName: 'Tenant B',
    }),
  ),
])

const fulfilled = results.filter(r => r.status === 'fulfilled')
const rejected = results.filter(r => r.status === 'rejected')

assert(
  fulfilled.length === 2,
  `expected both concurrent signs to succeed, got ${fulfilled.length} ok / ${rejected.length} failed: ${rejected
    .map(r => r.reason?.message ?? r.reason)
    .join('; ')}`,
)

// Creator viewer so names are not redacted for assertions.
const finalDoc = getDocumentPublic(created.id, CREATOR)
assert(finalDoc, 'document missing')
assert(finalDoc.signatures.length === 2, `expected 2 signatures, got ${finalDoc.signatures.length}`)

const partyIds = new Set(finalDoc.signatures.map(s => s.partyId))
assert(partyIds.size === 2, 'both signatures must map to distinct parties')

const norm = a => a.replace(/\s+/g, '').toUpperCase()
const signers = new Set(finalDoc.signatures.map(s => norm(s.signerAddress)))
assert(signers.has(norm(TENANT_A)), 'tenant A missing')
assert(signers.has(norm(TENANT_B)), 'tenant B missing')

const names = new Set(finalDoc.parties.filter(p => p.status === 'signed').map(p => p.displayName))
assert(names.has('Tenant A'), `expected Tenant A display name, got ${[...names].join(', ')}`)
assert(names.has('Tenant B'), `expected Tenant B display name, got ${[...names].join(', ')}`)

// No open slots left — third wallet must fail cleanly
let thirdFailed = false
try {
  addSignature({
    documentId: created.id,
    partyId: preferredSlot,
    signerAddress: 'NQ04 THIRDWALLET00000000000000000000000',
    signatureType: 'typed',
    clientSha256: HASH,
    displayName: 'Tenant C',
  })
} catch {
  thirdFailed = true
}
assert(thirdFailed, 'third concurrent open claim should fail when no slots remain')

// Double-sign same wallet must fail
let doubleFailed = false
try {
  addSignature({
    documentId: created.id,
    partyId: preferredSlot,
    signerAddress: TENANT_A,
    signatureType: 'typed',
    clientSha256: HASH,
    displayName: 'Tenant A again',
  })
} catch {
  doubleFailed = true
}
assert(doubleFailed, 'same wallet must not sign twice')

console.log('ok: concurrent multi-party sign assigns distinct parties atomically')
console.log(
  JSON.stringify(
    {
      signed: finalDoc.signingProgress.signed,
      required: finalDoc.signingProgress.required,
      parties: finalDoc.parties.map(p => ({
        role: p.role,
        status: p.status,
        wallet: p.walletAddress,
        name: p.displayName,
      })),
    },
    null,
    2,
  ),
)

rmSync(dataDir, { recursive: true, force: true })
