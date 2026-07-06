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
  }
}

export function insertDocument(doc: DocumentRecord): void {
  db.prepare(`
    INSERT INTO documents (id, slug, title, original_filename, type, status, creator_address, original_sha256, final_sha256, page_count, metadata, required_signatures, created_at, locked_at)
    VALUES (@id, @slug, @title, @originalFilename, @type, @status, @creatorAddress, @originalSha256, @finalSha256, @pageCount, @metadata, @requiredSignatures, @createdAt, @lockedAt)
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
  })
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

export function assignPartyWallet(partyId: string, walletAddress: string): void {
  db.prepare('UPDATE document_parties SET wallet_address = ? WHERE id = ?').run(
    normalizeAddress(walletAddress),
    partyId,
  )
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