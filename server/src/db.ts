import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeAddress } from './addresses.js'
import { getDatabasePath } from './paths.js'

const dbPath = getDatabasePath()

mkdirSync(dirname(dbPath), { recursive: true })

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

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
`)

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
/** JSON array of client PDF annotations (nullable — legacy docs have none). */
if (!documentColumns.some(col => col.name === 'annotations')) {
  db.exec('ALTER TABLE documents ADD COLUMN annotations TEXT')
}
/** Organizer label from step 1 — used in invite emails; not the same as a signer slot. */
if (!documentColumns.some(col => col.name === 'creator_display_name')) {
  db.exec('ALTER TABLE documents ADD COLUMN creator_display_name TEXT')
}

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
   * PDF bytes are never stored — only geometry + small image/text payloads.
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
}

export interface SignatureRecord {
  id: string
  documentId: string
  partyId: string
  signerAddress: string
  signatureType: string
  clientSha256: string
  signedAt: number
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
  }
}

export function insertDocument(doc: DocumentRecord): void {
  db.prepare(`
    INSERT INTO documents (
      id, slug, title, original_filename, type, status, creator_address,
      original_sha256, final_sha256, page_count, metadata, annotations, required_signatures,
      created_at, locked_at, creator_notify_email, ready_to_seal_email_sent_at, creator_display_name
    )
    VALUES (
      @id, @slug, @title, @originalFilename, @type, @status, @creatorAddress,
      @originalSha256, @finalSha256, @pageCount, @metadata, @annotations, @requiredSignatures,
      @createdAt, @lockedAt, @creatorNotifyEmail, @readyToSealEmailSentAt, @creatorDisplayName
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
  db.prepare('DELETE FROM document_parties WHERE id = ?').run(partyId)
}

export function setDocumentFinalSha256(id: string, finalSha256: string, status: DocumentStatus): void {
  db.prepare('UPDATE documents SET final_sha256 = ?, status = ? WHERE id = ?').run(finalSha256, status, id)
}

export function lockDocument(id: string, lockedAt: number): void {
  db.prepare('UPDATE documents SET status = ?, locked_at = ? WHERE id = ?').run('locked', lockedAt, id)
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
    db.prepare('DELETE FROM document_parties WHERE document_id = ?').run(id)
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

export function getPartiesForDocument(documentId: string): PartyRecord[] {
  const rows = db
    .prepare('SELECT * FROM document_parties WHERE document_id = ? ORDER BY sort_order ASC')
    .all(documentId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    documentId: row.document_id as string,
    role: row.role as string,
    displayName: row.display_name as string,
    walletAddress: (row.wallet_address as string | null) ?? null,
    sortOrder: row.sort_order as number,
    required: Boolean(row.required),
    status: row.status as PartyRecord['status'],
    signedAt: (row.signed_at as number | null) ?? null,
  }))
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
    // Unique index on (document_id, wallet) — this wallet already owns another party.
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
  }
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
    INSERT INTO signatures (id, document_id, party_id, signer_address, signature_type, client_sha256, signed_at)
    VALUES (@id, @documentId, @partyId, @signerAddress, @signatureType, @clientSha256, @signedAt)
  `).run({
    id: sig.id,
    documentId: sig.documentId,
    partyId: sig.partyId,
    signerAddress: sig.signerAddress,
    signatureType: sig.signatureType,
    clientSha256: sig.clientSha256,
    signedAt: sig.signedAt,
  })
}

export function getSignaturesForDocument(documentId: string): SignatureRecord[] {
  const rows = db
    .prepare('SELECT * FROM signatures WHERE document_id = ? ORDER BY signed_at ASC')
    .all(documentId) as Record<string, unknown>[]
  return rows.map(row => ({
    id: row.id as string,
    documentId: row.document_id as string,
    partyId: row.party_id as string,
    signerAddress: row.signer_address as string,
    signatureType: row.signature_type as string,
    clientSha256: row.client_sha256 as string,
    signedAt: row.signed_at as number,
  }))
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
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    partyId: row.party_id as string,
    signerAddress: row.signer_address as string,
    signatureType: row.signature_type as string,
    clientSha256: row.client_sha256 as string,
    signedAt: row.signed_at as number,
  }
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

export type DocumentDataArchiveSource = 'placements' | 'annotations'

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
  createdAt: number
  updatedAt: number
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

export function upsertDocumentDataArchive(rec: DocumentDataArchiveRecord): void {
  db.prepare(`
    INSERT INTO document_data_archives (
      document_id, original_sha256, source, frame_count, credits_charged,
      frames_json, tx_hashes_json, on_chain, confirmed_frames, error, created_at, updated_at
    ) VALUES (
      @documentId, @originalSha256, @source, @frameCount, @creditsCharged,
      @framesJson, @txHashesJson, @onChain, @confirmedFrames, @error, @createdAt, @updatedAt
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
  // Ambiguous: multiple agreements share this PDF — require documentId.
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
`)

export type CreditLedgerKind =
  | 'topup_nim'
  | 'topup_stripe'
  | 'spend'
  | 'refund_release'
  | 'stripe_clawback'
  | 'admin_adjust'

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

/** @deprecated Prefer peek + clear on complete — kept for any leftover callers. */
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
