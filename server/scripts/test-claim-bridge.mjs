/**
 * Real boot + HTTP smoke test for Task 6 (wallet claim + lock bridge).
 * Boots the actual Express server (src/index.ts) as a child process against a
 * throwaway sqlite data dir, then exercises the claim route end-to-end over HTTP.
 *
 * Usage (from server/):
 *   node --import tsx scripts/test-claim-bridge.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const dataDir = mkdtempSync(join(tmpdir(), 'verilock-claim-'))
const PORT = 3902
const BASE = `http://127.0.0.1:${PORT}`

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok: ${msg}`)
}

function randHash() {
  return randomBytes(32).toString('hex')
}

async function j(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* empty body */
  }
  return { status: res.status, body: json }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/features`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('server did not come up in time')
}

async function walletSession(address) {
  const challenge = await j('POST', '/api/auth/challenge', { address })
  assert(challenge.status === 200, `challenge for ${address}`)
  const token = challenge.body.token
  const verify = await j(
    'POST',
    '/api/auth/verify',
    { publicKey: 'deadbeef', signature: 'deadbeef', authScheme: 'pay' },
    token,
  )
  assert(verify.status === 200 && verify.body.verified, `verify for ${address}`)
  return token
}

async function createGuestDoc({ requiredSignatures = 2 } = {}) {
  const res = await j('POST', '/api/documents/guest', {
    title: 'Guest lease',
    type: 'rental',
    creatorDisplayName: 'Guest Creator',
    originalSha256: randHash(),
    pageCount: 1,
    requiredSignatures,
  })
  assert(res.status === 201, `guest doc created (${JSON.stringify(res.body?.error ?? '')})`)
  return res.body
}

async function main() {
  console.log(`data dir: ${dataDir}`)
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'src/index.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(PORT),
        DATA_DIR: dataDir,
        DATABASE_PATH: join(dataDir, 'test.db'),
        GUEST_SIGNING: 'true',
        SKIP_CHAIN_VERIFY: 'true',
        TURNSTILE_REQUIRED: 'false',
        NODE_ENV: 'development',
        CORS_ORIGIN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  child.stdout.on('data', d => process.stdout.write(`[server] ${d}`))
  child.stderr.on('data', d => process.stderr.write(`[server:err] ${d}`))

  let exited = false
  child.on('exit', code => {
    exited = true
    if (code !== 0 && code !== null) {
      console.error(`server exited early with code ${code}`)
    }
  })

  try {
    await waitForServer()
    if (exited) throw new Error('server exited before becoming ready')

    // (a) Create a guest doc; note documentKey + creator guest session token.
    const docA = await createGuestDoc()
    const documentKeyA = docA.documentKey
    const guestTokenA = docA.guestSession.token
    assert(typeof documentKeyA === 'string' && documentKeyA.length > 0, '(a) documentKey present')
    assert(typeof guestTokenA === 'string' && guestTokenA.length > 0, '(a) creator guest session token present')
    assert(docA.document.authMode === 'guest', '(a) doc authMode is guest')

    // (b) Wallet challenge/verify for a fresh test address.
    const walletC = 'NQ07 CLAIMERWALLETONE0000000000000000000'
    const tokenC = await walletSession(walletC)

    // (c) Claim doc A using guestSessionToken only (no documentKey).
    const claimC = await j(
      'POST',
      `/api/documents/${docA.document.id}/claim`,
      { guestSessionToken: guestTokenA },
      tokenC,
    )
    assert(claimC.status === 200, `(c) claim via guestSessionToken succeeds (${JSON.stringify(claimC.body)})`)
    assert(claimC.body.document.authMode === 'claimed', '(c) authMode is claimed')
    const normC = s => s.replace(/\s+/g, '').toUpperCase()
    assert(
      normC(claimC.body.document.creatorAddress) === normC(walletC),
      '(c) creatorAddress now equals claiming wallet (normalized)',
    )

    // (d) Second fresh guest doc; claim via documentKey with a DIFFERENT wallet.
    const docD = await createGuestDoc()
    const walletD = 'NQ08 CLAIMERWALLETTWOZ000000000000000000'
    const tokenD = await walletSession(walletD)
    const claimD = await j(
      'POST',
      `/api/documents/${docD.document.id}/claim`,
      { documentKey: docD.documentKey },
      tokenD,
    )
    assert(claimD.status === 200, `(d) claim via documentKey succeeds (${JSON.stringify(claimD.body)})`)
    assert(claimD.body.document.authMode === 'claimed', '(d) authMode is claimed')

    // (e) Try to claim doc (c)/A AGAIN with a different wallet -> 409 already claimed.
    const walletE = 'NQ09 CLAIMERWALLETTHREE00000000000000000'
    const tokenE = await walletSession(walletE)
    const claimE = await j(
      'POST',
      `/api/documents/${docA.document.id}/claim`,
      { documentKey: documentKeyA },
      tokenE,
    )
    assert(claimE.status === 409, `(e) second claim attempt on already-claimed doc -> 409 (got ${claimE.status})`)
    assert(
      /already been claimed|already claimed/i.test(claimE.body?.error ?? ''),
      `(e) error message mentions already claimed (got "${claimE.body?.error}")`,
    )

    // (f) Try to claim a wallet-native document -> rejected with wallet-native message.
    const walletF = 'NQ10 WALLETNATIVECREATOR0000000000000000'
    const tokenF = await walletSession(walletF)
    const createNative = await j(
      'POST',
      '/api/documents',
      {
        title: 'Wallet native lease',
        type: 'rental',
        creatorDisplayName: 'Native Creator',
        originalSha256: randHash(),
        pageCount: 1,
        requiredSignatures: 2,
      },
      tokenF,
    )
    assert(createNative.status === 201, `(f) wallet-native doc created (${JSON.stringify(createNative.body)})`)
    const claimF = await j(
      'POST',
      `/api/documents/${createNative.body.document.id}/claim`,
      { documentKey: 'irrelevant' },
      tokenF,
    )
    assert(claimF.status === 400, `(f) claim on wallet-native doc -> 400 (got ${claimF.status})`)
    assert(
      /created with a wallet/i.test(claimF.body?.error ?? ''),
      `(f) error message mentions wallet-native (got "${claimF.body?.error}")`,
    )

    // (g) Signed-before-claim: third guest doc, creator guest-signs, THEN claims.
    const docG = await createGuestDoc()
    const guestTokenG = docG.guestSession.token
    const signG = await j(
      'POST',
      `/api/documents/${docG.document.id}/signatures`,
      { signatureType: 'typed', clientSha256: docG.document.originalSha256, displayName: 'Guest Creator' },
      guestTokenG,
    )
    assert(signG.status === 200, `(g) creator guest-signs before claim (${JSON.stringify(signG.body)})`)
    const walletG = 'NQ11 CLAIMERWALLETFOUR000000000000000000'
    const tokenG = await walletSession(walletG)
    const claimG = await j(
      'POST',
      `/api/documents/${docG.document.id}/claim`,
      { guestSessionToken: guestTokenG },
      tokenG,
    )
    assert(claimG.status === 200, `(g) claim after guest-sign succeeds (${JSON.stringify(claimG.body)})`)
    const creatorPartyG = claimG.body.document.parties[0]
    assert(
      creatorPartyG.walletAddress === null,
      `(g) creator party walletAddress stays null after signed-before-claim (got ${creatorPartyG.walletAddress})`,
    )
    assert(claimG.body.document.authMode === 'claimed', '(g) authMode correctly updated to claimed')
    assert(
      normC(claimG.body.document.creatorAddress) === normC(walletG),
      '(g) creatorAddress correctly updated to claiming wallet',
    )

    // (h) Unsigned-before-claim: doc (d) - creator party walletAddress WAS set.
    const docDFetch = await j('GET', `/api/documents/${docD.document.id}`, undefined, tokenD)
    assert(docDFetch.status === 200, '(h) fetch doc D')
    const creatorPartyD = docDFetch.body.document.parties[0]
    assert(
      normC(creatorPartyD.walletAddress ?? '') === normC(walletD),
      `(h) creator party walletAddress set to claiming wallet when unsigned at claim time (got ${creatorPartyD.walletAddress})`,
    )

    // (i) Co-signer survives claim: 2-party guest doc, mint+redeem invite for party 2
    // BEFORE claiming, claim as creator, THEN confirm co-signer can still sign.
    const docI = await createGuestDoc({ requiredSignatures: 2 })
    const guestTokenI = docI.guestSession.token
    const partyIds = docI.document.parties.map(p => p.id)
    const creatorPartyId = partyIds[0]
    const coSignerPartyId = partyIds[1]
    const inviteI = await j(
      'POST',
      `/api/documents/${docI.document.id}/party-invites`,
      { partyId: coSignerPartyId },
      guestTokenI,
    )
    assert(inviteI.status === 201, `(i) mint link invite for co-signer (${JSON.stringify(inviteI.body)})`)
    const redeemI = await j('POST', '/api/auth/guest/redeem-invite', { inviteToken: inviteI.body.token })
    assert(redeemI.status === 200, `(i) redeem invite -> guest signer session (${JSON.stringify(redeemI.body)})`)
    const coSignerTokenI = redeemI.body.session.token

    const walletI = 'NQ12 CLAIMERWALLETFIVEZ00000000000000000'
    const tokenI = await walletSession(walletI)
    const claimI = await j(
      'POST',
      `/api/documents/${docI.document.id}/claim`,
      { guestSessionToken: guestTokenI },
      tokenI,
    )
    assert(claimI.status === 200, `(i) claim as creator succeeds (${JSON.stringify(claimI.body)})`)

    const signI = await j(
      'POST',
      `/api/documents/${docI.document.id}/signatures`,
      { signatureType: 'typed', clientSha256: docI.document.originalSha256, displayName: 'Co-Signer' },
      coSignerTokenI,
    )
    assert(
      signI.status === 200,
      `(i) co-signer's already-redeemed guest session can still sign after claim (${JSON.stringify(signI.body)})`,
    )
    assert(
      signI.body.document.parties.find(p => p.id === coSignerPartyId)?.status === 'signed',
      '(i) co-signer party marked signed post-claim',
    )
    void creatorPartyId

    // (j) Full wallet-native regression pass.
    const walletJ = 'NQ13 REGRESSIONWALLETONE00000000000000000'
    const tokenJ = await walletSession(walletJ)
    const createJ = await j(
      'POST',
      '/api/documents',
      {
        title: 'Regression lease',
        type: 'rental',
        creatorDisplayName: 'Regression Creator',
        originalSha256: randHash(),
        pageCount: 1,
        requiredSignatures: 1,
        creatorNotifyEmail: 'owner@example.com',
      },
      tokenJ,
    )
    assert(createJ.status === 201, `(j) wallet-native create (${JSON.stringify(createJ.body)})`)
    const docJId = createJ.body.document.id

    const signJ = await j(
      'POST',
      `/api/documents/${docJId}/signatures`,
      {
        partyId: createJ.body.document.parties[0].id,
        signatureType: 'typed',
        clientSha256: createJ.body.document.originalSha256,
        displayName: 'Regression Creator',
      },
      tokenJ,
    )
    assert(signJ.status === 200, `(j) wallet-native sign (${JSON.stringify(signJ.body)})`)
    assert(signJ.body.document.signingProgress.readyToLock, '(j) ready to lock after solo sign')

    const rosterJ = await j(
      'PUT',
      `/api/documents/${docJId}/signing-roster`,
      { parties: [{ displayName: 'Solo Creator' }], creatorSignsAsIndex: 0 },
      tokenJ,
    )
    // roster rebuild should fail post-sign (already signed) - this itself is expected wallet-native behavior.
    assert(rosterJ.status === 400, `(j) roster rebuild blocked after signing as expected (got ${rosterJ.status})`)

    const notifyJ = await j(
      'PATCH',
      `/api/documents/${docJId}/notify-email`,
      { email: 'newowner@example.com' },
      tokenJ,
    )
    assert(notifyJ.status === 200, `(j) notify-email update (${JSON.stringify(notifyJ.body)})`)

    const listArchiveJ = await j(
      'PUT',
      `/api/documents/${docJId}/list-archive`,
      { archived: true },
      tokenJ,
    )
    assert(listArchiveJ.status === 200, `(j) list-archive update (${JSON.stringify(listArchiveJ.body)})`)
    const listArchiveJRestore = await j(
      'PUT',
      `/api/documents/${docJId}/list-archive`,
      { archived: false },
      tokenJ,
    )
    assert(listArchiveJRestore.status === 200, '(j) list-archive restore')

    // Cosigners config on a fresh unsigned wallet-native doc (avoid the "already signed" doc).
    const createJ2 = await j(
      'POST',
      '/api/documents',
      {
        title: 'Regression lease 2',
        type: 'rental',
        creatorDisplayName: 'Regression Creator 2',
        originalSha256: randHash(),
        pageCount: 1,
        requiredSignatures: 1,
      },
      tokenJ,
    )
    assert(createJ2.status === 201, '(j) second wallet-native create for cosigners test')
    const cosignersJ = await j(
      'PATCH',
      `/api/documents/${createJ2.body.document.id}/cosigners`,
      { requiredSignatures: 2, coSignerNames: ['Second Signer'] },
      tokenJ,
    )
    assert(cosignersJ.status === 200, `(j) cosigners update (${JSON.stringify(cosignersJ.body)})`)

    const inviteJ = await j(
      'POST',
      `/api/documents/${createJ2.body.document.id}/party-invites`,
      { partyId: cosignersJ.body.document.parties[1].id },
      tokenJ,
    )
    assert(inviteJ.status === 201, `(j) wallet-native party invite mint (${JSON.stringify(inviteJ.body)})`)

    const meJ = await j('GET', '/api/me', undefined, tokenJ)
    assert(meJ.status === 200, '(j) /api/me list-archive works')
    assert(Array.isArray(meJ.body.documents), '(j) /api/me returns documents array')

    const deleteJ2 = await j('DELETE', `/api/documents/${createJ2.body.document.id}`, undefined, tokenJ)
    assert(deleteJ2.status === 200, `(j) wallet-native delete of unsigned draft (${JSON.stringify(deleteJ2.body)})`)

    const placementPlanJ = await j(
      'POST',
      '/api/placement-plans',
      {
        documentId: docJId,
        originalSha256: createJ.body.document.originalSha256,
        plan: { pdfSha256: createJ.body.document.originalSha256, people: [{ slotIndex: 1, displayName: 'Regression Creator' }], slots: [] },
      },
      tokenJ,
    )
    assert(
      placementPlanJ.status === 200 || placementPlanJ.status === 201,
      `(j) placement-plans save works for wallet-native (${JSON.stringify(placementPlanJ.body)})`,
    )

    // (k) /api/me lists for guest sessions (no wallet) - agreements visible to guests.
    const docK = await createGuestDoc({ requiredSignatures: 2 })
    const guestTokenK = docK.guestSession.token
    const meGuestCreator = await j('GET', '/api/me', undefined, guestTokenK)
    assert(meGuestCreator.status === 200, `(k) /api/me with guest creator token (${JSON.stringify(meGuestCreator.body?.error ?? '')})`)
    assert(Array.isArray(meGuestCreator.body.documents), '(k) /api/me returns documents array for guest creator')
    assert(
      meGuestCreator.body.documents.some(d => d.id === docK.document.id),
      '(k) guest creator list contains their document',
    )
    assert(
      meGuestCreator.body.address.startsWith('guest:doc:'),
      `(k) /api/me guest creator address is guest:doc: sentinel (got "${meGuestCreator.body.address}")`,
    )

    const partyIdsK = docK.document.parties.map(p => p.id)
    const coSignerPartyIdK = partyIdsK[1]
    const inviteK = await j(
      'POST',
      `/api/documents/${docK.document.id}/party-invites`,
      { partyId: coSignerPartyIdK },
      guestTokenK,
    )
    assert(inviteK.status === 201, `(k) mint link invite for guest /api/me co-signer (${JSON.stringify(inviteK.body)})`)
    const redeemK = await j('POST', '/api/auth/guest/redeem-invite', { inviteToken: inviteK.body.token })
    assert(redeemK.status === 200, '(k) redeem invite -> guest signer session')
    const coSignerTokenK = redeemK.body.session.token

    const meGuestSigner = await j('GET', '/api/me', undefined, coSignerTokenK)
    assert(meGuestSigner.status === 200, '(k) /api/me with guest signer token')
    assert(Array.isArray(meGuestSigner.body.documents), '(k) /api/me returns documents array for guest signer')
    assert(
      meGuestSigner.body.documents.some(d => d.id === docK.document.id),
      '(k) guest signer list contains the session-bound document',
    )
    assert(
      meGuestSigner.body.address.startsWith('guest:party:'),
      `(k) /api/me guest signer address is guest:party: sentinel (got "${meGuestSigner.body.address}")`,
    )

    const meNoToken = await j('GET', '/api/me')
    assert(meNoToken.status === 401, '(k) /api/me without token -> 401')
    const meBadGuest = await j('GET', '/api/me', undefined, 'not-a-real-guest-token')
    assert(meBadGuest.status === 401, '(k) /api/me with invalid guest token -> 401')

    console.log('\nALL CLAIM-BRIDGE SMOKE TESTS PASSED')
  } finally {
    child.kill()
    await new Promise(r => setTimeout(r, 500))
    rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
