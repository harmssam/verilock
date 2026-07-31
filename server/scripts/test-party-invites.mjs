/**
 * Personal invite tokens: mint (hash-only), email-gate claim, email on signature.
 * Run: node --import tsx scripts/test-party-invites.mjs
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'verilock-party-invites-'))
process.env.DATA_DIR = dataDir
process.env.DATABASE_PATH = join(dataDir, 'test.db')
process.env.SKIP_CHAIN_VERIFY = '1'

const {
  createDocument,
  addSignature,
  publicDocument,
  hashInviteToken,
  mintInviteTokenRaw,
} = await import('../src/documents.ts')
const {
  getPartiesForDocument,
  getActiveInviteForParty,
  getPartyInviteByTokenHash,
  insertPartyInvite,
  revokeActivePartyInvites,
  setPartyInviteEmail,
  getSignaturesForDocument,
} = await import('../src/db.ts')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const walletA = 'NQ05 CREATORWALLET000000000000000000000'
const walletB = 'NQ06 TENANTWALLET0000000000000000000000'
const walletC = 'NQ07 OTHERWALLET00000000000000000000000'
const hash = randomBytes(32).toString('hex')

const { document: created } = createDocument({
  title: 'Invite gated lease',
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
const tenant = parties.find(p => p.role === 'tenant')
assert(tenant, 'tenant party exists')

// --- mint invite (simulates post-Resend success path) ---
const rawToken = mintInviteTokenRaw()
const tokenHash = hashInviteToken(rawToken)
assert(tokenHash === createHash('sha256').update(rawToken, 'utf8').digest('hex'), 'hash matches')
assert(!tokenHash.includes(rawToken.slice(0, 8)), 'hash is not raw prefix')

const inviteId = crypto.randomUUID()
const sentAt = Date.now()
insertPartyInvite({
  id: inviteId,
  documentId: docId,
  partyId: tenant.id,
  email: 'tenant@example.com',
  tokenHash,
  channel: 'email',
  createdAt: sentAt,
  expiresAt: null,
  revokedAt: null,
  redeemedAt: null,
  redeemedByWallet: null,
  resendMessageId: 'msg_test',
})
setPartyInviteEmail(tenant.id, 'tenant@example.com', sentAt)

const active = getActiveInviteForParty(tenant.id)
assert(active && active.id === inviteId, 'active invite present')
assert(getPartyInviteByTokenHash(tokenHash)?.id === inviteId, 'lookup by hash works')
assert(getPartyInviteByTokenHash(hashInviteToken('wrong-token')) === null, 'wrong token misses')

// Creator sees invite email; anonymous does not
const asCreator = publicDocument(
  (await import('../src/db.ts')).getDocumentById(docId),
  { viewerAddress: walletA },
)
const tenantPub = asCreator.parties.find(p => p.id === tenant.id)
assert(tenantPub.inviteEmail === 'tenant@example.com', 'creator sees invite email')
assert(tenantPub.inviteSentAt === sentAt, 'creator sees inviteSentAt')

const asAnon = publicDocument((await import('../src/db.ts')).getDocumentById(docId), {})
const tenantAnon = asAnon.parties.find(p => p.id === tenant.id)
assert(tenantAnon.inviteEmail == null, 'anon does not see invite email')
// Open unclaimed slots keep display names so invitees can pick “Who are you?”
assert(
  tenantAnon.displayName === 'Tim Wallace',
  `open claim slot name visible to anon, got: ${tenantAnon.displayName}`,
)
const landlordAnon = asAnon.parties.find(p => p.role === 'landlord')
// Creator slot is wallet-bound — not an open claim slot; name stays private for non-participants.
assert(
  landlordAnon.displayName == null,
  `wallet-bound party name redacted for anon, got: ${landlordAnon.displayName}`,
)

// Sign without token must fail while invite is active
let failed = false
try {
  addSignature({
    documentId: docId,
    partyId: tenant.id,
    signerAddress: walletB,
    signatureType: 'typed',
    clientSha256: hash,
    displayName: 'Tim Wallace',
  })
} catch (err) {
  failed = true
  assert(
    /personal invite link/i.test(err.message),
    `expected invite error, got: ${err.message}`,
  )
}
assert(failed, 'sign without invite token fails')

// Sign with valid token succeeds and freezes email on signature
const signed = addSignature({
  documentId: docId,
  partyId: tenant.id,
  signerAddress: walletB,
  signatureType: 'typed',
  clientSha256: hash,
  displayName: 'Tim Wallace',
  inviteToken: rawToken,
})
const sigs = getSignaturesForDocument(docId)
const tenantSig = sigs.find(s => s.partyId === tenant.id)
assert(tenantSig, 'signature row exists')
assert(tenantSig.invitedAsEmail === 'tenant@example.com', 'invitedAsEmail frozen')
assert(tenantSig.inviteId === inviteId, 'invite_id set')
assert(getActiveInviteForParty(tenant.id) === null, 'invite redeemed (no longer active)')

const signedPub = signed.signatures.find(s => s.partyId === tenant.id)
assert(signedPub?.invitedAsEmail === 'tenant@example.com', 'public signature shows email to participant')

// Open claim still works on a party without invite
const { document: openDoc } = createDocument({
  title: 'Open claim lease',
  type: 'rental',
  creatorAddress: walletA,
  creatorRole: 'landlord',
  creatorDisplayName: 'Landlord Name',
  originalSha256: randomBytes(32).toString('hex'),
  pageCount: 1,
  requiredSignatures: 2,
  parties: [{ role: 'tenant', displayName: 'Open Tenant', required: true }],
})
const openHash = (await import('../src/db.ts')).getDocumentById(openDoc.id).originalSha256
const openTenant = getPartiesForDocument(openDoc.id).find(p => p.role === 'tenant')
addSignature({
  documentId: openDoc.id,
  partyId: openTenant.id,
  signerAddress: walletC,
  signatureType: 'typed',
  clientSha256: openHash,
  displayName: 'Open Tenant',
})
assert(
  getSignaturesForDocument(openDoc.id).some(s => s.partyId === openTenant.id),
  'open claim without invite works',
)

// Resend rotates: old token dies
const { document: rotateDoc } = createDocument({
  title: 'Rotate invite',
  type: 'rental',
  creatorAddress: walletA,
  creatorRole: 'landlord',
  creatorDisplayName: 'Landlord Name',
  originalSha256: randomBytes(32).toString('hex'),
  pageCount: 1,
  requiredSignatures: 2,
  parties: [{ role: 'tenant', displayName: 'Rotate Tenant', required: true }],
})
const rotateTenant = getPartiesForDocument(rotateDoc.id).find(p => p.role === 'tenant')
const oldRaw = mintInviteTokenRaw()
const oldId = crypto.randomUUID()
insertPartyInvite({
  id: oldId,
  documentId: rotateDoc.id,
  partyId: rotateTenant.id,
  email: 'old@example.com',
  tokenHash: hashInviteToken(oldRaw),
  channel: 'email',
  createdAt: Date.now(),
  expiresAt: null,
  revokedAt: null,
  redeemedAt: null,
  redeemedByWallet: null,
  resendMessageId: null,
})
revokeActivePartyInvites(rotateTenant.id)
const newRaw = mintInviteTokenRaw()
const newId = crypto.randomUUID()
insertPartyInvite({
  id: newId,
  documentId: rotateDoc.id,
  partyId: rotateTenant.id,
  email: 'new@example.com',
  tokenHash: hashInviteToken(newRaw),
  channel: 'email',
  createdAt: Date.now(),
  expiresAt: null,
  revokedAt: null,
  redeemedAt: null,
  redeemedByWallet: null,
  resendMessageId: null,
})
assert(getPartyInviteByTokenHash(hashInviteToken(oldRaw)) === null, 'old token revoked')
assert(getActiveInviteForParty(rotateTenant.id)?.id === newId, 'new invite active')

console.log('test-party-invites: ok')
rmSync(dataDir, { recursive: true, force: true })
