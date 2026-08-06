import Database from 'better-sqlite3'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeAddress } from './addresses.js'
import { getDatabasePath } from './paths.js'

const dbPath = getDatabasePath()

mkdirSync(dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

/** Shared SQLite handle for domain modules (support tickets, etc.). */
export { db }

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    nonce TEXT NOT NULL,
    public_key TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL DEFAULT 'draft',
    creator_address TEXT NOT NULL,
    original_sha256 TEXT NOT NULL,
    final_sha256 TEXT,
    page_count INTEGER NOT NULL DEFAULT 1,
    metadata TEXT,
    created_at INTEGER NOT NULL,
    locked_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS document_parties (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    role TEXT NOT NULL,
    display_name TEXT NOT NULL,
    wallet_address TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    signed_at INTEGER,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS signatures (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    party_id TEXT NOT NULL,
    signer_address TEXT NOT NULL,
    signature_type TEXT NOT NULL,
    client_sha256 TEXT NOT NULL,
    signed_at INTEGER NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (party_id) REFERENCES document_parties(id)
  );

  CREATE TABLE IF NOT EXISTS attestations (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL UNIQUE,
    tx_hash TEXT NOT NULL UNIQUE,
    sender_address TEXT NOT NULL,
    payload TEXT NOT NULL,
    final_sha256 TEXT NOT NULL,
    block_number INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    error TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS signature_images (
    signature_id TEXT PRIMARY KEY,
    image_blob BLOB NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/png',
    byte_size INTEGER NOT NULL,
    image_sha256 TEXT NOT NULL,
    FOREIGN KEY (signature_id) REFERENCES signatures(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_documents_creator ON documents(creator_address);
  CREATE INDEX IF NOT EXISTS idx_attestations_tx ON attestations(tx_hash);

  CREATE TABLE IF NOT EXISTS pay_login_qr (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',
    poll_secret TEXT,
    desktop_token TEXT,
    address TEXT,
    public_key TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_pay_login_qr_expires ON pay_login_qr(expires_at);
`)

const payLoginQrColumns = db.prepare('PRAGMA table_info(pay_login_qr)').all() as Array<{ name: string }>
if (!payLoginQrColumns.some(col => col.name === 'poll_secret')) {
  db.exec('ALTER TABLE pay_login_qr ADD COLUMN poll_secret TEXT')
}

const documentColumns = db.prepare('PRAGMA table_info(documents)').all() as Array<{ name: string }>
if (!documentColumns.some(col => col.name === 'required_signatures')) {
  db.exec('ALTER TABLE documents ADD COLUMN required_signatures INTEGER')
}
if (!documentColumns.some(col => col.name === 'original_filename')) {
  db.exec('ALTER TABLE documents ADD COLUMN original_filename TEXT')
}
if (!documentColumns.some(col => col.name === 'creator_notify_email')) {
  db.exec('ALTER TABLE documents ADD COLUMN creator_notify_email TEXT')
}
if (!documentColumns.some(col => col.name === 'ready_to_seal_email_sent_at')) {
  db.exec('ALTER TABLE documents ADD COLUMN ready_to_seal_email_sent_at INTEGER')
}
/** JSON array of client PDF annotations (nullable - legacy docs have none). */
if (!documentColumns.some(col => col.name === 'annotations')) {
  db.exec('ALTER TABLE documents ADD COLUMN annotations TEXT')
}
/** Organizer label from step 1 - used in invite emails; not the same as a signer slot. */
if (!documentColumns.some(col => col.name === 'creator_display_name')) {
  db.exec('ALTER TABLE documents ADD COLUMN creator_display_name TEXT')
}

/** Guest signing (`docs/guest-signing-plan.md`): ownership + document-key columns. */
if (!documentColumns.some(col => col.name === 'auth_mode')) {
  db.exec("ALTER TABLE documents ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'wallet'")
}
if (!documentColumns.some(col => col.name === 'creator_document_key_hash')) {
  db.exec('ALTER TABLE documents ADD COLUMN creator_document_key_hash TEXT')
}
if (!documentColumns.some(col => col.name === 'creator_document_key_created_at')) {
  db.exec('ALTER TABLE documents ADD COLUMN creator_document_key_created_at INTEGER')
}
if (!documentColumns.some(col => col.name === 'claimed_at')) {
  db.exec('ALTER TABLE documents ADD COLUMN claimed_at INTEGER')
}
if (!documentColumns.some(col => col.name === 'claimed_from_guest')) {
  db.exec('ALTER TABLE documents ADD COLUMN claimed_from_guest INTEGER NOT NULL DEFAULT 0')
}

/** Co-signer invite email (latest) - creator-visible; not a public capability secret. */
const partyColumns = db.prepare('PRAGMA table_info(document_parties)').all() as Array<{ name: string }>
if (!partyColumns.some(col => col.name === 'invite_email')) {
  db.exec('ALTER TABLE document_parties ADD COLUMN invite_email TEXT')
}
if (!partyColumns.some(col => col.name === 'invite_sent_at')) {
  db.exec('ALTER TABLE document_parties ADD COLUMN invite_sent_at INTEGER')
}

/** Signature audit: email invite used when this wallet signed (nullable for open-claim). */
const signatureColumns = db.prepare('PRAGMA table_info(signatures)').all() as Array<{ name: string }>
if (!signatureColumns.some(col => col.name === 'invited_as_email')) {
  db.exec('ALTER TABLE signatures ADD COLUMN invited_as_email TEXT')
}
if (!signatureColumns.some(col => col.name === 'invite_id')) {
  db.exec('ALTER TABLE signatures ADD COLUMN invite_id TEXT')
}

/** Guest signing (`docs/guest-signing-plan.md`): auth method + preferred identity subject. */
if (!signatureColumns.some(col => col.name === 'auth_method')) {
  db.exec("ALTER TABLE signatures ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'wallet'")
}
if (!signatureColumns.some(col => col.name === 'signer_subject')) {
  db.exec('ALTER TABLE signatures ADD COLUMN signer_subject TEXT')
}

/**
 * Opaque personal invite tokens (email-only capability).
 * Store token_hash only; raw token lives in the email body, never in API responses.
 *
 * `email` is `NOT NULL` today. Link-only (no-email) guest invites (Task 5 of
 * `docs/guest-signing-plan.md`, future work) will store `email: ''` by
 * convention rather than requiring a schema change/table rebuild for a
 * nullable column - SQLite can't easily drop a NOT NULL constraint via
 * `ALTER TABLE ADD COLUMN`.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS party_invites (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    party_id TEXT NOT NULL,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER,
    redeemed_at INTEGER,
    redeemed_by_wallet TEXT,
    resend_message_id TEXT,
    FOREIGN KEY (document_id) REFERENCES documents(id),
    FOREIGN KEY (party_id) REFERENCES document_parties(id)
  );
  CREATE INDEX IF NOT EXISTS idx_party_invites_party ON party_invites(party_id);
  CREATE INDEX IF NOT EXISTS idx_party_invites_doc ON party_invites(document_id);
`)

/**
 * Guest signing (`docs/guest-signing-plan.md`): short-lived Bearer sessions scoped
 * to a document + role, used instead of a Nimiq wallet session. `party_id` is null
 * for a creator (document-key) principal, set for a co-signer (invite) principal.
 *
 * Naming-collision caution: `sig_handoff_rooms.from_role` (below) already uses the
 * string `'guest'` for the non-host side of an unrelated cross-device QR pairing
 * feature. That table has nothing to do with guest signing - don't conflate them.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS guest_sessions (
    token TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    party_id TEXT,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );
  CREATE INDEX IF NOT EXISTS idx_guest_sessions_doc ON guest_sessions(document_id);
  CREATE INDEX IF NOT EXISTS idx_guest_sessions_exp ON guest_sessions(expires_at);
`)

/** Drop duplicate rows so unique indexes can be applied on existing DBs. */
function dedupeSignaturesForUniqueness(): void {
  db.exec(`
    DELETE FROM signature_images
    WHERE signature_id IN (
      SELECT s.id FROM signatures s
      WHERE s.rowid NOT IN (
        SELECT MIN(rowid) FROM signatures GROUP BY party_id
      )
    );

    DELETE FROM signatures
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM signatures GROUP BY party_id
    );

    DELETE FROM signature_images
    WHERE signature_id IN (
      SELECT s.id FROM signatures s
      WHERE s.rowid NOT IN (
        SELECT MIN(rowid) FROM signatures
        GROUP BY document_id, UPPER(REPLACE(signer_address, ' ', ''))
      )
    );

    DELETE FROM signatures
    WHERE rowid NOT IN (
      SELECT MIN(rowid) FROM signatures
      GROUP BY document_id, UPPER(REPLACE(signer_address, ' ', ''))
    );
  `)
}

dedupeSignaturesForUniqueness()

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_signatures_party_unique
    ON signatures(party_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_signatures_doc_signer_unique
    ON signatures(document_id, UPPER(REPLACE(signer_address, ' ', '')));
  CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_doc_wallet_unique
    ON document_parties(document_id, UPPER(REPLACE(wallet_address, ' ', '')))
    WHERE wallet_address IS NOT NULL;
`)

export type DocumentStatus =
  | 'draft'
  | 'collecting_signatures'
  | 'ready_to_lock'
  | 'locking'
  | 'locked'
  | 'cancelled'

export interface SessionRecord {
  address: string
  nonce: string
  expiresAt: number
  publicKey?: string | null
  verified: boolean
}

export interface DocumentRecord {
  id: string
  slug: string
  title: string
  originalFilename: string | null
  type: string
  status: DocumentStatus
  creatorAddress: string
  originalSha256: string
  finalSha256: string | null
  pageCount: number
  metadata: Record<string, unknown> | null
  /**
   * Client-placed PDF annotations (signature/text overlays). Nullable JSON.
   * PDF bytes are never stored - only geometry + small image/text payloads.
   */
  annotations: unknown[] | null
  requiredSignatures: number
  createdAt: number
  lockedAt: number | null
  /** Optional creator email for ready-to-seal notify (never public). */
  creatorNotifyEmail: string | null
  readyToSealEmailSentAt: number | null
  /** Organizer name from create (invite copy); independent of signing roster. */
  creatorDisplayName: string | null
  /** Guest signing (`docs/guest-signing-plan.md`): `wallet` | `guest` | `claimed`. */
  authMode: 'wallet' | 'guest' | 'claimed'
  /** SHA-256 of the raw document key (guest creator capability secret). Null for wallet docs. */
  creatorDocumentKeyHash: string | null
  creatorDocumentKeyCreatedAt: number | null
  /** Set when a guest doc's creator ownership was claimed onto a wallet. */
  claimedAt: number | null
  /** Audit flag: true if this (now wallet/claimed) document started out as guest. */
  claimedFromGuest: boolean
}

export interface PartyRecord {
  id: string
  documentId: string
  role: string
  displayName: string
  walletAddress: string | null
  sortOrder: number
  required: boolean
  status: 'pending' | 'signed' | 'declined'
  signedAt: number | null
  /** Latest invite recipient (normalized). Creator-visible only in publicDocument. */
  inviteEmail: string | null
  inviteSentAt: number | null
}

export interface SignatureRecord {
  id: string
  documentId: string
  partyId: string
  signerAddress: string
  signatureType: string
  clientSha256: string
  signedAt: number
  /** Frozen invite email when signed via personal invite token. */
  invitedAsEmail: string | null
  inviteId: string | null
  /** Guest signing (`docs/guest-signing-plan.md`): `wallet` | `guest`. */
  authMethod: 'wallet' | 'guest'
  /** Preferred identity subject going forward; migration target for `signerAddress`. Unused (null) for wallet signatures today. */
  signerSubject: string | null
}

export interface PartyInviteRecord {
  id: string
  documentId: string
  partyId: string
  email: string
  tokenHash: string
  channel: string
  createdAt: number
  expiresAt: number | null
  revokedAt: number | null
  redeemedAt: number | null
  redeemedByWallet: string | null
  resendMessageId: string | null
}

export interface SignatureImageRecord {
  signatureId: string
  imageBlob: Buffer
  contentType: string
  byteSize: number
  imageSha256: string
}

export interface AttestationRecord {
  id: string
  documentId: string
  txHash: string
  senderAddress: string
  payload: string
  finalSha256: string
  blockNumber: number | null
  status: 'pending' | 'confirmed' | 'failed'
  createdAt: number
  resolvedAt: number | null
  error: string | null
}

/**
 * Create a login challenge session.
 * Pass empty/`null` address for single-trip Hub login: address is bound from the
 * signed public key on verify (no chooseAddress round-trip).
 */
export function createSession(
  token: string,
  address: string | null | undefined,
  nonce: string,
  ttlMs: number,
): void {
  const now = Date.now()
  const addr =
    address == null || String(address).trim() === ''
      ? ''
      : normalizeAddress(address)
  db.prepare(
    'INSERT INTO sessions (token, address, nonce, public_key, verified, created_at, expires_at) VALUES (?, ?, ?, NULL, 0, ?, ?)',
  ).run(token, addr, nonce, now, now + ttlMs)
}

export function getSession(token: string): SessionRecord | null {
  const row = db
    .prepare(
      'SELECT address, nonce, expires_at as expiresAt, public_key as publicKey, verified FROM sessions WHERE token = ?',
    )
    .get(token) as {
    address: string
    nonce: string
    expiresAt: number
    publicKey?: string | null
    verified: number
  } | undefined
  if (!row || row.expiresAt < Date.now()) return null
  return {
    address: row.address,
    nonce: row.nonce,
    expiresAt: row.expiresAt,
    publicKey: row.publicKey,
    verified: Boolean(row.verified),
  }
}

/**
 * Mark session verified. Optionally bind/replace address (single-trip Hub login
 * starts with empty address and sets it from the public key here).
 */
export function markSessionVerified(
  token: string,
  publicKey: string,
  address?: string | null,
): void {
  if (address != null && String(address).trim() !== '') {
    db.prepare(
      'UPDATE sessions SET public_key = ?, verified = 1, address = ? WHERE token = ?',
    ).run(publicKey, normalizeAddress(address), token)
    return
  }
  db.prepare('UPDATE sessions SET public_key = ?, verified = 1 WHERE token = ?').run(
    publicKey,
    token,
  )
}

export function purgeExpiredSessions(): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  return result.changes
}

/**
 * Guest signing (`docs/guest-signing-plan.md`): CRUD for `guest_sessions`, the
 * Bearer-token session table used instead of a Nimiq wallet session. `partyId`
 * is null for a creator (document-key) principal, set for a co-signer (invite)
 * principal. Tokens are stored raw/plaintext here, same trust model as the
 * wallet `sessions.token` column above - the token itself is the bearer secret.
 */
export interface GuestSessionRecord {
  token: string
  documentId: string
  partyId: string | null
  role: 'creator' | 'signer'
  createdAt: number
  expiresAt: number
  lastSeenAt: number
}

export function createGuestSession(input: {
  token: string
  documentId: string
  partyId: string | null
  role: 'creator' | 'signer'
  ttlMs: number
}): GuestSessionRecord {
  const now = Date.now()
  const expiresAt = now + input.ttlMs
  db.prepare(
    'INSERT INTO guest_sessions (token, document_id, party_id, role, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(input.token, input.documentId, input.partyId, input.role, now, expiresAt, now)
  return {
    token: input.token,
    documentId: input.documentId,
    partyId: input.partyId,
    role: input.role,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
  }
}

export function getGuestSession(token: string): GuestSessionRecord | null {
  const row = db
    .prepare(
      'SELECT token, document_id as documentId, party_id as partyId, role, created_at as createdAt, expires_at as expiresAt, last_seen_at as lastSeenAt FROM guest_sessions WHERE token = ?',
    )
    .get(token) as
    | {
        token: string
        documentId: string
        partyId: string | null
        role: string
        createdAt: number
        expiresAt: number
        lastSeenAt: number
      }
    | undefined
  if (!row || row.expiresAt < Date.now()) return null
  return {
    token: row.token,
    documentId: row.documentId,
    partyId: row.partyId,
    role: row.role as 'creator' | 'signer',
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
  }
}

/** Best-effort activity ping - never throws if the row is gone (e.g. purged mid-request). */
export function touchGuestSession(token: string): void {
  try {
    db.prepare('UPDATE guest_sessions SET last_seen_at = ? WHERE token = ?').run(Date.now(), token)
  } catch {
    // ignore
  }
}

export function purgeExpiredGuestSessions(): number {
  const result = db.prepare('DELETE FROM guest_sessions WHERE expires_at < ?').run(Date.now())
  return result.changes
}


export type PayLoginQrStatus = 'pending' | 'ready' | 'consumed' | 'expired'

export type PayLoginQrRecord = {
  id: string
  status: PayLoginQrStatus
  /** Desktop-only secret; never put in the QR / phone URL. */
  pollSecret: string | null
  desktopToken: string | null
  address: string | null
  publicKey: string | null
  createdAt: number
  expiresAt: number
  consumedAt: number | null
}

export function createPayLoginQr(
  id: string,
  pollSecret: string,
  ttlMs: number,
): PayLoginQrRecord {
  const now = Date.now()
  const expiresAt = now + ttlMs
  db.prepare(
    `INSERT INTO pay_login_qr (id, status, poll_secret, desktop_token, address, public_key, created_at, expires_at, consumed_at)
     VALUES (?, 'pending', ?, NULL, NULL, NULL, ?, ?, NULL)`,
  ).run(id, pollSecret, now, expiresAt)
  return {
    id,
    status: 'pending',
    pollSecret,
    desktopToken: null,
    address: null,
    publicKey: null,
    createdAt: now,
    expiresAt,
    consumedAt: null,
  }
}

function mapPayLoginQr(row: {
  id: string
  status: string
  poll_secret: string | null
  desktop_token: string | null
  address: string | null
  public_key: string | null
  created_at: number
  expires_at: number
  consumed_at: number | null
}): PayLoginQrRecord {
  const expired = row.expires_at < Date.now()
  let status = row.status as PayLoginQrStatus
  if (expired && status === 'pending') status = 'expired'
  else if (expired && status === 'ready') status = 'expired'
  return {
    id: row.id,
    status,
    pollSecret: row.poll_secret,
    desktopToken: row.desktop_token,
    address: row.address,
    publicKey: row.public_key,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  }
}

export function getPayLoginQr(id: string): PayLoginQrRecord | null {
  const row = db
    .prepare(
      `SELECT id, status, poll_secret, desktop_token, address, public_key, created_at, expires_at, consumed_at
       FROM pay_login_qr WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string
        status: string
        poll_secret: string | null
        desktop_token: string | null
        address: string | null
        public_key: string | null
        created_at: number
        expires_at: number
        consumed_at: number | null
      }
    | undefined
  if (!row) return null
  return mapPayLoginQr(row)
}

/** Phone completed Pay login: bind a new desktop session (ready for poll). */
export function markPayLoginQrReady(
  id: string,
  input: { desktopToken: string; address: string; publicKey: string },
): PayLoginQrRecord {
  const now = Date.now()
  const result = db
    .prepare(
      `UPDATE pay_login_qr
       SET status = 'ready', desktop_token = ?, address = ?, public_key = ?
       WHERE id = ? AND status = 'pending' AND expires_at > ?`,
    )
    .run(
      input.desktopToken,
      normalizeAddress(input.address),
      input.publicKey,
      id,
      now,
    )
  if (result.changes === 0) {
    throw new Error('QR login session is not available')
  }
  const row = getPayLoginQr(id)
  if (!row) throw new Error('QR login session is not available')
  return row
}

/**
 * Desktop poll success: return credentials once and mark consumed.
 * Requires the desktop-only pollSecret (never embedded in the QR).
 * Returns null if not ready yet; throws if expired/consumed/missing/unauthorized.
 */
export function consumePayLoginQr(
  id: string,
  pollSecret: string,
): {
  token: string
  address: string
} | null {
  const row = getPayLoginQr(id)
  if (!row) throw new Error('QR login session not found')
  if (!pollSecret || !row.pollSecret || pollSecret !== row.pollSecret) {
    throw new Error('Invalid QR login poll secret')
  }
  if (row.status === 'expired' || row.expiresAt < Date.now()) {
    throw new Error('QR login session expired')
  }
  if (row.status === 'consumed') {
    throw new Error('QR login session already used')
  }
  if (row.status === 'pending') return null
  if (row.status !== 'ready' || !row.desktopToken || !row.address) {
    throw new Error('QR login session is not available')
  }
  const now = Date.now()
  const result = db
    .prepare(
      `UPDATE pay_login_qr SET status = 'consumed', consumed_at = ?, desktop_token = NULL
       WHERE id = ? AND status = 'ready' AND poll_secret = ?`,
    )
    .run(now, id, pollSecret)
  if (result.changes === 0) {
    throw new Error('QR login session already used')
  }
  return { token: row.desktopToken, address: row.address }
}

/** Public status for desktop poll without consuming (still requires poll secret). */
export function assertPayLoginQrPollSecret(id: string, pollSecret: string): PayLoginQrRecord {
  const row = getPayLoginQr(id)
  if (!row) throw new Error('QR login session not found')
  if (!pollSecret || !row.pollSecret || pollSecret !== row.pollSecret) {
    throw new Error('Invalid QR login poll secret')
  }
  return row
}

export function purgeExpiredPayLoginQr(): number {
  const result = db
    .prepare(`DELETE FROM pay_login_qr WHERE expires_at < ? OR status = 'consumed'`)
    .run(Date.now() - 60 * 60 * 1000)
  return result.changes
}


function parseAnnotationsColumn(raw: unknown): unknown[] | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function rowToDocument(row: Record<string, unknown>): DocumentRecord {
  const requiredSignatures = row.required_signatures as number | null | undefined
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    originalFilename: (row.original_filename as string | null) ?? null,
    type: row.type as string,
    status: row.status as DocumentStatus,
    creatorAddress: row.creator_address as string,
    originalSha256: row.original_sha256 as string,
    finalSha256: (row.final_sha256 as string | null) ?? null,
    pageCount: row.page_count as number,
    metadata: row.metadata ? (JSON.parse(row.metadata as string) as Record<string, unknown>) : null,
    annotations: parseAnnotationsColumn(row.annotations),
    requiredSignatures: requiredSignatures ?? 0,
    createdAt: row.created_at as number,
    lockedAt: (row.locked_at as number | null) ?? null,
    creatorNotifyEmail: (row.creator_notify_email as string | null) ?? null,
    readyToSealEmailSentAt:
      (row.ready_to_seal_email_sent_at as number | null | undefined) ?? null,
    creatorDisplayName: (row.creator_display_name as string | null | undefined) ?? null,
    authMode: (row.auth_mode as DocumentRecord['authMode'] | null | undefined) ?? 'wallet',
    creatorDocumentKeyHash: (row.creator_document_key_hash as string | null | undefined) ?? null,
    creatorDocumentKeyCreatedAt:
      (row.creator_document_key_created_at as number | null | undefined) ?? null,
    claimedAt: (row.claimed_at as number | null | undefined) ?? null,
    claimedFromGuest: Boolean(row.claimed_from_guest),
  }
}

export function insertDocument(doc: DocumentRecord): void {
  db.prepare(`
    INSERT INTO documents (
      id, slug, title, original_filename, type, status, creator_address,
      original_sha256, final_sha256, page_count, metadata, annotations, required_signatures,
      created_at, locked_at, creator_notify_email, ready_to_seal_email_sent_at, creator_display_name,
      auth_mode, creator_document_key_hash, creator_document_key_created_at, claimed_at, claimed_from_guest
    )
    VALUES (
      @id, @slug, @title, @originalFilename, @type, @status, @creatorAddress,
      @originalSha256, @finalSha256, @pageCount, @metadata, @annotations, @requiredSignatures,
      @createdAt, @lockedAt, @creatorNotifyEmail, @readyToSealEmailSentAt, @creatorDisplayName,
      @authMode, @creatorDocumentKeyHash, @creatorDocumentKeyCreatedAt, @claimedAt, @claimedFromGuest
    )
  `).run({
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    originalFilename: doc.originalFilename,
    type: doc.type,
    status: doc.status,
    creatorAddress: doc.creatorAddress,
    originalSha256: doc.originalSha256,
    finalSha256: doc.finalSha256,
    pageCount: doc.pageCount,
    metadata: doc.metadata ? JSON.stringify(doc.metadata) : null,
    annotations:
      doc.annotations && doc.annotations.length > 0 ? JSON.stringify(doc.annotations) : null,
    requiredSignatures: doc.requiredSignatures,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
    creatorNotifyEmail: doc.creatorNotifyEmail,
    readyToSealEmailSentAt: doc.readyToSealEmailSentAt,
    creatorDisplayName: doc.creatorDisplayName,
    // Default to the wallet-path shape so callers built before the guest-signing
    // columns existed (e.g. server/scripts/test-annotations.mjs, which constructs a
    // DocumentRecord literal directly) don't break on a missing bound param - mirrors
    // the columns' own `DEFAULT 'wallet'` / NULL / 0 semantics.
    authMode: doc.authMode ?? 'wallet',
    creatorDocumentKeyHash: doc.creatorDocumentKeyHash ?? null,
    creatorDocumentKeyCreatedAt: doc.creatorDocumentKeyCreatedAt ?? null,
    claimedAt: doc.claimedAt ?? null,
    claimedFromGuest: doc.claimedFromGuest ? 1 : 0,
  })
}

export function setDocumentNotifyEmail(documentId: string, email: string | null): void {
  db.prepare('UPDATE documents SET creator_notify_email = ? WHERE id = ?').run(email, documentId)
}

/** Returns email only if ready-to-seal mail has not already been sent. */
export function getDocumentNotifyEmail(documentId: string): string | null {
  const row = db
    .prepare(
      `SELECT creator_notify_email, ready_to_seal_email_sent_at
       FROM documents WHERE id = ?`,
    )
    .get(documentId) as
    | { creator_notify_email: string | null; ready_to_seal_email_sent_at: number | null }
    | undefined
  if (!row) return null
  if (row.ready_to_seal_email_sent_at) return null
  const email = row.creator_notify_email?.trim()
  return email || null
}

export function markReadyToSealEmailSent(documentId: string, at = Date.now()): void {
  db.prepare(
    'UPDATE documents SET ready_to_seal_email_sent_at = ? WHERE id = ? AND ready_to_seal_email_sent_at IS NULL',
  ).run(at, documentId)
}

export function getDocumentById(id: string): DocumentRecord | null {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToDocument(row) : null
}

export function getDocumentBySlug(slug: string): DocumentRecord | null {
  const row = db.prepare('SELECT * FROM documents WHERE slug = ?').get(slug) as Record<string, unknown> | undefined
  return row ? rowToDocument(row) : null
}

export function updateDocumentStatus(id: string, status: DocumentStatus): void {
  db.prepare('UPDATE documents SET status = ? WHERE id = ?').run(status, id)
}

export function updateDocumentRequiredSignatures(id: string, requiredSignatures: number): void {
  db.prepare('UPDATE documents SET required_signatures = ? WHERE id = ?').run(
    requiredSignatures,
    id,
  )
}

export function deletePartyById(partyId: string): void {
  try {
    db.prepare('DELETE FROM party_invites WHERE party_id = ?').run(partyId)
  } catch {
    /* optional during early migrate */
  }
  db.prepare('DELETE FROM document_parties WHERE id = ?').run(partyId)
}

export function setDocumentFinalSha256(id: string, finalSha256: string, status: DocumentStatus): void {
  db.prepare('UPDATE documents SET final_sha256 = ?, status = ? WHERE id = ?').run(finalSha256, status, id)
}

export function lockDocument(id: string, lockedAt: number): void {
  db.prepare('UPDATE documents SET status = ?, locked_at = ? WHERE id = ?').run('locked', lockedAt, id)
}

/**
 * One-shot: flips a guest document to wallet ownership. Guarded by `WHERE auth_mode = 'guest'`
 * so a race between two claim attempts (or a claim on an already-claimed/wallet-native doc)
 * is caught here, not just in application logic - the SECOND caller gets `changes === 0`.
 */
export function claimDocumentToWallet(
  documentId: string,
  walletAddress: string,
  claimedAt: number,
): boolean {
  const wallet = normalizeAddress(walletAddress)
  const result = db
    .prepare(
      `UPDATE documents
       SET creator_address = ?, auth_mode = 'claimed', claimed_at = ?, claimed_from_guest = 1
       WHERE id = ? AND auth_mode = 'guest'`,
    )
    .run(wallet, claimedAt, documentId)
  return result.changes === 1
}

export function deleteDocumentById(documentId: string): boolean {
  const doc = getDocumentById(documentId)
  if (!doc) return false

  const remove = db.transaction((id: string) => {
    const signatureIds = db
      .prepare('SELECT id FROM signatures WHERE document_id = ?')
      .all(id) as Array<{ id: string }>
    for (const { id: signatureId } of signatureIds) {
      db.prepare('DELETE FROM signature_images WHERE signature_id = ?').run(signatureId)
    }
    db.prepare('DELETE FROM signatures WHERE document_id = ?').run(id)
    db.prepare('DELETE FROM attestations WHERE document_id = ?').run(id)
    try {
      db.prepare('DELETE FROM party_invites WHERE document_id = ?').run(id)
    } catch {
      /* table always present after migrate; defensive for odd envs */
    }
    db.prepare('DELETE FROM document_parties WHERE document_id = ?').run(id)
    // Placement plans + data-archive index rows (chain txs stay on Nimiq).
    try {
      db.prepare('DELETE FROM placement_plans WHERE document_id = ?').run(id)
    } catch {
      /* table may not exist in very old DBs */
    }
    try {
      db.prepare('DELETE FROM document_data_archives WHERE document_id = ?').run(id)
    } catch {
      /* optional table */
    }
    try {
      db.prepare('DELETE FROM credit_reservations WHERE document_id = ?').run(id)
    } catch {
      /* optional */
    }
    try {
      db.prepare('DELETE FROM document_list_prefs WHERE document_id = ?').run(id)
    } catch {
      /* optional table */
    }
    // Guest sessions FK-reference document_id with no cascade - only ever populated
    // for guest-created/claimed documents (wallet docs never have rows here), so this
    // is a no-op for the wallet-native delete path. Without it, cancelling a guest
    // draft while its own creator session is still active hits a FK violation.
    try {
      db.prepare('DELETE FROM guest_sessions WHERE document_id = ?').run(id)
    } catch {
      /* defensive - table always present after migrate */
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(id)
  })

  remove(documentId)
  return true
}

function normalizedAddressExpr(column: string): string {
  return `UPPER(REPLACE(${column}, ' ', ''))`
}

export function listDocumentsForAddress(address: string): DocumentRecord[] {
  const wallet = normalizeAddress(address)
  const rows = db
    .prepare(
      `SELECT DISTINCT d.* FROM documents d
       LEFT JOIN document_parties p ON p.document_id = d.id
       LEFT JOIN signatures s ON s.document_id = d.id
       WHERE ${normalizedAddressExpr('d.creator_address')} = ?
          OR ${normalizedAddressExpr('p.wallet_address')} = ?
          OR ${normalizedAddressExpr('s.signer_address')} = ?
       ORDER BY d.created_at DESC LIMIT 100`,
    )
    .all(wallet, wallet, wallet) as Record<string, unknown>[]
  return rows.map(rowToDocument)
}

// ── Per-wallet list prefs (soft “hide from default list”) ───────────────────
// Distinct from on-chain data archive (`document_data_archives`). This only
// affects how the agreements inbox is organized for one wallet.

db.exec(`
  CREATE TABLE IF NOT EXISTS document_list_prefs (
    wallet_address TEXT NOT NULL,
    document_id TEXT NOT NULL,
    archived_at INTEGER NOT NULL,
    PRIMARY KEY (wallet_address, document_id)
  );
  CREATE INDEX IF NOT EXISTS idx_document_list_prefs_wallet
    ON document_list_prefs(wallet_address);
`)

/** Soft-archive (or restore) a document for one wallet’s agreements list. */
export function setDocumentListArchived(
  walletAddress: string,
  documentId: string,
  archived: boolean,
): number | null {
  const wallet = normalizeAddress(walletAddress)
  const id = documentId.trim()
  if (!id) return null
  if (archived) {
    const at = Date.now()
    db.prepare(
      `INSERT INTO document_list_prefs (wallet_address, document_id, archived_at)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet_address, document_id) DO UPDATE SET archived_at = excluded.archived_at`,
    ).run(wallet, id, at)
    return at
  }
  db.prepare(
    'DELETE FROM document_list_prefs WHERE wallet_address = ? AND document_id = ?',
  ).run(wallet, id)
  return null
}

/** archived_at timestamps for a wallet across a set of document ids. */
export function getDocumentListArchivedMap(
  walletAddress: string,
  documentIds: string[],
): Map<string, number> {
  const out = new Map<string, number>()
  const wallet = normalizeAddress(walletAddress)
  const ids = documentIds.map(id => id.trim()).filter(Boolean)
  if (ids.length === 0) return out

  // Chunk IN queries to stay under SQLite variable limits.
  const chunkSize = 80
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT document_id, archived_at FROM document_list_prefs
         WHERE wallet_address = ? AND document_id IN (${placeholders})`,
      )
      .all(wallet, ...chunk) as Array<{ document_id: string; archived_at: number }>
    for (const row of rows) {
      if (typeof row.archived_at === 'number' && row.archived_at > 0) {
        out.set(row.document_id, row.archived_at)
      }
    }
  }
  return out
}

export function getDocumentListArchivedAt(
  walletAddress: string,
  documentId: string,
): number | null {
  const wallet = normalizeAddress(walletAddress)
  const id = documentId.trim()
  if (!id) return null
  const row = db
    .prepare(
      `SELECT archived_at FROM document_list_prefs
       WHERE wallet_address = ? AND document_id = ?`,
    )
    .get(wallet, id) as { archived_at: number } | undefined
  if (!row || typeof row.archived_at !== 'number' || row.archived_at <= 0) return null
  return row.archived_at
}

export function insertParty(party: PartyRecord): void {
  db.prepare(`
    INSERT INTO document_parties (id, document_id, role, display_name, wallet_address, sort_order, required, status, signed_at)
    VALUES (@id, @documentId, @role, @displayName, @walletAddress, @sortOrder, @required, @status, @signedAt)
  `).run({
    id: party.id,
    documentId: party.documentId,
    role: party.role,
    displayName: party.displayName,
    walletAddress: party.walletAddress,
    sortOrder: party.sortOrder,
    required: party.required ? 1 : 0,
    status: party.status,
    signedAt: party.signedAt,
  })
}

function mapPartyRow(row: Record<string, unknown>): PartyRecord {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    role: row.role as string,
    displayName: row.display_name as string,
    walletAddress: (row.wallet_address as string | null) ?? null,
    sortOrder: row.sort_order as number,
    required: Boolean(row.required),
    status: row.status as PartyRecord['status'],
    signedAt: (row.signed_at as number | null) ?? null,
    inviteEmail: (row.invite_email as string | null | undefined) ?? null,
    inviteSentAt: (row.invite_sent_at as number | null | undefined) ?? null,
  }
}

function mapSignatureRow(row: Record<string, unknown>): SignatureRecord {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    partyId: row.party_id as string,
    signerAddress: row.signer_address as string,
    signatureType: row.signature_type as string,
    clientSha256: row.client_sha256 as string,
    signedAt: row.signed_at as number,
    invitedAsEmail: (row.invited_as_email as string | null | undefined) ?? null,
    inviteId: (row.invite_id as string | null | undefined) ?? null,
    authMethod: (row.auth_method as SignatureRecord['authMethod'] | null | undefined) ?? 'wallet',
    signerSubject: (row.signer_subject as string | null | undefined) ?? null,
  }
}

function mapPartyInviteRow(row: Record<string, unknown>): PartyInviteRecord {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    partyId: row.party_id as string,
    email: row.email as string,
    tokenHash: row.token_hash as string,
    channel: row.channel as string,
    createdAt: row.created_at as number,
    expiresAt: (row.expires_at as number | null | undefined) ?? null,
    revokedAt: (row.revoked_at as number | null | undefined) ?? null,
    redeemedAt: (row.redeemed_at as number | null | undefined) ?? null,
    redeemedByWallet: (row.redeemed_by_wallet as string | null | undefined) ?? null,
    resendMessageId: (row.resend_message_id as string | null | undefined) ?? null,
  }
}

export function getPartiesForDocument(documentId: string): PartyRecord[] {
  const rows = db
    .prepare('SELECT * FROM document_parties WHERE document_id = ? ORDER BY sort_order ASC')
    .all(documentId) as Record<string, unknown>[]
  return rows.map(mapPartyRow)
}

export function markPartySigned(partyId: string): void {
  db.prepare('UPDATE document_parties SET status = ?, signed_at = ? WHERE id = ?').run(
    'signed',
    Date.now(),
    partyId,
  )
}

/** Clear signed status when no signature row exists (repair inconsistent state). */
export function markPartyUnsigned(partyId: string): void {
  db.prepare(
    `UPDATE document_parties SET status = ?, signed_at = NULL WHERE id = ? AND status = ?`,
  ).run('pending', partyId, 'signed')
}

export function assignPartyWallet(partyId: string, walletAddress: string): void {
  db.prepare('UPDATE document_parties SET wallet_address = ? WHERE id = ?').run(
    normalizeAddress(walletAddress),
    partyId,
  )
}

/**
 * Atomically claim an open party slot for a wallet.
 * Succeeds only when the party is still pending and unassigned.
 * Safe under concurrent multi-process writers (UPDATE … WHERE wallet_address IS NULL).
 */
export function claimPartyWalletIfOpen(partyId: string, walletAddress: string): boolean {
  const wallet = normalizeAddress(walletAddress)
  try {
    const result = db
      .prepare(
        `UPDATE document_parties
         SET wallet_address = ?
         WHERE id = ?
           AND wallet_address IS NULL
           AND status = 'pending'`,
      )
      .run(wallet, partyId)
    return result.changes === 1
  } catch (err) {
    // Unique index on (document_id, wallet) - this wallet already owns another party.
    const message = err instanceof Error ? err.message.toLowerCase() : ''
    if (message.includes('unique')) return false
    throw err
  }
}

export function getPartyById(partyId: string): PartyRecord | null {
  const row = db
    .prepare('SELECT * FROM document_parties WHERE id = ?')
    .get(partyId) as Record<string, unknown> | undefined
  if (!row) return null
  return mapPartyRow(row)
}

export function setPartyInviteEmail(
  partyId: string,
  email: string | null,
  sentAt: number | null,
): void {
  db.prepare(
    'UPDATE document_parties SET invite_email = ?, invite_sent_at = ? WHERE id = ?',
  ).run(email, sentAt, partyId)
}

export function insertPartyInvite(invite: PartyInviteRecord): void {
  db.prepare(`
    INSERT INTO party_invites (
      id, document_id, party_id, email, token_hash, channel,
      created_at, expires_at, revoked_at, redeemed_at, redeemed_by_wallet, resend_message_id
    ) VALUES (
      @id, @documentId, @partyId, @email, @tokenHash, @channel,
      @createdAt, @expiresAt, @revokedAt, @redeemedAt, @redeemedByWallet, @resendMessageId
    )
  `).run({
    id: invite.id,
    documentId: invite.documentId,
    partyId: invite.partyId,
    email: invite.email,
    tokenHash: invite.tokenHash,
    channel: invite.channel,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    redeemedAt: invite.redeemedAt,
    redeemedByWallet: invite.redeemedByWallet,
    resendMessageId: invite.resendMessageId,
  })
}

/** Revoke all non-revoked, non-redeemed invites for a party (resend rotates). */
export function revokeActivePartyInvites(partyId: string, at = Date.now()): number {
  const result = db
    .prepare(
      `UPDATE party_invites
       SET revoked_at = ?
       WHERE party_id = ?
         AND revoked_at IS NULL
         AND redeemed_at IS NULL`,
    )
    .run(at, partyId)
  return result.changes
}

export function revokePartyInviteById(inviteId: string, at = Date.now()): boolean {
  const result = db
    .prepare(
      `UPDATE party_invites
       SET revoked_at = ?
       WHERE id = ?
         AND revoked_at IS NULL
         AND redeemed_at IS NULL`,
    )
    .run(at, inviteId)
  return result.changes === 1
}

export function getActiveInviteForParty(
  partyId: string,
  now = Date.now(),
): PartyInviteRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM party_invites
       WHERE party_id = ?
         AND revoked_at IS NULL
         AND redeemed_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(partyId, now) as Record<string, unknown> | undefined
  return row ? mapPartyInviteRow(row) : null
}

export type PartyInviteLookupStatus =
  | 'active'
  | 'revoked'
  | 'redeemed'
  | 'expired'
  | 'not_found'

export type PartyInviteLookupResult =
  | { status: 'active'; invite: PartyInviteRecord }
  | { status: 'revoked' | 'redeemed' | 'expired'; invite: PartyInviteRecord }
  | { status: 'not_found'; invite: null }

/**
 * Inspect invite by token hash including inactive rows (for lookup UX).
 * Signing / gates should keep using {@link getPartyInviteByTokenHash} (active only).
 */
export function inspectPartyInviteByTokenHash(
  tokenHash: string,
  now = Date.now(),
): PartyInviteLookupResult {
  const row = db
    .prepare('SELECT * FROM party_invites WHERE token_hash = ?')
    .get(tokenHash) as Record<string, unknown> | undefined
  if (!row) return { status: 'not_found', invite: null }
  const invite = mapPartyInviteRow(row)
  if (invite.revokedAt) return { status: 'revoked', invite }
  if (invite.redeemedAt) return { status: 'redeemed', invite }
  if (invite.expiresAt != null && invite.expiresAt <= now) {
    return { status: 'expired', invite }
  }
  return { status: 'active', invite }
}

export function getPartyInviteByTokenHash(
  tokenHash: string,
  now = Date.now(),
): PartyInviteRecord | null {
  const result = inspectPartyInviteByTokenHash(tokenHash, now)
  return result.status === 'active' ? result.invite : null
}

export function markPartyInviteRedeemed(
  inviteId: string,
  walletAddress: string,
  at = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE party_invites
       SET redeemed_at = ?, redeemed_by_wallet = ?
       WHERE id = ?
         AND redeemed_at IS NULL
         AND revoked_at IS NULL`,
    )
    .run(at, normalizeAddress(walletAddress), inviteId)
  return result.changes === 1
}

export function setPartyInviteMessageId(inviteId: string, messageId: string | null): void {
  db.prepare('UPDATE party_invites SET resend_message_id = ? WHERE id = ?').run(
    messageId,
    inviteId,
  )
}

/** Run work inside an IMMEDIATE SQLite transaction (serialized writers). */
export function runInTransaction<T>(fn: () => T): T {
  return db.transaction(fn).immediate()
}

export function isUniqueConstraintError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
  return message.includes('unique')
}

export function updatePartyDisplayName(partyId: string, displayName: string): void {
  db.prepare('UPDATE document_parties SET display_name = ? WHERE id = ?').run(displayName, partyId)
}

export function insertSignature(sig: SignatureRecord): void {
  db.prepare(`
    INSERT INTO signatures (
      id, document_id, party_id, signer_address, signature_type, client_sha256, signed_at,
      invited_as_email, invite_id, auth_method, signer_subject
    )
    VALUES (
      @id, @documentId, @partyId, @signerAddress, @signatureType, @clientSha256, @signedAt,
      @invitedAsEmail, @inviteId, @authMethod, @signerSubject
    )
  `).run({
    id: sig.id,
    documentId: sig.documentId,
    partyId: sig.partyId,
    signerAddress: sig.signerAddress,
    signatureType: sig.signatureType,
    clientSha256: sig.clientSha256,
    signedAt: sig.signedAt,
    invitedAsEmail: sig.invitedAsEmail,
    inviteId: sig.inviteId,
    // Same defensive default as insertDocument() - see comment there.
    authMethod: sig.authMethod ?? 'wallet',
    signerSubject: sig.signerSubject ?? null,
  })
}

export function getSignaturesForDocument(documentId: string): SignatureRecord[] {
  const rows = db
    .prepare('SELECT * FROM signatures WHERE document_id = ? ORDER BY signed_at ASC')
    .all(documentId) as Record<string, unknown>[]
  return rows.map(mapSignatureRow)
}

export function insertSignatureImage(image: SignatureImageRecord): void {
  db.prepare(`
    INSERT INTO signature_images (signature_id, image_blob, content_type, byte_size, image_sha256)
    VALUES (@signatureId, @imageBlob, @contentType, @byteSize, @imageSha256)
  `).run({
    signatureId: image.signatureId,
    imageBlob: image.imageBlob,
    contentType: image.contentType,
    byteSize: image.byteSize,
    imageSha256: image.imageSha256,
  })
}

export function getSignatureImage(signatureId: string): SignatureImageRecord | null {
  const row = db
    .prepare('SELECT * FROM signature_images WHERE signature_id = ?')
    .get(signatureId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    signatureId: row.signature_id as string,
    imageBlob: row.image_blob as Buffer,
    contentType: row.content_type as string,
    byteSize: row.byte_size as number,
    imageSha256: row.image_sha256 as string,
  }
}

export function getSignatureImageIdsForDocument(documentId: string): Set<string> {
  const rows = db
    .prepare(`
      SELECT si.signature_id AS signature_id
      FROM signature_images si
      INNER JOIN signatures s ON s.id = si.signature_id
      WHERE s.document_id = ?
    `)
    .all(documentId) as Array<{ signature_id: string }>
  return new Set(rows.map(row => row.signature_id))
}

export function getSignatureForDocument(documentId: string, signatureId: string): SignatureRecord | null {
  const row = db
    .prepare('SELECT * FROM signatures WHERE id = ? AND document_id = ?')
    .get(signatureId, documentId) as Record<string, unknown> | undefined
  if (!row) return null
  return mapSignatureRow(row)
}

export function createAttestation(att: AttestationRecord): void {
  db.prepare(`
    INSERT INTO attestations (id, document_id, tx_hash, sender_address, payload, final_sha256, block_number, status, created_at, resolved_at, error)
    VALUES (@id, @documentId, @txHash, @senderAddress, @payload, @finalSha256, @blockNumber, @status, @createdAt, @resolvedAt, @error)
  `).run({
    id: att.id,
    documentId: att.documentId,
    txHash: att.txHash,
    senderAddress: att.senderAddress,
    payload: att.payload,
    finalSha256: att.finalSha256,
    blockNumber: att.blockNumber,
    status: att.status,
    createdAt: att.createdAt,
    resolvedAt: att.resolvedAt,
    error: att.error,
  })
}

export function getAttestationByTxHash(txHash: string): AttestationRecord | null {
  const row = db
    .prepare('SELECT * FROM attestations WHERE tx_hash = ?')
    .get(txHash) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    txHash: row.tx_hash as string,
    senderAddress: row.sender_address as string,
    payload: row.payload as string,
    finalSha256: row.final_sha256 as string,
    blockNumber: (row.block_number as number | null) ?? null,
    status: row.status as AttestationRecord['status'],
    createdAt: row.created_at as number,
    resolvedAt: (row.resolved_at as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  }
}

export function getAttestationForDocument(documentId: string): AttestationRecord | null {
  const row = db
    .prepare('SELECT * FROM attestations WHERE document_id = ?')
    .get(documentId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    txHash: row.tx_hash as string,
    senderAddress: row.sender_address as string,
    payload: row.payload as string,
    finalSha256: row.final_sha256 as string,
    blockNumber: (row.block_number as number | null) ?? null,
    status: row.status as AttestationRecord['status'],
    createdAt: row.created_at as number,
    resolvedAt: (row.resolved_at as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  }
}

export function updateAttestation(
  txHash: string,
  patch: Partial<Pick<AttestationRecord, 'status' | 'blockNumber' | 'resolvedAt' | 'error'>>,
): void {
  const current = getAttestationByTxHash(txHash)
  if (!current) return
  db.prepare(`
    UPDATE attestations SET status = ?, block_number = ?, resolved_at = ?, error = ? WHERE tx_hash = ?
  `).run(
    patch.status ?? current.status,
    patch.blockNumber ?? current.blockNumber,
    patch.resolvedAt ?? current.resolvedAt,
    patch.error ?? current.error,
    txHash,
  )
}

/** Replace a pending/failed attestation when the user retries lock with a new transaction. */
export function replaceAttestationForDocument(
  documentId: string,
  att: Pick<
    AttestationRecord,
    'txHash' | 'senderAddress' | 'payload' | 'finalSha256' | 'status' | 'createdAt' | 'resolvedAt' | 'error'
  >,
): void {
  db.prepare(`
    UPDATE attestations
    SET tx_hash = ?, sender_address = ?, payload = ?, final_sha256 = ?, block_number = NULL,
        status = ?, created_at = ?, resolved_at = ?, error = ?
    WHERE document_id = ?
  `).run(
    att.txHash,
    att.senderAddress,
    att.payload,
    att.finalSha256,
    att.status,
    att.createdAt,
    att.resolvedAt,
    att.error,
    documentId,
  )
}

export function isTxUsed(txHash: string): boolean {
  const row = db.prepare('SELECT 1 FROM attestations WHERE tx_hash = ?').get(txHash)
  return Boolean(row)
}

export function getPendingAttestations(): AttestationRecord[] {
  const rows = db
    .prepare(`SELECT * FROM attestations WHERE status = 'pending' ORDER BY created_at ASC`)
    .all() as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    documentId: row.document_id as string,
    txHash: row.tx_hash as string,
    senderAddress: row.sender_address as string,
    payload: row.payload as string,
    finalSha256: row.final_sha256 as string,
    blockNumber: (row.block_number as number | null) ?? null,
    status: row.status as AttestationRecord['status'],
    createdAt: row.created_at as number,
    resolvedAt: (row.resolved_at as number | null) ?? null,
    error: (row.error as string | null) ?? null,
  }))
}

export function findDocumentsByHash(sha256: string): DocumentRecord[] {
  const rows = db
    .prepare(
      `SELECT * FROM documents WHERE original_sha256 = ? OR final_sha256 = ? ORDER BY created_at DESC`,
    )
    .all(sha256.toLowerCase(), sha256.toLowerCase()) as Record<string, unknown>[]
  return rows.map(rowToDocument)
}

// ── Annotation streams (experiment: multi-tx overlay index by PDF hash) ────

db.exec(`
  CREATE TABLE IF NOT EXISTS annotation_streams (
    original_sha256 TEXT PRIMARY KEY,
    creator_address TEXT NOT NULL DEFAULT '',
    frames_json TEXT NOT NULL,
    tx_hashes_json TEXT,
    annotation_count INTEGER NOT NULL DEFAULT 0,
    payload_bytes INTEGER NOT NULL DEFAULT 0,
    on_chain INTEGER NOT NULL DEFAULT 0,
    confirmed_frames INTEGER NOT NULL DEFAULT 0,
    annotations_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const annotationStreamColumns = db
  .prepare('PRAGMA table_info(annotation_streams)')
  .all() as Array<{ name: string }>
if (!annotationStreamColumns.some(col => col.name === 'creator_address')) {
  db.exec(`ALTER TABLE annotation_streams ADD COLUMN creator_address TEXT NOT NULL DEFAULT ''`)
}
if (!annotationStreamColumns.some(col => col.name === 'confirmed_frames')) {
  db.exec(`ALTER TABLE annotation_streams ADD COLUMN confirmed_frames INTEGER NOT NULL DEFAULT 0`)
}

export interface AnnotationStreamRecord {
  originalSha256: string
  /** Wallet that published; only this address may overwrite. */
  creatorAddress: string
  framesHex: string[]
  txHashes: string[]
  annotationCount: number
  payloadBytes: number
  onChain: boolean
  confirmedFrames: number
  annotationsJson: string
  createdAt: number
  updatedAt: number
}

function rowToAnnotationStream(row: Record<string, unknown>): AnnotationStreamRecord {
  let framesHex: string[] = []
  let txHashes: string[] = []
  try {
    framesHex = JSON.parse(String(row.frames_json ?? '[]')) as string[]
  } catch {
    framesHex = []
  }
  try {
    txHashes = JSON.parse(String(row.tx_hashes_json ?? '[]')) as string[]
  } catch {
    txHashes = []
  }
  return {
    originalSha256: row.original_sha256 as string,
    creatorAddress: String(row.creator_address ?? ''),
    framesHex: Array.isArray(framesHex) ? framesHex : [],
    txHashes: Array.isArray(txHashes) ? txHashes : [],
    annotationCount: Number(row.annotation_count ?? 0),
    payloadBytes: Number(row.payload_bytes ?? 0),
    onChain: Boolean(row.on_chain),
    confirmedFrames: Number(row.confirmed_frames ?? 0),
    annotationsJson: String(row.annotations_json ?? '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function upsertAnnotationStream(rec: AnnotationStreamRecord): void {
  db.prepare(`
    INSERT INTO annotation_streams (
      original_sha256, creator_address, frames_json, tx_hashes_json, annotation_count, payload_bytes,
      on_chain, confirmed_frames, annotations_json, created_at, updated_at
    ) VALUES (
      @originalSha256, @creatorAddress, @framesJson, @txHashesJson, @annotationCount, @payloadBytes,
      @onChain, @confirmedFrames, @annotationsJson, @createdAt, @updatedAt
    )
    ON CONFLICT(original_sha256) DO UPDATE SET
      creator_address = excluded.creator_address,
      frames_json = excluded.frames_json,
      tx_hashes_json = excluded.tx_hashes_json,
      annotation_count = excluded.annotation_count,
      payload_bytes = excluded.payload_bytes,
      on_chain = excluded.on_chain,
      confirmed_frames = excluded.confirmed_frames,
      annotations_json = excluded.annotations_json,
      updated_at = excluded.updated_at
  `).run({
    originalSha256: rec.originalSha256,
    creatorAddress: rec.creatorAddress,
    framesJson: JSON.stringify(rec.framesHex),
    txHashesJson: JSON.stringify(rec.txHashes),
    annotationCount: rec.annotationCount,
    payloadBytes: rec.payloadBytes,
    onChain: rec.onChain ? 1 : 0,
    confirmedFrames: rec.confirmedFrames,
    annotationsJson: rec.annotationsJson,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  })
}

export function getAnnotationStream(originalSha256: string): AnnotationStreamRecord | null {
  const row = db
    .prepare('SELECT * FROM annotation_streams WHERE original_sha256 = ?')
    .get(originalSha256.toLowerCase()) as Record<string, unknown> | undefined
  return row ? rowToAnnotationStream(row) : null
}

// ── Document data archives (paid multi-tx overlay storage on Nimiq) ─────────

db.exec(`
  CREATE TABLE IF NOT EXISTS document_data_archives (
    document_id TEXT PRIMARY KEY,
    original_sha256 TEXT NOT NULL,
    source TEXT NOT NULL,
    frame_count INTEGER NOT NULL DEFAULT 0,
    credits_charged INTEGER NOT NULL DEFAULT 0,
    frames_json TEXT NOT NULL DEFAULT '[]',
    tx_hashes_json TEXT NOT NULL DEFAULT '[]',
    on_chain INTEGER NOT NULL DEFAULT 0,
    confirmed_frames INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_document_data_archives_sha
    ON document_data_archives(original_sha256);
`)

/** job_status: idle | processing | complete | failed */
const dataArchiveCols = db
  .prepare('PRAGMA table_info(document_data_archives)')
  .all() as Array<{ name: string }>
if (!dataArchiveCols.some(c => c.name === 'job_status')) {
  db.exec(
    `ALTER TABLE document_data_archives ADD COLUMN job_status TEXT NOT NULL DEFAULT 'idle'`,
  )
}

export type DocumentDataArchiveSource = 'placements' | 'annotations'
export type DocumentDataArchiveJobStatus = 'idle' | 'processing' | 'complete' | 'failed'

export interface DocumentDataArchiveRecord {
  documentId: string
  originalSha256: string
  source: DocumentDataArchiveSource
  frameCount: number
  creditsCharged: number
  framesHex: string[]
  txHashes: string[]
  onChain: boolean
  confirmedFrames: number
  error: string | null
  jobStatus: DocumentDataArchiveJobStatus
  createdAt: number
  updatedAt: number
}

function parseJobStatus(raw: unknown): DocumentDataArchiveJobStatus {
  const s = String(raw ?? 'idle')
  if (s === 'processing' || s === 'complete' || s === 'failed' || s === 'idle') return s
  return 'idle'
}

function rowToDataArchive(row: Record<string, unknown>): DocumentDataArchiveRecord {
  let framesHex: string[] = []
  let txHashes: string[] = []
  try {
    framesHex = JSON.parse(String(row.frames_json ?? '[]')) as string[]
  } catch {
    framesHex = []
  }
  try {
    txHashes = JSON.parse(String(row.tx_hashes_json ?? '[]')) as string[]
  } catch {
    txHashes = []
  }
  const sourceRaw = String(row.source ?? 'annotations')
  const source: DocumentDataArchiveSource =
    sourceRaw === 'placements' ? 'placements' : 'annotations'
  return {
    documentId: String(row.document_id),
    originalSha256: String(row.original_sha256),
    source,
    frameCount: Number(row.frame_count ?? 0),
    creditsCharged: Number(row.credits_charged ?? 0),
    framesHex: Array.isArray(framesHex) ? framesHex : [],
    txHashes: Array.isArray(txHashes) ? txHashes : [],
    onChain: Boolean(row.on_chain),
    confirmedFrames: Number(row.confirmed_frames ?? 0),
    error: row.error != null ? String(row.error) : null,
    jobStatus: parseJobStatus(row.job_status),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function getDocumentDataArchive(documentId: string): DocumentDataArchiveRecord | null {
  const row = db
    .prepare('SELECT * FROM document_data_archives WHERE document_id = ?')
    .get(documentId) as Record<string, unknown> | undefined
  return row ? rowToDataArchive(row) : null
}

/**
 * Public reconstruct index: latest on-chain archive for a PDF fingerprint.
 *
 * Lab rows (`lab:<sha>`) are excluded so historical free lab publishes never displace
 * paid production "Store forever" archives for the same fingerprint.
 * Prefer on_chain complete non-lab rows; fall back to any non-lab row with frames.
 */
export function getDocumentDataArchiveBySha256(
  originalSha256: string,
): DocumentDataArchiveRecord | null {
  const hash = originalSha256.toLowerCase()
  // Exclude lab: prefix — production document ids are UUIDs (never start with lab:)
  const onChain = db
    .prepare(
      `SELECT * FROM document_data_archives
       WHERE original_sha256 = ?
         AND on_chain = 1
         AND document_id NOT LIKE 'lab:%'
       ORDER BY
         CASE WHEN credits_charged > 0 THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 1`,
    )
    .get(hash) as Record<string, unknown> | undefined
  if (onChain) return rowToDataArchive(onChain)
  const any = db
    .prepare(
      `SELECT * FROM document_data_archives
       WHERE original_sha256 = ?
         AND document_id NOT LIKE 'lab:%'
       ORDER BY
         CASE WHEN credits_charged > 0 THEN 0 ELSE 1 END,
         updated_at DESC
       LIMIT 1`,
    )
    .get(hash) as Record<string, unknown> | undefined
  return any ? rowToDataArchive(any) : null
}

/** Lab-only lookup by fingerprint (document_id = lab:&lt;sha&gt;). Not used for public product index. */
export function getLabDocumentDataArchive(
  originalSha256: string,
): DocumentDataArchiveRecord | null {
  const hash = originalSha256.toLowerCase()
  const row = db
    .prepare(
      `SELECT * FROM document_data_archives WHERE document_id = ?`,
    )
    .get(`lab:${hash}`) as Record<string, unknown> | undefined
  return row ? rowToDataArchive(row) : null
}

export function upsertDocumentDataArchive(rec: DocumentDataArchiveRecord): void {
  const jobStatus: DocumentDataArchiveJobStatus = rec.onChain
    ? 'complete'
    : rec.jobStatus || 'idle'
  db.prepare(`
    INSERT INTO document_data_archives (
      document_id, original_sha256, source, frame_count, credits_charged,
      frames_json, tx_hashes_json, on_chain, confirmed_frames, error, job_status, created_at, updated_at
    ) VALUES (
      @documentId, @originalSha256, @source, @frameCount, @creditsCharged,
      @framesJson, @txHashesJson, @onChain, @confirmedFrames, @error, @jobStatus, @createdAt, @updatedAt
    )
    ON CONFLICT(document_id) DO UPDATE SET
      original_sha256 = excluded.original_sha256,
      source = excluded.source,
      frame_count = excluded.frame_count,
      credits_charged = excluded.credits_charged,
      frames_json = excluded.frames_json,
      tx_hashes_json = excluded.tx_hashes_json,
      on_chain = excluded.on_chain,
      confirmed_frames = excluded.confirmed_frames,
      error = excluded.error,
      job_status = excluded.job_status,
      updated_at = excluded.updated_at
  `).run({
    documentId: rec.documentId,
    originalSha256: rec.originalSha256.toLowerCase(),
    source: rec.source,
    frameCount: rec.frameCount,
    creditsCharged: rec.creditsCharged,
    framesJson: JSON.stringify(rec.framesHex),
    txHashesJson: JSON.stringify(rec.txHashes),
    onChain: rec.onChain ? 1 : 0,
    confirmedFrames: rec.confirmedFrames,
    error: rec.error,
    jobStatus,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  })
}

// ── Placement construction plans (structure + roots only; no PDF / no ink) ─
// Scoped per agreement (document_id PK). Same PDF fingerprint may have many plans.

export interface PlacementFillBatchRecord {
  batchIndex: number
  batchRoot: string
  prevRoot: string
  personSlotIndex: number
  signerAddress: string
  framesHex: string[]
  blobIds: string[]
  fills: Array<{ slotId: string; blobId: string; personSlotIndex: number }>
  createdAt: number
}

export interface PlacementPlanRecord {
  originalSha256: string
  /** Always set after doc-scope migration; legacy rows use `legacy:<sha256>`. */
  documentId: string
  creatorAddress: string
  status: 'draft' | 'locked'
  planJson: string
  planRoot: string | null
  batch0FramesHex: string[]
  batch0Root: string | null
  fillBatches: PlacementFillBatchRecord[]
  slotCount: number
  personCount: number
  lockedAt: number | null
  createdAt: number
  updatedAt: number
}

/** Synthetic document_id for pre-migration hash-only rows. */
export function legacyPlacementDocumentId(originalSha256: string): string {
  return `legacy:${originalSha256.toLowerCase()}`
}

/**
 * Prefer a real document id for hash-only legacy rows so they stay loadable after
 * the client always queries by agreement id.
 */
function documentIdForMigratedPlan(
  sha: string,
  existingDocumentId: string | null,
): string {
  if (existingDocumentId) return existingDocumentId
  try {
    const matches = findDocumentsByHash(sha)
    if (matches.length === 1) return matches[0]!.id
  } catch {
    /* documents table always exists before this migration */
  }
  return legacyPlacementDocumentId(sha)
}

function ensurePlacementPlansDocumentScoped(): void {
  // Resume/cleanup a crashed prior migration.
  const incomplete = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'placement_plans__docscope'`,
    )
    .get() as { name: string } | undefined
  const main = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'placement_plans'`)
    .get() as { sql: string } | undefined

  if (incomplete && main?.sql && /original_sha256\s+TEXT\s+PRIMARY\s+KEY/i.test(main.sql)) {
    db.exec(`DROP TABLE IF EXISTS placement_plans__docscope`)
  } else if (incomplete && !main) {
    db.exec(`ALTER TABLE placement_plans__docscope RENAME TO placement_plans`)
  } else if (incomplete) {
    db.exec(`DROP TABLE IF EXISTS placement_plans__docscope`)
  }

  const master = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'placement_plans'`)
    .get() as { sql: string } | undefined

  if (!master?.sql) {
    db.exec(`
      CREATE TABLE placement_plans (
        document_id TEXT PRIMARY KEY,
        original_sha256 TEXT NOT NULL,
        creator_address TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        plan_json TEXT NOT NULL,
        plan_root TEXT,
        batch0_frames_json TEXT,
        batch0_root TEXT,
        fill_batches_json TEXT NOT NULL DEFAULT '[]',
        slot_count INTEGER NOT NULL DEFAULT 0,
        person_count INTEGER NOT NULL DEFAULT 0,
        locked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_placement_plans_sha ON placement_plans(original_sha256);
    `)
    return
  }

  // Already on document_id primary key.
  if (
    /document_id\s+TEXT\s+PRIMARY\s+KEY/i.test(master.sql) ||
    /PRIMARY\s+KEY\s*\(\s*document_id\s*\)/i.test(master.sql)
  ) {
    const cols = db.prepare('PRAGMA table_info(placement_plans)').all() as Array<{ name: string }>
    if (!cols.some(c => c.name === 'fill_batches_json')) {
      db.exec(
        `ALTER TABLE placement_plans ADD COLUMN fill_batches_json TEXT NOT NULL DEFAULT '[]'`,
      )
    }
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_placement_plans_sha ON placement_plans(original_sha256)`,
    )
    return
  }

  // Migrate: original_sha256 was PRIMARY KEY → one plan per PDF, blocking reuse.
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE placement_plans__docscope (
        document_id TEXT PRIMARY KEY,
        original_sha256 TEXT NOT NULL,
        creator_address TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        plan_json TEXT NOT NULL,
        plan_root TEXT,
        batch0_frames_json TEXT,
        batch0_root TEXT,
        fill_batches_json TEXT NOT NULL DEFAULT '[]',
        slot_count INTEGER NOT NULL DEFAULT 0,
        person_count INTEGER NOT NULL DEFAULT 0,
        locked_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_placement_plans_sha ON placement_plans__docscope(original_sha256);
    `)

    const oldCols = db.prepare('PRAGMA table_info(placement_plans)').all() as Array<{
      name: string
    }>
    const hasFillBatches = oldCols.some(c => c.name === 'fill_batches_json')
    const oldRows = db.prepare('SELECT * FROM placement_plans').all() as Array<
      Record<string, unknown>
    >
    const insert = db.prepare(`
      INSERT OR IGNORE INTO placement_plans__docscope (
        document_id, original_sha256, creator_address, status, plan_json, plan_root,
        batch0_frames_json, batch0_root, fill_batches_json, slot_count, person_count,
        locked_at, created_at, updated_at
      ) VALUES (
        @documentId, @originalSha256, @creatorAddress, @status, @planJson, @planRoot,
        @batch0FramesJson, @batch0Root, @fillBatchesJson, @slotCount, @personCount,
        @lockedAt, @createdAt, @updatedAt
      )
    `)

    for (const row of oldRows) {
      const sha = String(row.original_sha256 ?? '').toLowerCase()
      if (!sha) continue
      const rawDoc =
        row.document_id != null && String(row.document_id).trim()
          ? String(row.document_id).trim()
          : null
      const documentId = documentIdForMigratedPlan(sha, rawDoc)
      insert.run({
        documentId,
        originalSha256: sha,
        creatorAddress: String(row.creator_address ?? ''),
        status: row.status === 'locked' ? 'locked' : 'draft',
        planJson: String(row.plan_json ?? '{}'),
        planRoot: row.plan_root != null ? String(row.plan_root) : null,
        batch0FramesJson: String(row.batch0_frames_json ?? '[]'),
        batch0Root: row.batch0_root != null ? String(row.batch0_root) : null,
        fillBatchesJson: hasFillBatches
          ? String(row.fill_batches_json ?? '[]')
          : '[]',
        slotCount: Number(row.slot_count ?? 0),
        personCount: Number(row.person_count ?? 0),
        lockedAt: row.locked_at != null ? Number(row.locked_at) : null,
        createdAt: Number(row.created_at ?? Date.now()),
        updatedAt: Number(row.updated_at ?? Date.now()),
      })
    }

    db.exec(`
      DROP TABLE placement_plans;
      ALTER TABLE placement_plans__docscope RENAME TO placement_plans;
    `)
  })
  migrate()
}

ensurePlacementPlansDocumentScoped()

function rowToPlacementPlan(row: Record<string, unknown>): PlacementPlanRecord {
  let frames: string[] = []
  try {
    frames = JSON.parse(String(row.batch0_frames_json ?? '[]')) as string[]
  } catch {
    frames = []
  }
  let fillBatches: PlacementFillBatchRecord[] = []
  try {
    const parsed = JSON.parse(String(row.fill_batches_json ?? '[]')) as PlacementFillBatchRecord[]
    fillBatches = Array.isArray(parsed) ? parsed : []
  } catch {
    fillBatches = []
  }
  const status = row.status === 'locked' ? 'locked' : 'draft'
  const sha = String(row.original_sha256)
  const rawDoc = row.document_id != null ? String(row.document_id) : ''
  return {
    originalSha256: sha,
    documentId: rawDoc || legacyPlacementDocumentId(sha),
    creatorAddress: String(row.creator_address ?? ''),
    status,
    planJson: String(row.plan_json ?? '{}'),
    planRoot: row.plan_root != null ? String(row.plan_root) : null,
    batch0FramesHex: Array.isArray(frames) ? frames : [],
    batch0Root: row.batch0_root != null ? String(row.batch0_root) : null,
    fillBatches,
    slotCount: Number(row.slot_count ?? 0),
    personCount: Number(row.person_count ?? 0),
    lockedAt: row.locked_at != null ? Number(row.locked_at) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function upsertPlacementPlan(rec: PlacementPlanRecord): void {
  const documentId =
    rec.documentId?.trim() || legacyPlacementDocumentId(rec.originalSha256)
  db.prepare(`
    INSERT INTO placement_plans (
      document_id, original_sha256, creator_address, status, plan_json, plan_root,
      batch0_frames_json, batch0_root, fill_batches_json, slot_count, person_count, locked_at, created_at, updated_at
    ) VALUES (
      @documentId, @originalSha256, @creatorAddress, @status, @planJson, @planRoot,
      @batch0FramesJson, @batch0Root, @fillBatchesJson, @slotCount, @personCount, @lockedAt, @createdAt, @updatedAt
    )
    ON CONFLICT(document_id) DO UPDATE SET
      original_sha256 = excluded.original_sha256,
      creator_address = excluded.creator_address,
      status = excluded.status,
      plan_json = excluded.plan_json,
      plan_root = excluded.plan_root,
      batch0_frames_json = excluded.batch0_frames_json,
      batch0_root = excluded.batch0_root,
      fill_batches_json = excluded.fill_batches_json,
      slot_count = excluded.slot_count,
      person_count = excluded.person_count,
      locked_at = excluded.locked_at,
      updated_at = excluded.updated_at
  `).run({
    documentId,
    originalSha256: rec.originalSha256.toLowerCase(),
    creatorAddress: rec.creatorAddress,
    status: rec.status,
    planJson: rec.planJson,
    planRoot: rec.planRoot,
    batch0FramesJson: JSON.stringify(rec.batch0FramesHex),
    batch0Root: rec.batch0Root,
    fillBatchesJson: JSON.stringify(rec.fillBatches ?? []),
    slotCount: rec.slotCount,
    personCount: rec.personCount,
    lockedAt: rec.lockedAt,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  })
}

/** Move a plan row from one document_id PK to another (e.g. legacy:sha → real id). */
function rekeyPlacementPlan(fromId: string, toId: string): PlacementPlanRecord | null {
  if (!fromId || !toId || fromId === toId) return null
  if (getPlacementPlanByDocumentId(toId)) return getPlacementPlanByDocumentId(toId)
  const existing = getPlacementPlanByDocumentId(fromId)
  if (!existing) return null
  const moved: PlacementPlanRecord = { ...existing, documentId: toId }
  const run = db.transaction(() => {
    upsertPlacementPlan(moved)
    db.prepare('DELETE FROM placement_plans WHERE document_id = ?').run(fromId)
  })
  run()
  return getPlacementPlanByDocumentId(toId)
}

/**
 * Resolve plan for an agreement. Prefer documentId (correct multi-use PDF).
 * Hash-only lookup returns a plan only when exactly one row exists for that hash
 * (never “latest of many”).
 */
export function resolvePlacementPlan(opts: {
  originalSha256: string
  documentId?: string | null
}): PlacementPlanRecord | null {
  const sha = opts.originalSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) return null
  const docId = opts.documentId?.trim() || null
  if (docId) {
    const byDoc = getPlacementPlanByDocumentId(docId)
    if (byDoc) {
      // Reject hash/document mismatch when both are provided.
      if (byDoc.originalSha256.toLowerCase() !== sha) return null
      return byDoc
    }
    // Recover pre-migration hash-only plan that was keyed as legacy:<sha> when this
    // document is the sole agreement for that fingerprint.
    const legacyId = legacyPlacementDocumentId(sha)
    const legacy = getPlacementPlanByDocumentId(legacyId)
    if (legacy) {
      const matches = findDocumentsByHash(sha)
      if (matches.length === 1 && matches[0]!.id === docId) {
        return rekeyPlacementPlan(legacyId, docId)
      }
    }
    // New agreement with a reused PDF: do not inherit another document's plan.
    return null
  }
  return getPlacementPlan(sha)
}

/**
 * Hash-only lookup. Returns a plan only when exactly one row matches the
 * fingerprint (including a sole legacy:<sha> row). Never picks “latest of many.”
 */
export function getPlacementPlan(originalSha256: string): PlacementPlanRecord | null {
  const sha = originalSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) return null
  const rows = db
    .prepare(`SELECT * FROM placement_plans WHERE original_sha256 = ?`)
    .all(sha) as Record<string, unknown>[]
  if (rows.length === 0) return null
  if (rows.length === 1) return rowToPlacementPlan(rows[0]!)
  // Ambiguous: multiple agreements share this PDF - require documentId.
  return null
}

export function getPlacementPlanByDocumentId(documentId: string): PlacementPlanRecord | null {
  if (!documentId?.trim()) return null
  const row = db
    .prepare('SELECT * FROM placement_plans WHERE document_id = ?')
    .get(documentId.trim()) as Record<string, unknown> | undefined
  return row ? rowToPlacementPlan(row) : null
}

// ── Credits (ledger-first prepaid seals) ───────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS credit_accounts (
    wallet_address TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    flagged INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    kind TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    ref_tx_hash TEXT,
    ref_stripe_session_id TEXT,
    ref_stripe_payment_intent TEXT,
    ref_document_id TEXT,
    nim_luna INTEGER,
    usd_cents INTEGER,
    fee_nim_at_event REAL,
    nim_usd_at_event REAL,
    created_at INTEGER NOT NULL,
    meta TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_credit_ledger_wallet
    ON credit_ledger(wallet_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_credit_ledger_stripe
    ON credit_ledger(ref_stripe_session_id);

  CREATE TABLE IF NOT EXISTS credit_reservations (
    document_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',
    service_tx_hash TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    resolved_at INTEGER,
    FOREIGN KEY (document_id) REFERENCES documents(id)
  );

  CREATE TABLE IF NOT EXISTS stripe_checkout_sessions (
    session_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    credits INTEGER NOT NULL,
    usd_cents INTEGER NOT NULL,
    unit_usd_cents INTEGER NOT NULL,
    fee_nim REAL NOT NULL,
    nim_usd REAL NOT NULL,
    markup REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS redemption_codes (
    code TEXT PRIMARY KEY,
    campaign TEXT NOT NULL DEFAULT 'appsumo',
    credits INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    batch_id TEXT,
    redeemed_by TEXT,
    redeemed_at INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_redemption_codes_status
    ON redemption_codes(status);
  CREATE INDEX IF NOT EXISTS idx_redemption_codes_campaign
    ON redemption_codes(campaign, status);
  CREATE INDEX IF NOT EXISTS idx_redemption_codes_redeemed_by
    ON redemption_codes(redeemed_by);
`)

export type CreditLedgerKind =
  | 'topup_nim'
  | 'topup_stripe'
  | 'topup_code'
  | 'spend'
  | 'refund_release'
  | 'stripe_clawback'
  | 'admin_adjust'

export type RedemptionCodeStatus = 'available' | 'redeemed' | 'disabled'

export interface RedemptionCodeRow {
  code: string
  campaign: string
  credits: number
  status: RedemptionCodeStatus
  batchId: string | null
  redeemedBy: string | null
  redeemedAt: number | null
  createdAt: number
}

export interface CreditLedgerEntry {
  id: string
  walletAddress: string
  delta: number
  balanceAfter: number
  kind: CreditLedgerKind
  idempotencyKey: string
  refTxHash: string | null
  refStripeSessionId: string | null
  refStripePaymentIntent: string | null
  refDocumentId: string | null
  nimLuna: number | null
  usdCents: number | null
  feeNimAtEvent: number | null
  nimUsdAtEvent: number | null
  createdAt: number
  meta: string | null
}

export type CreditReservationStatus = 'held' | 'captured' | 'released'

export interface CreditReservation {
  documentId: string
  walletAddress: string
  status: CreditReservationStatus
  serviceTxHash: string | null
  createdAt: number
  expiresAt: number
  resolvedAt: number | null
}

function rowToLedger(row: Record<string, unknown>): CreditLedgerEntry {
  return {
    id: row.id as string,
    walletAddress: row.wallet_address as string,
    delta: row.delta as number,
    balanceAfter: row.balance_after as number,
    kind: row.kind as CreditLedgerKind,
    idempotencyKey: row.idempotency_key as string,
    refTxHash: (row.ref_tx_hash as string | null) ?? null,
    refStripeSessionId: (row.ref_stripe_session_id as string | null) ?? null,
    refStripePaymentIntent: (row.ref_stripe_payment_intent as string | null) ?? null,
    refDocumentId: (row.ref_document_id as string | null) ?? null,
    nimLuna: (row.nim_luna as number | null) ?? null,
    usdCents: (row.usd_cents as number | null) ?? null,
    feeNimAtEvent: (row.fee_nim_at_event as number | null) ?? null,
    nimUsdAtEvent: (row.nim_usd_at_event as number | null) ?? null,
    createdAt: row.created_at as number,
    meta: (row.meta as string | null) ?? null,
  }
}

function ensureCreditAccount(walletAddress: string, now: number): void {
  const wallet = normalizeAddress(walletAddress)
  db.prepare(`
    INSERT INTO credit_accounts (wallet_address, balance, flagged, updated_at)
    VALUES (?, 0, 0, ?)
    ON CONFLICT(wallet_address) DO NOTHING
  `).run(wallet, now)
}

export function getCreditBalance(walletAddress: string): number {
  const wallet = normalizeAddress(walletAddress)
  const row = db
    .prepare('SELECT balance FROM credit_accounts WHERE wallet_address = ?')
    .get(wallet) as { balance: number } | undefined
  return row?.balance ?? 0
}

export function isCreditAccountFlagged(walletAddress: string): boolean {
  const wallet = normalizeAddress(walletAddress)
  const row = db
    .prepare('SELECT flagged FROM credit_accounts WHERE wallet_address = ?')
    .get(wallet) as { flagged: number } | undefined
  return Boolean(row?.flagged)
}

export function setCreditAccountFlagged(walletAddress: string, flagged: boolean): void {
  const wallet = normalizeAddress(walletAddress)
  const now = Date.now()
  ensureCreditAccount(wallet, now)
  db.prepare('UPDATE credit_accounts SET flagged = ?, updated_at = ? WHERE wallet_address = ?').run(
    flagged ? 1 : 0,
    now,
    wallet,
  )
}

export function getLedgerByIdempotencyKey(key: string): CreditLedgerEntry | null {
  const row = db
    .prepare('SELECT * FROM credit_ledger WHERE idempotency_key = ?')
    .get(key) as Record<string, unknown> | undefined
  return row ? rowToLedger(row) : null
}

export function listCreditLedger(walletAddress: string, limit = 50): CreditLedgerEntry[] {
  const wallet = normalizeAddress(walletAddress)
  const rows = db
    .prepare(
      `SELECT * FROM credit_ledger WHERE wallet_address = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(wallet, Math.min(Math.max(limit, 1), 200)) as Record<string, unknown>[]
  return rows.map(rowToLedger)
}

export interface ApplyCreditDeltaInput {
  id: string
  walletAddress: string
  delta: number
  kind: CreditLedgerKind
  idempotencyKey: string
  refTxHash?: string | null
  refStripeSessionId?: string | null
  refStripePaymentIntent?: string | null
  refDocumentId?: string | null
  nimLuna?: number | null
  usdCents?: number | null
  feeNimAtEvent?: number | null
  nimUsdAtEvent?: number | null
  meta?: string | null
  createdAt?: number
}

/**
 * Append-only ledger + balance update. Idempotent on idempotencyKey.
 * Returns the resulting balance (existing or new).
 */
export function applyCreditDelta(input: ApplyCreditDeltaInput): {
  balance: number
  entry: CreditLedgerEntry
  created: boolean
} {
  const wallet = normalizeAddress(input.walletAddress)
  const now = input.createdAt ?? Date.now()

  const existing = getLedgerByIdempotencyKey(input.idempotencyKey)
  if (existing) {
    return { balance: getCreditBalance(wallet), entry: existing, created: false }
  }

  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error('Credit delta must be a non-zero integer')
  }

  return runInTransaction(() => {
    const again = getLedgerByIdempotencyKey(input.idempotencyKey)
    if (again) {
      return { balance: getCreditBalance(wallet), entry: again, created: false }
    }

    ensureCreditAccount(wallet, now)

    if (input.delta > 0) {
      db.prepare(
        `UPDATE credit_accounts SET balance = balance + ?, updated_at = ? WHERE wallet_address = ?`,
      ).run(input.delta, now, wallet)
    } else {
      const result = db
        .prepare(
          `UPDATE credit_accounts
           SET balance = balance + ?, updated_at = ?
           WHERE wallet_address = ? AND balance + ? >= 0`,
        )
        .run(input.delta, now, wallet, input.delta)
      if (result.changes === 0) {
        throw new Error('Insufficient credits')
      }
    }

    const balance = getCreditBalance(wallet)
    db.prepare(`
      INSERT INTO credit_ledger (
        id, wallet_address, delta, balance_after, kind, idempotency_key,
        ref_tx_hash, ref_stripe_session_id, ref_stripe_payment_intent, ref_document_id,
        nim_luna, usd_cents, fee_nim_at_event, nim_usd_at_event, created_at, meta
      ) VALUES (
        @id, @walletAddress, @delta, @balanceAfter, @kind, @idempotencyKey,
        @refTxHash, @refStripeSessionId, @refStripePaymentIntent, @refDocumentId,
        @nimLuna, @usdCents, @feeNimAtEvent, @nimUsdAtEvent, @createdAt, @meta
      )
    `).run({
      id: input.id,
      walletAddress: wallet,
      delta: input.delta,
      balanceAfter: balance,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      refTxHash: input.refTxHash ?? null,
      refStripeSessionId: input.refStripeSessionId ?? null,
      refStripePaymentIntent: input.refStripePaymentIntent ?? null,
      refDocumentId: input.refDocumentId ?? null,
      nimLuna: input.nimLuna ?? null,
      usdCents: input.usdCents ?? null,
      feeNimAtEvent: input.feeNimAtEvent ?? null,
      nimUsdAtEvent: input.nimUsdAtEvent ?? null,
      createdAt: now,
      meta: input.meta ?? null,
    })

    const entry = getLedgerByIdempotencyKey(input.idempotencyKey)!
    return { balance, entry, created: true }
  })
}

export function getCreditReservation(documentId: string): CreditReservation | null {
  const row = db
    .prepare('SELECT * FROM credit_reservations WHERE document_id = ?')
    .get(documentId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    documentId: row.document_id as string,
    walletAddress: row.wallet_address as string,
    status: row.status as CreditReservationStatus,
    serviceTxHash: (row.service_tx_hash as string | null) ?? null,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    resolvedAt: (row.resolved_at as number | null) ?? null,
  }
}

export function insertCreditReservation(res: CreditReservation): void {
  db.prepare(`
    INSERT INTO credit_reservations (
      document_id, wallet_address, status, service_tx_hash, created_at, expires_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    res.documentId,
    normalizeAddress(res.walletAddress),
    res.status,
    res.serviceTxHash,
    res.createdAt,
    res.expiresAt,
    res.resolvedAt,
  )
}

export function updateCreditReservation(
  documentId: string,
  patch: Partial<Pick<CreditReservation, 'status' | 'serviceTxHash' | 'resolvedAt' | 'expiresAt'>>,
): void {
  const current = getCreditReservation(documentId)
  if (!current) return
  db.prepare(`
    UPDATE credit_reservations
    SET status = ?, service_tx_hash = ?, resolved_at = ?, expires_at = ?
    WHERE document_id = ?
  `).run(
    patch.status ?? current.status,
    patch.serviceTxHash !== undefined ? patch.serviceTxHash : current.serviceTxHash,
    patch.resolvedAt !== undefined ? patch.resolvedAt : current.resolvedAt,
    patch.expiresAt ?? current.expiresAt,
    documentId,
  )
}

export function hasActiveCreditReservation(documentId: string, now = Date.now()): boolean {
  const res = getCreditReservation(documentId)
  if (!res) return false
  if (res.status === 'captured') return true
  if (res.status === 'held' && res.expiresAt >= now) return true
  return false
}

export function upsertStripeCheckoutSession(row: {
  sessionId: string
  walletAddress: string
  credits: number
  usdCents: number
  unitUsdCents: number
  feeNim: number
  nimUsd: number
  markup: number
  status: string
  createdAt: number
  updatedAt: number
}): void {
  db.prepare(`
    INSERT INTO stripe_checkout_sessions (
      session_id, wallet_address, credits, usd_cents, unit_usd_cents,
      fee_nim, nim_usd, markup, status, created_at, updated_at
    ) VALUES (
      @sessionId, @walletAddress, @credits, @usdCents, @unitUsdCents,
      @feeNim, @nimUsd, @markup, @status, @createdAt, @updatedAt
    )
    ON CONFLICT(session_id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run({
    ...row,
    walletAddress: normalizeAddress(row.walletAddress),
  })
}

export function getStripeCheckoutSession(sessionId: string): {
  sessionId: string
  walletAddress: string
  credits: number
  usdCents: number
  status: string
} | null {
  const row = db
    .prepare('SELECT * FROM stripe_checkout_sessions WHERE session_id = ?')
    .get(sessionId) as Record<string, unknown> | undefined
  if (!row) return null
  return {
    sessionId: row.session_id as string,
    walletAddress: row.wallet_address as string,
    credits: row.credits as number,
    usdCents: row.usd_cents as number,
    status: row.status as string,
  }
}

/** Pending / unpaid checkout rows for a wallet (most recent first). */
export function listPendingStripeCheckoutsForWallet(
  walletAddress: string,
  limit = 10,
): Array<{
  sessionId: string
  walletAddress: string
  credits: number
  usdCents: number
  status: string
}> {
  const wallet = normalizeAddress(walletAddress)
  const rows = db
    .prepare(
      `SELECT * FROM stripe_checkout_sessions
       WHERE wallet_address = ?
         AND status NOT IN ('paid', 'failed', 'expired')
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(wallet, Math.max(1, Math.min(limit, 25))) as Record<string, unknown>[]
  return rows.map(row => ({
    sessionId: row.session_id as string,
    walletAddress: row.wallet_address as string,
    credits: row.credits as number,
    usdCents: row.usd_cents as number,
    status: row.status as string,
  }))
}

export function updateStripeCheckoutStatus(sessionId: string, status: string, updatedAt = Date.now()): void {
  db.prepare('UPDATE stripe_checkout_sessions SET status = ?, updated_at = ? WHERE session_id = ?').run(
    status,
    updatedAt,
    sessionId,
  )
}

export function isTxHashUsedForCredits(txHash: string): boolean {
  const clean = txHash.replace(/^0x/i, '').toLowerCase()
  const row = db
    .prepare(`SELECT 1 FROM credit_ledger WHERE lower(ref_tx_hash) = ? LIMIT 1`)
    .get(clean) as unknown
  return Boolean(row)
}

// ── Redemption codes (AppSumo / promo) ─────────────────────────────────────

function rowToRedemptionCode(row: Record<string, unknown>): RedemptionCodeRow {
  return {
    code: row.code as string,
    campaign: row.campaign as string,
    credits: row.credits as number,
    status: row.status as RedemptionCodeStatus,
    batchId: (row.batch_id as string | null) ?? null,
    redeemedBy: (row.redeemed_by as string | null) ?? null,
    redeemedAt: (row.redeemed_at as number | null) ?? null,
    createdAt: row.created_at as number,
  }
}

export function getRedemptionCode(code: string): RedemptionCodeRow | null {
  const row = db
    .prepare('SELECT * FROM redemption_codes WHERE code = ?')
    .get(code) as Record<string, unknown> | undefined
  return row ? rowToRedemptionCode(row) : null
}

/**
 * Insert purchase-ready codes. Skips duplicates (INSERT OR IGNORE).
 * Returns how many rows were actually inserted.
 */
export function insertRedemptionCodes(
  codes: Array<{
    code: string
    campaign?: string
    credits: number
    batchId?: string | null
    createdAt?: number
  }>,
): { inserted: number; skipped: number } {
  if (codes.length === 0) return { inserted: 0, skipped: 0 }
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO redemption_codes (
      code, campaign, credits, status, batch_id, redeemed_by, redeemed_at, created_at
    ) VALUES (
      @code, @campaign, @credits, 'available', @batchId, NULL, NULL, @createdAt
    )
  `)
  let inserted = 0
  const run = db.transaction(() => {
    for (const c of codes) {
      const result = stmt.run({
        code: c.code,
        campaign: c.campaign ?? 'appsumo',
        credits: c.credits,
        batchId: c.batchId ?? null,
        createdAt: c.createdAt ?? now,
      })
      if (result.changes > 0) inserted += 1
    }
  })
  run()
  return { inserted, skipped: codes.length - inserted }
}

/**
 * Atomically claim an available code for a wallet.
 * Returns the row when claimed; null when code missing / not available / race lost.
 */
export function claimRedemptionCode(
  code: string,
  walletAddress: string,
  now = Date.now(),
): RedemptionCodeRow | null {
  const wallet = normalizeAddress(walletAddress)
  const result = db
    .prepare(
      `UPDATE redemption_codes
       SET status = 'redeemed', redeemed_by = ?, redeemed_at = ?
       WHERE code = ? AND status = 'available'`,
    )
    .run(wallet, now, code)
  if (result.changes === 0) return null
  return getRedemptionCode(code)
}

export function countRedemptionCodes(campaign?: string): {
  available: number
  redeemed: number
  disabled: number
  total: number
} {
  const rows = (
    campaign
      ? (db
          .prepare(
            `SELECT status, COUNT(*) AS n FROM redemption_codes WHERE campaign = ? GROUP BY status`,
          )
          .all(campaign) as Array<{ status: string; n: number }>)
      : (db
          .prepare(`SELECT status, COUNT(*) AS n FROM redemption_codes GROUP BY status`)
          .all() as Array<{ status: string; n: number }>)
  )
  const out = { available: 0, redeemed: 0, disabled: 0, total: 0 }
  for (const r of rows) {
    const n = Number(r.n) || 0
    out.total += n
    if (r.status === 'available') out.available = n
    else if (r.status === 'redeemed') out.redeemed = n
    else if (r.status === 'disabled') out.disabled = n
  }
  return out
}

// ── Signature handoff rooms (cross-device ink capture; ciphertext only) ────

db.exec(`
  CREATE TABLE IF NOT EXISTS sig_handoff_rooms (
    id TEXT PRIMARY KEY,
    creator_address TEXT NOT NULL,
    document_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    deposit_iv BLOB,
    deposit_ciphertext BLOB,
    deposit_consumed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sig_handoff_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    from_role TEXT NOT NULL,
    msg_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (room_id) REFERENCES sig_handoff_rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sig_handoff_expires ON sig_handoff_rooms(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sig_handoff_signals_room ON sig_handoff_signals(room_id, id);
`)

export type SigHandoffStatus = 'open' | 'connected' | 'completed' | 'expired'

export interface SigHandoffRoom {
  id: string
  creatorAddress: string
  documentId: string | null
  status: SigHandoffStatus
  createdAt: number
  expiresAt: number
  hasDeposit: boolean
  depositConsumed: boolean
}

export interface SigHandoffSignal {
  id: number
  roomId: string
  fromRole: 'host' | 'guest'
  msgType: string
  payload: string
  createdAt: number
}

export const SIG_HANDOFF_TTL_MS = 5 * 60 * 1000
export const SIG_HANDOFF_MAX_SIGNALS = 64
export const SIG_HANDOFF_MAX_DEPOSIT_BYTES = 300 * 1024

function mapSigHandoffRoom(row: Record<string, unknown>): SigHandoffRoom {
  return {
    id: row.id as string,
    creatorAddress: row.creator_address as string,
    documentId: (row.document_id as string | null) ?? null,
    status: row.status as SigHandoffStatus,
    createdAt: row.created_at as number,
    expiresAt: row.expires_at as number,
    hasDeposit: Boolean(row.deposit_ciphertext),
    depositConsumed: Boolean(row.deposit_consumed),
  }
}

export function createSigHandoffRoom(input: {
  id: string
  creatorAddress: string
  documentId?: string | null
  ttlMs?: number
}): SigHandoffRoom {
  const now = Date.now()
  const ttl = input.ttlMs ?? SIG_HANDOFF_TTL_MS
  const expiresAt = now + ttl
  db.prepare(
    `INSERT INTO sig_handoff_rooms
      (id, creator_address, document_id, status, created_at, expires_at, deposit_consumed)
     VALUES (?, ?, ?, 'open', ?, ?, 0)`,
  ).run(
    input.id,
    normalizeAddress(input.creatorAddress),
    input.documentId ?? null,
    now,
    expiresAt,
  )
  return {
    id: input.id,
    creatorAddress: normalizeAddress(input.creatorAddress),
    documentId: input.documentId ?? null,
    status: 'open',
    createdAt: now,
    expiresAt,
    hasDeposit: false,
    depositConsumed: false,
  }
}

function expireRoomIfNeeded(room: SigHandoffRoom): SigHandoffRoom {
  if (room.status === 'completed' || room.status === 'expired') return room
  if (room.expiresAt < Date.now()) {
    db.prepare(`UPDATE sig_handoff_rooms SET status = 'expired' WHERE id = ? AND status IN ('open', 'connected')`).run(
      room.id,
    )
    return { ...room, status: 'expired' }
  }
  return room
}

export function getSigHandoffRoom(id: string): SigHandoffRoom | null {
  const row = db.prepare('SELECT * FROM sig_handoff_rooms WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  return expireRoomIfNeeded(mapSigHandoffRoom(row))
}

export function setSigHandoffStatus(id: string, status: SigHandoffStatus): void {
  db.prepare('UPDATE sig_handoff_rooms SET status = ? WHERE id = ?').run(status, id)
}

export function insertSigHandoffSignal(input: {
  roomId: string
  fromRole: 'host' | 'guest'
  msgType: string
  payload: string
}): SigHandoffSignal {
  const count = db
    .prepare('SELECT COUNT(*) as c FROM sig_handoff_signals WHERE room_id = ?')
    .get(input.roomId) as { c: number }
  if (count.c >= SIG_HANDOFF_MAX_SIGNALS) {
    throw new Error('Too many signaling messages for this session')
  }
  const createdAt = Date.now()
  const result = db
    .prepare(
      `INSERT INTO sig_handoff_signals (room_id, from_role, msg_type, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.roomId, input.fromRole, input.msgType, input.payload, createdAt)
  return {
    id: Number(result.lastInsertRowid),
    roomId: input.roomId,
    fromRole: input.fromRole,
    msgType: input.msgType,
    payload: input.payload,
    createdAt,
  }
}

export function listSigHandoffSignals(roomId: string, afterId = 0): SigHandoffSignal[] {
  const rows = db
    .prepare(
      `SELECT * FROM sig_handoff_signals
       WHERE room_id = ? AND id > ?
       ORDER BY id ASC
       LIMIT 100`,
    )
    .all(roomId, afterId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as number,
    roomId: row.room_id as string,
    fromRole: row.from_role as 'host' | 'guest',
    msgType: row.msg_type as string,
    payload: row.payload as string,
    createdAt: row.created_at as number,
  }))
}

export function storeSigHandoffDeposit(
  roomId: string,
  iv: Buffer,
  ciphertext: Buffer,
): void {
  if (ciphertext.length > SIG_HANDOFF_MAX_DEPOSIT_BYTES) {
    throw new Error(`Deposit too large (max ${SIG_HANDOFF_MAX_DEPOSIT_BYTES} bytes)`)
  }
  if (iv.length < 8 || iv.length > 32) {
    throw new Error('Invalid IV length')
  }
  const room = getSigHandoffRoom(roomId)
  if (!room) throw new Error('Session not found')
  if (room.status === 'expired' || room.status === 'completed') {
    throw new Error('Session is no longer open')
  }
  if (room.depositConsumed) throw new Error('Deposit already consumed')
  // Idempotent re-deposit: guest dual-writes / retries may post the same ciphertext again.
  // Overwrite only while host has not completed the room.
  db.prepare(
    `UPDATE sig_handoff_rooms
     SET deposit_iv = ?, deposit_ciphertext = ?, status = CASE WHEN status = 'open' THEN 'connected' ELSE status END
     WHERE id = ?`,
  ).run(iv, ciphertext, roomId)
}

/**
 * Read encrypted deposit without consuming it.
 * Host decrypts client-side; only complete/cancel clears the blob.
 */
export function peekSigHandoffDeposit(
  roomId: string,
): { iv: Buffer; ciphertext: Buffer } | null {
  const room = getSigHandoffRoom(roomId)
  if (!room || room.depositConsumed || room.status === 'expired') return null

  const row = db
    .prepare(
      `SELECT deposit_iv, deposit_ciphertext FROM sig_handoff_rooms
       WHERE id = ? AND deposit_ciphertext IS NOT NULL AND deposit_consumed = 0`,
    )
    .get(roomId) as { deposit_iv: Buffer; deposit_ciphertext: Buffer } | undefined
  if (!row?.deposit_ciphertext) return null
  return { iv: row.deposit_iv, ciphertext: row.deposit_ciphertext }
}

/** Clear deposit and mark completed (after host successfully applied ink). */
export function clearSigHandoffDeposit(roomId: string): void {
  db.prepare(
    `UPDATE sig_handoff_rooms
     SET deposit_consumed = 1, deposit_iv = NULL, deposit_ciphertext = NULL, status = 'completed'
     WHERE id = ?`,
  ).run(roomId)
}

/** @deprecated Prefer peek + clear on complete - kept for any leftover callers. */
export function consumeSigHandoffDeposit(
  roomId: string,
): { iv: Buffer; ciphertext: Buffer } | null {
  const pair = peekSigHandoffDeposit(roomId)
  if (!pair) return null
  clearSigHandoffDeposit(roomId)
  return pair
}

export function deleteSigHandoffRoom(id: string): boolean {
  db.prepare('DELETE FROM sig_handoff_signals WHERE room_id = ?').run(id)
  const result = db.prepare('DELETE FROM sig_handoff_rooms WHERE id = ?').run(id)
  return result.changes > 0
}

export function purgeExpiredSigHandoffs(): number {
  const now = Date.now()
  db.prepare(
    `UPDATE sig_handoff_rooms SET status = 'expired'
     WHERE expires_at < ? AND status IN ('open', 'connected')`,
  ).run(now)
  // Drop finished/expired rooms older than 1 hour
  const cutoff = now - 60 * 60 * 1000
  const rooms = db
    .prepare(
      `SELECT id FROM sig_handoff_rooms
       WHERE expires_at < ? OR (status IN ('completed', 'expired') AND created_at < ?)`,
    )
    .all(now, cutoff) as Array<{ id: string }>
  for (const r of rooms) {
    db.prepare('DELETE FROM sig_handoff_signals WHERE room_id = ?').run(r.id)
  }
  const result = db
    .prepare(
      `DELETE FROM sig_handoff_rooms
       WHERE expires_at < ? OR (status IN ('completed', 'expired') AND created_at < ?)`,
    )
    .run(now, cutoff)
  return result.changes
}

