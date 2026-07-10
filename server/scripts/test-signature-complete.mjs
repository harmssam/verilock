/**
 * Ensures ready-to-lock requires real signature rows, not party status alone.
 * Run: node --import tsx scripts/test-signature-complete.mjs
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'verilock-sig-complete-'))
process.env.DATA_DIR = dataDir
process.env.DATABASE_PATH = join(dataDir, 'test.db')
process.env.SKIP_CHAIN_VERIFY = '1'

const { createDocument, addSignature, publicDocument, prepareLock } = await import(
  '../src/documents.ts'
)
const { getDocumentById, markPartySigned, getPartiesForDocument } = await import('../src/db.ts')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const walletA = 'NQ05 CREATORWALLET000000000000000000000'
const walletB = 'NQ06 TENANTWALLET0000000000000000000000'
const hash = randomBytes(32).toString('hex')

const { document: created } = createDocument({
  title: 'Two party lease',
  type: 'rental',
  creatorAddress: walletA,
  creatorRole: 'landlord',
  creatorDisplayName: 'Landlord Name',
  originalSha256: hash,
  pageCount: 1,
  requiredSignatures: 2,
  parties: [{ role: 'tenant', displayName: 'Tim Wallace', required: true }],
})

const docId = created.id
const parties = getPartiesForDocument(docId)
const landlord = parties.find(p => p.role === 'landlord')
const tenant = parties.find(p => p.role === 'tenant')
assert(landlord && tenant, 'expected landlord + tenant parties')

// Corrupt state: mark tenant signed without a signature row (the bug we hit in UI).
markPartySigned(tenant.id)

let pub = publicDocument(getDocumentById(docId), { viewerAddress: walletA })
assert(pub.signatures.length === 0, 'no signatures yet')
assert(pub.signingProgress.signed === 0, `signed should be 0, got ${pub.signingProgress.signed}`)
assert(pub.signingProgress.required === 2, 'required should be 2')
assert(pub.signingProgress.readyToLock === false, 'must not be ready with 0 real signatures')
assert(
  pub.parties.find(p => p.id === tenant.id)?.status === 'pending',
  'orphan signed status must be repaired to pending',
)

// Creator signs only
pub = addSignature({
  documentId: docId,
  partyId: landlord.id,
  signerAddress: walletA,
  signatureType: 'drawn',
  clientSha256: hash,
  displayName: 'Landlord Name',
})

assert(pub.signatures.length === 1, 'one signature recorded')
assert(pub.signingProgress.signed === 1, `signed should be 1, got ${pub.signingProgress.signed}`)
assert(pub.signingProgress.readyToLock === false, 'must not ready with 1 of 2 signatures')

let prepareThrew = false
try {
  prepareLock(docId, hash, walletA)
} catch (err) {
  prepareThrew = true
  assert(
    /signature/i.test(err instanceof Error ? err.message : String(err)),
    `expected pending signature error, got ${err}`,
  )
}
assert(prepareThrew, 'prepareLock must reject incomplete collection')

// Tenant signs — now ready
pub = addSignature({
  documentId: docId,
  partyId: tenant.id,
  signerAddress: walletB,
  signatureType: 'drawn',
  clientSha256: hash,
  displayName: 'Tim Wallace',
})

assert(pub.signatures.length === 2, 'two signatures recorded')
assert(pub.signingProgress.signed === 2, 'signed should be 2')
assert(pub.signingProgress.readyToLock === true, 'ready after both signatures')

const prepared = prepareLock(docId, hash, walletA)
assert(prepared.document.signingProgress.readyToLock === true, 'prepareLock succeeds when complete')

rmSync(dataDir, { recursive: true, force: true })
console.log('ok: signature-complete guards pass')
