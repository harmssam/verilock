/**
 * Guest signing auth layer (`docs/guest-signing-plan.md`, Task 2).
 *
 * The key design decision here: existing wallet-gated routes read
 * `res.locals.address as string` and pass it straight into domain functions
 * (`configureSigningRoster(documentId, address, ...)`, `deleteDocument(idOrSlug, address)`,
 * etc.), which internally compare `normalizeAddress(doc.creatorAddress) !== normalizeAddress(requesterAddress)`.
 * `normalizeAddress` (`./addresses.js`) is a pure string transform with no Nimiq-shape
 * validation, so it works identically on guest sentinels (`guest:doc:{id}` /
 * `guest:party:{partyId}`, see `./guestIdentity.js`).
 *
 * `requireWalletOrGuestCreator` / `requireWalletOrGuestSigner` exploit this: on success
 * they set `res.locals.address` to EITHER a verified wallet address OR a guest subject
 * string, using the exact same `res.locals` field the wallet-only middleware
 * (`authMiddleware` + `requireVerifiedWallet` in `index.ts`) already sets. That means
 * every existing document-mutation domain function (and future ones) needs zero changes
 * to accept guest callers - only the route wiring (which middleware guards the route)
 * needs to change, which is a later task's job (see plan Task 4+). This module just
 * needs to exist, correctly implemented and exported.
 *
 * `resolveViewerSubject` is the read-path analogue: a never-rejecting resolver that
 * backs `optionalViewerAddress` in `index.ts` so a guest viewer reloading their own
 * document/signature-image/placement-plan sees full participant detail instead of the
 * redacted public view.
 */
import type { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import {
  createGuestSession,
  getDocumentById,
  getDocumentBySlug,
  getGuestSession,
  getPartiesForDocument,
  getSession,
  inspectPartyInviteByTokenHash,
  touchGuestSession,
  type GuestSessionRecord,
} from './db.js'
import { hashInviteToken } from './documents.js'
import {
  guestCreatorSubject,
  guestPartySubject,
  hashGuestSecret,
  mintGuestSecretRaw,
} from './guestIdentity.js'

/** Guest session bearer tokens live 7 days (`docs/guest-signing-plan.md` §"Guest sessions"). */
export const GUEST_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * `SKIP_CHAIN_VERIFY` gates whether an unverified wallet session still counts as
 * "verified" (non-production convenience). Read directly from `process.env` here -
 * mirrors `index.ts`'s own `SKIP_CHAIN_VERIFY` constant exactly; this module does not
 * import from `index.ts` to avoid a circular dependency.
 */
function skipChainVerify(): boolean {
  return process.env.SKIP_CHAIN_VERIFY === 'true'
}

/**
 * Mints a fresh guest session (bearer token stored raw/plaintext at rest - same trust
 * model as wallet `sessions.token`, see `db.ts`). Never reuses/invalidates a prior
 * session for the same document+role; callers (redeem, create) always get a new one.
 */
export function mintGuestSession(input: {
  documentId: string
  partyId: string | null
  role: 'creator' | 'signer'
}): { token: string; expiresAt: number } {
  const token = mintGuestSecretRaw()
  const session = createGuestSession({
    token,
    documentId: input.documentId,
    partyId: input.partyId,
    role: input.role,
    ttlMs: GUEST_SESSION_TTL_MS,
  })
  return { token: session.token, expiresAt: session.expiresAt }
}

function guestBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (!header) return null
  const token = header.replace('Bearer ', '').trim()
  return token || null
}

function resolveGuestSession(req: Request): GuestSessionRecord | null {
  const token = guestBearerToken(req)
  if (!token) return null
  const session = getGuestSession(token)
  if (session) {
    try {
      touchGuestSession(token)
    } catch {
      // best-effort - never break the request over an activity ping
    }
  }
  return session
}

/**
 * Informational-only middleware: attaches `res.locals.guestSession` / `guestSubject`
 * when a valid guest Bearer token is present, but never rejects/401s by itself. Other
 * middleware/handlers layer authorization decisions on top of this.
 */
export function guestAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const session = resolveGuestSession(req)
  if (session) {
    res.locals.guestSession = session
    res.locals.guestSubject =
      session.role === 'creator'
        ? guestCreatorSubject(session.documentId)
        : guestPartySubject(session.partyId!)
  }
  next()
}

/** Resolve the request's target document id across the differently-shaped routes this guards. */
function resolveTargetDocumentId(req: Request): string | null {
  const params = req.params as Record<string, string | undefined>
  const body = (req.body ?? {}) as { documentId?: unknown }
  const query = req.query as Record<string, unknown>
  const candidates = [
    params.id,
    params.documentId,
    typeof body.documentId === 'string' ? body.documentId : undefined,
    typeof query.documentId === 'string' ? (query.documentId as string) : undefined,
  ]
  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return null
}

/**
 * Combined wallet-or-guest-creator auth. Replaces the `authMiddleware, requireVerifiedWallet`
 * pair for routes that a guest creator session should also be able to perform (roster,
 * cosigners, notify-email, list-archive, delete, placement-plan creator actions - wiring
 * those routes to this middleware is a later task, not this one's).
 */
export function requireWalletOrGuestCreator(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = guestBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing session token' })
    return
  }

  const walletSession = getSession(token)
  if (walletSession && (walletSession.verified || skipChainVerify())) {
    res.locals.address = walletSession.address
    res.locals.token = token
    res.locals.authKind = 'wallet'
    next()
    return
  }

  const guestSession = getGuestSession(token)
  if (guestSession && guestSession.role === 'creator') {
    const targetDocumentId = resolveTargetDocumentId(req)
    if (!targetDocumentId || targetDocumentId !== guestSession.documentId) {
      res.status(403).json({ error: 'Guest session does not match this document' })
      return
    }
    res.locals.address = guestCreatorSubject(guestSession.documentId)
    res.locals.guestSession = guestSession
    res.locals.authKind = 'guest'
    next()
    return
  }

  res.status(401).json({ error: 'Invalid or expired session' })
}

/**
 * Combined wallet-or-guest-signer (co-signer) auth. Guest path deliberately trusts
 * `session.partyId` as the authoritative party identity and does NOT validate a
 * client-supplied `partyId` from the request body against it - a future domain
 * function (`addGuestSignature`) must ignore/override any "preferred" party id from
 * the body for guest callers, exactly like the wallet path already ignores a
 * preferred party id when it doesn't match what `resolveAndClaimParty` determines.
 */
export function requireWalletOrGuestSigner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = guestBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing session token' })
    return
  }

  const walletSession = getSession(token)
  if (walletSession && (walletSession.verified || skipChainVerify())) {
    res.locals.address = walletSession.address
    res.locals.token = token
    res.locals.authKind = 'wallet'
    next()
    return
  }

  const guestSession = getGuestSession(token)
  if (guestSession && guestSession.role === 'signer' && guestSession.partyId) {
    const targetDocumentId = resolveTargetDocumentId(req)
    if (!targetDocumentId || targetDocumentId !== guestSession.documentId) {
      res.status(403).json({ error: 'Guest session does not match this document' })
      return
    }
    res.locals.address = guestPartySubject(guestSession.partyId)
    res.locals.guestSession = guestSession
    res.locals.authKind = 'guest'
    next()
    return
  }

  res.status(401).json({ error: 'Invalid or expired session' })
}

/**
 * Wallet OR any matching guest session (creator or signer) for this document.
 * Used only by routes where EITHER the creator OR an invited co-signer may act:
 * signing, and field fills. NOT used by creator-only mutation routes (roster,
 * cosigners, notify-email, list-archive, delete, placement-plan create/lock) -
 * those stay on `requireWalletOrGuestCreator` deliberately.
 *
 * Combines the exact wallet branch shared by `requireWalletOrGuestCreator` /
 * `requireWalletOrGuestSigner` above with a guest branch that accepts EITHER
 * `role === 'creator'` OR (`role === 'signer'` AND `partyId` set) - same
 * target-document-id matching via `resolveTargetDocumentId`.
 */
export function requireWalletOrAnyGuestParty(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = guestBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Missing session token' })
    return
  }

  const walletSession = getSession(token)
  if (walletSession && (walletSession.verified || skipChainVerify())) {
    res.locals.address = walletSession.address
    res.locals.token = token
    res.locals.authKind = 'wallet'
    next()
    return
  }

  const guestSession = getGuestSession(token)
  const isCreator = guestSession?.role === 'creator'
  const isSigner = guestSession?.role === 'signer' && !!guestSession.partyId
  if (guestSession && (isCreator || isSigner)) {
    const targetDocumentId = resolveTargetDocumentId(req)
    if (!targetDocumentId || targetDocumentId !== guestSession.documentId) {
      res.status(403).json({ error: 'Guest session does not match this document' })
      return
    }
    res.locals.address = isCreator
      ? guestCreatorSubject(guestSession.documentId)
      : guestPartySubject(guestSession.partyId!)
    res.locals.guestSession = guestSession
    res.locals.authKind = 'guest'
    next()
    return
  }

  res.status(401).json({ error: 'Invalid or expired session' })
}

/**
 * Read-only variant of the wallet-or-guest resolution used by the mutation
 * middlewares above - never rejects, mirrors `optionalViewerAddress`'s wallet-path
 * semantics exactly (verified sessions only, unless `SKIP_CHAIN_VERIFY`). No
 * document-id matching here: the caller (`canRevealParticipantDetails`,
 * `viewerMayAccessSignatureImage`) does the per-document comparison itself, same as
 * it already does for wallet addresses today.
 */
export function resolveViewerSubject(req: Request): string | null {
  const token = guestBearerToken(req)
  if (!token) return null

  const walletSession = getSession(token)
  if (walletSession) {
    if (!walletSession.verified && !skipChainVerify()) return null
    return walletSession.address
  }

  const guestSession = getGuestSession(token)
  if (guestSession) {
    return guestSession.role === 'creator'
      ? guestCreatorSubject(guestSession.documentId)
      : guestPartySubject(guestSession.partyId!)
  }

  return null
}

/**
 * Verifies a raw document key against a guest document and mints a fresh creator
 * guest session. Idempotent: never marks/rotates/invalidates the key - see plan
 * "Redeem document key" - so re-entering the same key from a new browser/device or
 * after a session expired mid-flow always works.
 */
export function redeemDocumentKey(input: {
  documentId?: string | null
  slug?: string | null
  documentKey: string
}): { session: { token: string; expiresAt: number } } {
  const doc =
    (input.documentId ? getDocumentById(input.documentId) : null) ??
    (input.slug ? getDocumentBySlug(input.slug) : null)
  if (!doc) {
    throw new Error('Document not found')
  }
  if (doc.authMode !== 'guest') {
    throw new Error('This agreement was not created as a guest document')
  }
  if (!doc.creatorDocumentKeyHash) {
    throw new Error('This document has no active document key')
  }

  // Intentionally not rate-limited here - the caller (route handler) is responsible
  // for rateLimit(...) + Turnstile (see plan "Security & abuse" #2/#8).
  const providedHash = Buffer.from(hashGuestSecret(input.documentKey), 'hex')
  const storedHash = Buffer.from(doc.creatorDocumentKeyHash, 'hex')
  if (
    providedHash.length !== storedHash.length ||
    !timingSafeEqual(providedHash, storedHash)
  ) {
    throw new Error('Incorrect document key')
  }

  const parties = getPartiesForDocument(doc.id).slice().sort((a, b) => a.sortOrder - b.sortOrder)
  const creatorParty = parties[0]
  if (!creatorParty) {
    throw new Error('Document has no creator party')
  }

  const session = mintGuestSession({ documentId: doc.id, partyId: null, role: 'creator' })
  return { session }
}

/**
 * Redeems a personal party-invite token (`?invite=`, minted by `mintLinkPartyInvite`
 * or `sendPartyInviteEmail`) into a fresh guest signer session bound to the invite's
 * party. Idempotent by design - see plan "Redeem invite -> guest session":
 *
 * This function must NEVER call `markPartyInviteRedeemed` or otherwise mutate the
 * invite row. Minting a guest session is repeatable and side-effect-free on the
 * invite itself - only `addSignature`/`addGuestSignature` (at actual SIGN time) may
 * eventually mark redemption, and even then only the WALLET path (`addSignature`,
 * via its `inviteForSign` mechanism) currently calls `markPartyInviteRedeemed`.
 * Guest signing via `addGuestSignature` does NOT go through that invite-token
 * mechanism at all - it authenticates via the guest session, not a re-submitted
 * invite token - so there is currently NO code path that marks a link/guest invite
 * as redeemed. This is fine and intentional for now: the invite row existing in an
 * "active, never redeemed" state forever for guest-redeemed invites does not cause a
 * security problem (a party can only be signed once regardless, enforced by
 * `addGuestSignature`'s own existing-signature check), but do not "fix" this later
 * without re-reading the idempotency requirement above - a co-signer whose guest
 * session expires before they finish signing must be able to re-open the exact same
 * invite link and get a fresh session, not an error.
 */
export function redeemPartyInviteAsGuest(rawInviteToken: string): {
  session: { token: string; expiresAt: number }
} {
  const looked = inspectPartyInviteByTokenHash(hashInviteToken(rawInviteToken))
  if (looked.status === 'not_found') {
    throw new Error('Invite not found or expired')
  }
  if (looked.status !== 'active') {
    // Copied verbatim from `GET /api/invites/lookup` (`index.ts`) for consistent copy.
    const messages: Record<'revoked' | 'redeemed' | 'expired', string> = {
      revoked:
        'This invite link was replaced. Ask the organizer to send a new invite if you still need to sign.',
      redeemed: 'This invite link was already used to sign.',
      expired: 'This invite link has expired. Ask the organizer to resend the invite.',
    }
    throw new Error(messages[looked.status])
  }

  const invite = looked.invite
  const session = mintGuestSession({
    documentId: invite.documentId,
    partyId: invite.partyId,
    role: 'signer',
  })
  return { session }
}
