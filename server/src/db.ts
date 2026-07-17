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
  requiredSignatures: number
  createdAt: number
  lockedAt: number | null
  /** Optional creator email for ready-to-seal notify (never public). */
  creatorNotifyEmail: string | null
  readyToSealEmailSentAt: number | null
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

export function createSession(token: string, address: string, nonce: string, ttlMs: number): void {
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (token, address, nonce, public_key, verified, created_at, expires_at) VALUES (?, ?, ?, NULL, 0, ?, ?)',
  ).run(token, normalizeAddress(address), nonce, now, now + ttlMs)
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

export function markSessionVerified(token: string, publicKey: string): void {
  db.prepare('UPDATE sessions SET public_key = ?, verified = 1 WHERE token = ?').run(publicKey, token)
}

export function purgeExpiredSessions(): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  return result.changes
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
    requiredSignatures: requiredSignatures ?? 0,
    createdAt: row.created_at as number,
    lockedAt: (row.locked_at as number | null) ?? null,
    creatorNotifyEmail: (row.creator_notify_email as string | null) ?? null,
    readyToSealEmailSentAt:
      (row.ready_to_seal_email_sent_at as number | null | undefined) ?? null,
  }
}

export function insertDocument(doc: DocumentRecord): void {
  db.prepare(`
    INSERT INTO documents (
      id, slug, title, original_filename, type, status, creator_address,
      original_sha256, final_sha256, page_count, metadata, required_signatures,
      created_at, locked_at, creator_notify_email, ready_to_seal_email_sent_at
    )
    VALUES (
      @id, @slug, @title, @originalFilename, @type, @status, @creatorAddress,
      @originalSha256, @finalSha256, @pageCount, @metadata, @requiredSignatures,
      @createdAt, @lockedAt, @creatorNotifyEmail, @readyToSealEmailSentAt
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
    requiredSignatures: doc.requiredSignatures,
    createdAt: doc.createdAt,
    lockedAt: doc.lockedAt,
    creatorNotifyEmail: doc.creatorNotifyEmail,
    readyToSealEmailSentAt: doc.readyToSealEmailSentAt,
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