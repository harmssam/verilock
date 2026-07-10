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
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  if (!res.ok) throw new Error(`Nimiq RPC HTTP ${res.status}`)
  const json = (await res.json()) as RpcResponse<T>
  if (json.error) throw new Error(formatRpcError(json.error))
  if (json.result?.data === undefined || json.result?.data === null) {
    if (options?.allowEmpty) return undefined as T
    throw new Error('Empty RPC response')
  }
  return json.result.data
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

/**
 * Broadcast a signed transaction hex to the Nimiq network.
 * Prefer the web client; fall back to JSON-RPC. Always return a real tx hash.
 */
export async function broadcastRawTransaction(rawTx: string): Promise<string> {
  const clean = normalizeRawTransactionHex(rawTx)
  let lastError: Error | null = null
  let knownHash: string | null = null

  try {
    knownHash = hashFromSerializedTx(clean)
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
  }

  try {
    const client = await getBroadcastClient()
    const details = await client.sendTransaction(clean)
    const hash = normalizeTxHash(details.transactionHash)
    if (hash) {
      // Also push to the public JSON-RPC node we use for verification so the
      // tx is not only in the light client's peer set.
      try {
        await rpcCall<string>('sendRawTransaction', [clean])
      } catch {
        /* already known / race — ignore */
      }
      return hash
    }
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
  }

  try {
    const hash = await rpcCall<string>('sendRawTransaction', [clean])
    if (typeof hash === 'string' && hash.length > 0) {
      return normalizeTxHash(hash)
    }
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
  }

  // If the network already has the tx (duplicate broadcast), return its real hash.
  if (knownHash) {
    const existing = await fetchTransaction(knownHash)
    if (existing) return normalizeTxHash(existing.hash || knownHash)
  }

  if (knownHash && lastError) {
    // Client may have accepted the tx even if the promise rejected late.
    throw new Error(
      `Broadcast may have failed (${lastError.message}). Hash ${knownHash.slice(0, 12)}… not visible on RPC yet.`,
    )
  }

  throw new Error(
    lastError?.message ?? 'Could not broadcast transaction to the Nimiq network',
  )
}

/** Wait until a tx is visible via getTransactionByHash or mempool, or timeout. */
export async function waitForTransactionVisible(
  txHash: string,
  timeoutMs = 45_000,
  pollMs = 2_000,
): Promise<NimiqTransaction | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const tx = await fetchTransaction(txHash)
    if (tx) return tx
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return null
}

export async function fetchTransaction(hash: string): Promise<NimiqTransaction | null> {
  const cleanHash = normalizeTxHash(hash)
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
    return null
  }
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
  const looksLikeCreditProof =
    isCreditProofValueLuna(tx.value) &&
    (recipient === sender || (expectedRecipient != null && recipient === expectedRecipient))

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
    if (recipient !== sender && expectedRecipient && recipient !== expectedRecipient) {
      throw new Error('Credit seal proof recipient is invalid')
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