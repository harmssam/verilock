import { Client, ClientConfiguration, Transaction } from '@nimiq/core'
import { normalizeAddress } from './addresses.js'
import { hasActiveCreditReservation } from './db.js'
import {
  getSealFeeLuna,
  isCreditProofValueLuna,
  isValidDirectSealFeeLuna,
} from './sealPricing.js'

let broadcastClient: Client | null = null
let broadcastClientInit: Promise<Client> | null = null

async function getBroadcastClient(): Promise<Client> {
  if (!broadcastClientInit) {
    broadcastClientInit = (async () => {
      const config = new ClientConfiguration()
      const client = await Client.create(config.build())
      await Promise.race([
        client.waitForConsensusEstablished(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Nimiq client consensus timed out')), 45_000)
        }),
      ])
      broadcastClient = client
      return client
    })()
  }
  return broadcastClientInit
}

/** Shared client for service-wallet signing/broadcast. */
export async function getBroadcastClientForService(): Promise<Client> {
  return getBroadcastClient()
}

const RPC_URL = process.env.NIMIQ_RPC_URL ?? 'https://rpc.nimiqwatch.com'
const MIN_CONFIRMATIONS = Number(process.env.NIM_MIN_CONFIRMATIONS ?? 1)

/** Must match client default in nimiq.ts. */
const DEFAULT_ATTESTATION_RECIPIENT = 'NQ815N9JRGBJMLJQNBKEMQ1RD27TXS8PCVKA'

export function getExpectedAttestationRecipient(): string | null {
  const configured = process.env.ATTESTATION_RECIPIENT?.trim()
  if (configured) return normalizeAddress(configured)
  if (process.env.NODE_ENV === 'production') return normalizeAddress(DEFAULT_ATTESTATION_RECIPIENT)
  // Dev default: same sink so local top-ups/seals have a recipient to validate against.
  return normalizeAddress(DEFAULT_ATTESTATION_RECIPIENT)
}

function getServiceWalletAddressFromEnv(): string | null {
  // Lazy import avoided — address is set when service wallet module loads; pass via expectation.
  const raw = process.env.SERVICE_WALLET_ADDRESS?.trim()
  return raw ? normalizeAddress(raw) : null
}

export interface NimiqTransaction {
  hash: string
  from: string
  to: string
  value: number
  recipientData: string
  executionResult: boolean
  confirmations: number
  blockNumber?: number
}

interface RpcResponse<T> {
  result?: { data: T }
  error?: { message: string; code: number; data?: unknown }
}

/** Nimiq RPC often returns message "Internal error" with details in `data`. */
export function formatRpcError(error: { message?: string; data?: unknown }): string {
  const message = error.message?.trim() || 'Nimiq RPC error'
  const data = typeof error.data === 'string' ? error.data.trim() : ''
  if (!data || message.toLowerCase().includes(data.toLowerCase())) return message
  return `${message}: ${data}`
}

export function isTransactionNotFoundError(message: string): boolean {
  return message.toLowerCase().includes('not found')
}

async function rpcCall<T>(method: string, params: unknown[], options?: { allowEmpty?: boolean }): Promise<T> {
  const maxAttempts = 4
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      })
      if (res.status === 429) {
        lastErr = new Error('Nimiq RPC HTTP 429')
        const backoff = 400 * attempt * attempt
        await new Promise(r => setTimeout(r, backoff))
        continue
      }
      if (!res.ok) throw new Error(`Nimiq RPC HTTP ${res.status}`)
      const json = (await res.json()) as RpcResponse<T>
      if (json.error) throw new Error(formatRpcError(json.error))
      if (json.result?.data === undefined || json.result?.data === null) {
        if (options?.allowEmpty) return undefined as T
        throw new Error('Empty RPC response')
      }
      return json.result.data
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxAttempts && /429|rate|timeout|fetch failed/i.test(lastErr.message)) {
        await new Promise(r => setTimeout(r, 400 * attempt * attempt))
        continue
      }
      throw lastErr
    }
  }
  throw lastErr ?? new Error('Nimiq RPC failed')
}

/** Nimiq basic transactions allow at most 64 bytes of unstructured data. */
export const ATTESTATION_PAYLOAD_MAX_BYTES = 64
const ATTESTATION_PAYLOAD_VERSION = 1
const ATTESTATION_PAYLOAD_SIZE = 37

function docShortId(docId: string): string {
  return docId.replace(/-/g, '').slice(0, 8).toLowerCase()
}

export function decodeRecipientDataBytes(raw: string): Buffer {
  if (!raw) return Buffer.alloc(0)
  const clean = raw.replace(/^0x/i, '')
  if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
    return Buffer.from(clean, 'hex')
  }
  return Buffer.from(raw, 'utf8')
}

/** @deprecated Use decodeRecipientDataBytes — kept for certificate display helpers */
export function decodeRecipientData(raw: string): string {
  const bytes = decodeRecipientDataBytes(raw)
  if (bytes.length === ATTESTATION_PAYLOAD_SIZE && bytes[0] === ATTESTATION_PAYLOAD_VERSION) {
    return bytes.toString('hex')
  }
  return bytes.toString('utf8')
}

export function normalizeTxHash(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase()
}

export function buildAttestationPayloadBytes(docId: string, finalSha256: string): Buffer {
  const hash = finalSha256.toLowerCase()
  const shortHex = docShortId(docId)
  if (!/^[a-f0-9]{8}$/.test(shortHex)) {
    throw new Error('Invalid document id for attestation payload')
  }
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Invalid sha256 for attestation payload')
  }

  const payload = Buffer.alloc(ATTESTATION_PAYLOAD_SIZE)
  payload[0] = ATTESTATION_PAYLOAD_VERSION
  payload.write(shortHex, 1, 4, 'hex')
  payload.write(hash, 5, 32, 'hex')
  if (payload.length > ATTESTATION_PAYLOAD_MAX_BYTES) {
    throw new Error('Attestation payload exceeds Nimiq transaction data limit')
  }
  return payload
}

/** Hex-encoded compact payload stored in DB and shown in certificates. */
export function buildAttestationPayload(docId: string, finalSha256: string): string {
  return buildAttestationPayloadBytes(docId, finalSha256).toString('hex')
}

export function parseAttestationPayload(payload: string): { shortId: string; sha256: string } | null {
  const clean = payload.replace(/^0x/i, '').toLowerCase()
  if (/^[0-9a-f]{74}$/.test(clean)) {
    const bytes = Buffer.from(clean, 'hex')
    if (bytes.length === ATTESTATION_PAYLOAD_SIZE && bytes[0] === ATTESTATION_PAYLOAD_VERSION) {
      return {
        shortId: bytes.subarray(1, 5).toString('hex'),
        sha256: bytes.subarray(5, 37).toString('hex'),
      }
    }
  }

  const match = payload.match(/^seal:v1:lock:([a-f0-9]{8}):([a-f0-9]{64})$/i)
  if (!match) return null
  return { shortId: match[1]!.toLowerCase(), sha256: match[2]!.toLowerCase() }
}

function payloadBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function normalizeAttestationPayloadBytes(bytes: Buffer): Buffer {
  if (bytes.length === ATTESTATION_PAYLOAD_SIZE) return bytes
  if (bytes.length === ATTESTATION_PAYLOAD_SIZE * 2) {
    const asText = bytes.toString('utf8')
    if (/^[0-9a-f]{74}$/i.test(asText)) {
      return Buffer.from(asText, 'hex')
    }
  }
  return bytes
}

export function verifyAttestationPayload(
  rawRecipientData: string,
  docId: string,
  finalSha256: string,
): void {
  const bytes = normalizeAttestationPayloadBytes(decodeRecipientDataBytes(rawRecipientData))
  const expected = buildAttestationPayloadBytes(docId, finalSha256)
  if (payloadBytesEqual(bytes, expected)) return

  const legacy = `seal:v1:lock:${docShortId(docId)}:${finalSha256.toLowerCase()}`
  if (bytes.toString('utf8') === legacy) return

  throw new Error(
    `Invalid attestation payload (expected ${expected.length}-byte seal proof, got ${bytes.length} bytes)`,
  )
}

export async function verifySignature(
  message: string,
  publicKey: string,
  signature: string,
  isHex = true,
): Promise<boolean> {
  return rpcCall<boolean>('verifySignature', [message, publicKey, signature, isHex])
}

export async function getBlockNumber(): Promise<number> {
  return rpcCall<number>('getBlockNumber', [])
}

export async function getWalletBalanceLuna(address: string): Promise<number> {
  const client = await getBroadcastClient()
  const account = await client.getAccount(normalizeAddress(address))
  if ('balance' in account && typeof account.balance === 'number') {
    return account.balance
  }
  return 0
}

export function normalizeRawTransactionHex(rawTx: string): string {
  const clean = rawTx.replace(/^0x/i, '').trim()
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid serialized transaction hex')
  }
  return clean.toLowerCase()
}

/** Compute tx hash from serialized hex via @nimiq/core (never use raw slice as hash). */
function hashFromSerializedTx(cleanHex: string): string {
  const tx = Transaction.fromAny(cleanHex)
  return normalizeTxHash(tx.hash())
}

export type BroadcastResult = {
  hash: string
  clientState?: string
  rpcAccepted: boolean
  clientAccepted: boolean
}

/** Push hex to the public JSON-RPC node used for verification. */
export async function sendRawTransactionViaRpc(rawTx: string): Promise<string> {
  const clean = normalizeRawTransactionHex(rawTx)
  const hash = await rpcCall<string>('sendRawTransaction', [clean])
  if (typeof hash === 'string' && hash.length > 0) {
    return normalizeTxHash(hash)
  }
  throw new Error('Empty sendRawTransaction response')
}

/**
 * Broadcast a signed transaction hex to the Nimiq network.
 * Prefer the web client; also push to public JSON-RPC. Always return a real tx hash.
 */
export async function broadcastRawTransaction(rawTx: string): Promise<string> {
  const result = await broadcastRawTransactionDetailed(rawTx)
  return result.hash
}

/**
 * Broadcast with diagnostics. Tries light client + public RPC, logs failures.
 */
export async function broadcastRawTransactionDetailed(rawTx: string): Promise<BroadcastResult> {
  const clean = normalizeRawTransactionHex(rawTx)
  let lastError: Error | null = null
  let knownHash: string | null = null
  let clientState: string | undefined
  let clientAccepted = false
  let rpcAccepted = false

  try {
    knownHash = hashFromSerializedTx(clean)
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
  }

  try {
    const client = await getBroadcastClient()
    // Prefer Transaction object so the client signs/validates consistently.
    const details = await client.sendTransaction(Transaction.fromAny(clean))
    const hash = normalizeTxHash(details.transactionHash)
    clientState = details.state
    if (hash) {
      knownHash = hash
      clientAccepted = details.state !== 'invalidated' && details.state !== 'expired'
      if (details.state === 'invalidated' || details.state === 'expired') {
        throw new Error(`Light client rejected transaction (state: ${details.state})`)
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
    console.warn('[nimiq] client.sendTransaction failed', lastError.message)
  }

  try {
    const rpcHash = await sendRawTransactionViaRpc(clean)
    knownHash = rpcHash || knownHash
    rpcAccepted = true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // "already known" / duplicate is success for our purposes
    if (/already|known|duplicate|in mempool/i.test(message)) {
      rpcAccepted = true
    } else {
      lastError = err instanceof Error ? err : new Error(message)
      console.warn('[nimiq] sendRawTransaction failed', message)
    }
  }

  if (knownHash && (clientAccepted || rpcAccepted)) {
    return {
      hash: knownHash,
      clientState,
      rpcAccepted,
      clientAccepted,
    }
  }

  // If the network already has the tx (duplicate broadcast), return its real hash.
  if (knownHash) {
    const existing = await fetchTransaction(knownHash)
    if (existing) {
      return {
        hash: normalizeTxHash(existing.hash || knownHash),
        clientState,
        rpcAccepted: true,
        clientAccepted,
      }
    }
  }

  if (knownHash && lastError) {
    throw new Error(
      `Broadcast may have failed (${lastError.message}). Hash ${knownHash.slice(0, 12)}… not visible yet.`,
    )
  }

  throw new Error(
    lastError?.message ?? 'Could not broadcast transaction to the Nimiq network',
  )
}

/**
 * Wait until a tx is visible via public RPC and/or the light client.
 * Optionally rebroadcast the serialized hex on each poll.
 */
export async function waitForTransactionVisible(
  txHash: string,
  timeoutMs = 45_000,
  pollMs = 2_000,
  options?: { rebroadcastHex?: string },
): Promise<NimiqTransaction | null> {
  const started = Date.now()
  let attempt = 0
  while (Date.now() - started < timeoutMs) {
    const tx = await fetchTransaction(txHash)
    if (tx) return tx

    // Light client may know about a tx before public RPC indexes it.
    try {
      const client = await getBroadcastClient()
      const details = await client.getTransaction(txHash)
      if (details && details.state !== 'invalidated' && details.state !== 'expired') {
        return plainDetailsToNimiqTx(details)
      }
    } catch {
      /* not known to light client yet */
    }

    if (options?.rebroadcastHex && attempt > 0 && attempt % 2 === 0) {
      try {
        await sendRawTransactionViaRpc(options.rebroadcastHex)
      } catch {
        /* ignore rebroadcast errors */
      }
      try {
        const client = await getBroadcastClient()
        await client.sendTransaction(Transaction.fromAny(options.rebroadcastHex))
      } catch {
        /* ignore */
      }
    }

    attempt += 1
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return null
}

function plainDetailsToNimiqTx(details: {
  transactionHash: string
  sender: string
  recipient: string
  value: number | bigint
  data?: { raw?: string } | string
  recipientData?: string
  executionResult?: boolean
  confirmations?: number
  blockHeight?: number
}): NimiqTransaction {
  let recipientData = ''
  if (typeof details.recipientData === 'string') {
    recipientData = details.recipientData
  } else if (details.data && typeof details.data === 'object' && details.data !== null && 'raw' in details.data) {
    recipientData = String((details.data as { raw?: string }).raw ?? '')
  } else if (typeof details.data === 'string') {
    recipientData = details.data
  }
  const confirmations =
    details.confirmations ??
    (details.blockHeight != null && details.blockHeight > 0 ? 1 : 0)
  return {
    hash: details.transactionHash,
    from: details.sender,
    to: details.recipient,
    value: typeof details.value === 'bigint' ? Number(details.value) : details.value,
    recipientData,
    // Light-client pending/included txs without an explicit result are treated as success.
    executionResult: details.executionResult ?? true,
    confirmations,
    blockNumber: details.blockHeight,
  }
}

export async function fetchTransaction(hash: string): Promise<NimiqTransaction | null> {
  const cleanHash = normalizeTxHash(hash)

  // 1) Public RPC (authoritative for our attestation checks)
  try {
    const tx = await rpcCall<Record<string, unknown>>('getTransactionByHash', [cleanHash])
    return {
      hash: tx.hash as string,
      from: tx.from as string,
      to: tx.to as string,
      value: tx.value as number,
      recipientData: (tx.recipientData as string) ?? '',
      executionResult: tx.executionResult as boolean,
      confirmations: (tx.confirmations as number) ?? 0,
      blockNumber: tx.blockNumber as number | undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isTransactionNotFoundError(message)) throw err
  }

  try {
    const tx = await rpcCall<Record<string, unknown>>('getTransactionFromMempool', [cleanHash])
    return {
      hash: tx.hash as string,
      from: tx.from as string,
      to: tx.to as string,
      value: tx.value as number,
      recipientData: (tx.recipientData as string) ?? '',
      executionResult: true,
      confirmations: 0,
    }
  } catch {
    /* fall through to light client */
  }

  // 2) Light client fallback (may see txs public RPC has not indexed yet)
  try {
    if (broadcastClient || broadcastClientInit) {
      const client = await getBroadcastClient()
      const details = await client.getTransaction(cleanHash)
      if (details && details.state !== 'invalidated' && details.state !== 'expired') {
        return plainDetailsToNimiqTx(details)
      }
    }
  } catch {
    /* not found */
  }

  return null
}

export interface AttestationExpectation {
  senderAddress: string
  docId: string
  finalSha256: string
  /** When true, require credit-reservation + service (or reserved) minimal proof. */
  paymentMode?: 'direct' | 'credit' | 'auto'
  /** Service wallet that may post credit seals (normalized). */
  serviceWalletAddress?: string | null
}

export async function verifyAttestation(
  txHash: string,
  expectation: AttestationExpectation,
): Promise<{ tx: NimiqTransaction; paymentMode: 'direct' | 'credit' }> {
  const tx = await fetchTransaction(txHash)
  if (!tx) throw new Error('Transaction not found on-chain yet. Wait a few seconds and retry.')

  if (tx.confirmations < MIN_CONFIRMATIONS) {
    throw new Error(
      `Transaction pending (${tx.confirmations}/${MIN_CONFIRMATIONS} confirmations). Retry shortly.`,
    )
  }

  if (!tx.executionResult) {
    const sender = normalizeAddress(tx.from)
    const recipient = normalizeAddress(tx.to)
    const expectedSink = getExpectedAttestationRecipient()
    if (expectedSink && recipient === expectedSink && recipient !== sender) {
      throw new Error(
        'Transaction failed on-chain (executionResult: false). ' +
          'Ensure the seal fee is sent correctly, or use pay-with-credit for a server-posted proof.',
      )
    }
    throw new Error(
      'Transaction failed on-chain (executionResult: false). ' +
        'Ensure the signing wallet has enough NIM for fees, then retry seal.',
    )
  }

  if (normalizeAddress(tx.from) !== normalizeAddress(expectation.senderAddress)) {
    throw new Error('Transaction sender does not match the expected attestation sender')
  }

  const sender = normalizeAddress(tx.from)
  const recipient = normalizeAddress(tx.to)
  const expectedFeeLuna = getSealFeeLuna()
  const expectedRecipient = getExpectedAttestationRecipient()
  const serviceWallet =
    expectation.serviceWalletAddress?.trim()
      ? normalizeAddress(expectation.serviceWalletAddress)
      : getServiceWalletAddressFromEnv()

  const modeHint = expectation.paymentMode ?? 'auto'
  const hasCreditHold = hasActiveCreditReservation(expectation.docId)
  // Credit proofs: minimal value from service wallet → attestation sink.
  // Self-send is rejected by Nimiq ("Sender same as recipient") and must not be used.
  const looksLikeCreditProof =
    isCreditProofValueLuna(tx.value) &&
    expectedRecipient != null &&
    recipient === expectedRecipient &&
    (!serviceWallet || sender === serviceWallet)

  let paymentMode: 'direct' | 'credit'

  if (modeHint === 'credit' || (modeHint === 'auto' && looksLikeCreditProof && hasCreditHold)) {
    if (!hasCreditHold) {
      throw new Error('Credit reservation required for minimal-value seal proofs')
    }
    if (!isCreditProofValueLuna(tx.value)) {
      throw new Error('Credit seal proof must use a minimal on-chain value (0 or 1 luna)')
    }
    if (serviceWallet && sender !== serviceWallet) {
      throw new Error('Credit seal proof must be sent from the VeriLock service wallet')
    }
    if (!expectedRecipient || recipient !== expectedRecipient) {
      throw new Error(
        'Credit seal proof must send the minimal value to the attestation sink (self-send is not allowed on Nimiq)',
      )
    }
    paymentMode = 'credit'
  } else {
    // Direct pay: full current fee to sink only (legacy free amounts closed).
    if (!isValidDirectSealFeeLuna(tx.value)) {
      throw new Error(
        `Attestation transaction must transfer the current seal fee (${expectedFeeLuna} luna)`,
      )
    }
    if (!expectedRecipient) {
      throw new Error('Attestation sink is not configured')
    }
    if (recipient !== expectedRecipient) {
      throw new Error('Attestation transaction recipient does not match the expected sink address')
    }
    paymentMode = 'direct'
  }

  verifyAttestationPayload(tx.recipientData, expectation.docId, expectation.finalSha256)

  return { tx, paymentMode }
}