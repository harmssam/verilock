import {
  Address,
  KeyPair,
  PrivateKey,
  TransactionBuilder,
  type Client,
} from '@nimiq/core'
import { normalizeAddress } from './addresses.js'
import { CREDIT_PROOF_VALUE_LUNA } from './creditsConfig.js'
import {
  broadcastRawTransactionDetailed,
  buildAttestationPayloadBytes,
  getBlockNumber,
  getBroadcastClientForService,
  getWalletBalanceLuna,
  waitForTransactionVisible,
} from './nimiq-rpc.js'

const MAX_PROOF_LUNA = 2
/** Min free balance: proof value + small buffer for fees. */
const MIN_SERVICE_BALANCE_LUNA = CREDIT_PROOF_VALUE_LUNA + 10

let cachedKeyPair: KeyPair | null = null
let cachedAddress: string | null = null

function parsePrivateKeyHex(raw: string): PrivateKey {
  const clean = raw.replace(/^0x/i, '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('SERVICE_WALLET_PRIVATE_KEY must be a 32-byte hex private key')
  }
  return PrivateKey.fromHex(clean)
}

export function isServiceWalletConfigured(): boolean {
  return Boolean(process.env.SERVICE_WALLET_PRIVATE_KEY?.trim())
}

export function getServiceWalletAddress(): string | null {
  if (cachedAddress) return cachedAddress
  const raw = process.env.SERVICE_WALLET_PRIVATE_KEY?.trim()
  if (!raw) return null
  try {
    const keyPair = getServiceKeyPair()
    cachedAddress = normalizeAddress(keyPair.toAddress().toUserFriendlyAddress())
    return cachedAddress
  } catch {
    return null
  }
}

function getServiceKeyPair(): KeyPair {
  if (cachedKeyPair) return cachedKeyPair
  const raw = process.env.SERVICE_WALLET_PRIVATE_KEY?.trim()
  if (!raw) {
    throw new Error('SERVICE_WALLET_PRIVATE_KEY is not configured')
  }
  const privateKey = parsePrivateKeyHex(raw)
  cachedKeyPair = KeyPair.derive(privateKey)
  cachedAddress = normalizeAddress(cachedKeyPair.toAddress().toUserFriendlyAddress())
  return cachedKeyPair
}

function normalizeTxHashFromCore(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase()
}

/**
 * Broadcast a minimal self-send attestation from the service wallet.
 * Value is capped; only called after a credit reservation exists.
 *
 * Strategy (aligned with @nimiq/core + public RPC):
 * 1. Build/sign with service key
 * 2. Broadcast via light client + public sendRawTransaction
 * 3. Poll both for visibility, rebroadcasting while waiting
 * 4. If at least one path accepted the tx, return the hash even if public RPC
 *    is slow — the attestation poller will confirm when it appears.
 */
export async function broadcastCreditSealProof(input: {
  documentId: string
  finalSha256: string
}): Promise<{ txHash: string; senderAddress: string }> {
  const keyPair = getServiceKeyPair()
  const senderAddress = normalizeAddress(keyPair.toAddress().toUserFriendlyAddress())
  const valueLuna = CREDIT_PROOF_VALUE_LUNA
  if (valueLuna < 0 || valueLuna > MAX_PROOF_LUNA) {
    throw new Error('Invalid credit proof value configuration')
  }

  // Fail fast if the service wallet cannot pay the dust proof.
  try {
    const balance = await getWalletBalanceLuna(senderAddress)
    if (balance < MIN_SERVICE_BALANCE_LUNA) {
      throw new Error(
        `Service wallet balance too low (${balance} luna). Fund ${senderAddress} with a little NIM.`,
      )
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Service wallet balance')) throw err
    console.warn('[credits] could not read service wallet balance', err)
  }

  const payload = buildAttestationPayloadBytes(input.documentId, input.finalSha256)
  const client: Client = await getBroadcastClientForService()
  const networkId = await client.getNetworkId()
  const headHeight = await client.getHeadHeight()
  // Slightly behind head so the validity window is open for the next blocks.
  const validityStartHeight = Math.max(0, headHeight - 1)

  const sender = Address.fromString(senderAddress)
  const recipient = sender // self-send proof
  const tx = TransactionBuilder.newBasicWithData(
    sender,
    recipient,
    payload,
    BigInt(valueLuna),
    BigInt(0),
    validityStartHeight,
    networkId,
  )
  tx.sign(keyPair, undefined)

  const hex = tx.toHex()
  const expectedHash = normalizeTxHashFromCore(tx.hash())
  console.log('[credits] service wallet broadcasting proof', {
    documentId: input.documentId,
    sender: senderAddress,
    valueLuna,
    networkId,
    headHeight,
    validityStartHeight,
    expectedHash: expectedHash.slice(0, 16),
    payloadBytes: payload.length,
  })

  let broadcast: Awaited<ReturnType<typeof broadcastRawTransactionDetailed>>
  try {
    broadcast = await broadcastRawTransactionDetailed(hex)
  } catch (err) {
    // Last resort: try client.sendTransaction with the Transaction object directly.
    try {
      const details = await client.sendTransaction(tx)
      const hash = normalizeTxHashFromCore(details.transactionHash)
      if (details.state === 'invalidated' || details.state === 'expired') {
        throw new Error(`Service wallet tx rejected (state: ${details.state})`)
      }
      broadcast = {
        hash,
        clientState: details.state,
        clientAccepted: true,
        rpcAccepted: false,
      }
      console.warn('[credits] client-only broadcast after dual-path failure', {
        hash: hash.slice(0, 16),
        state: details.state,
      })
    } catch (inner) {
      throw err instanceof Error ? err : inner
    }
  }

  const txHash = broadcast.hash || expectedHash
  console.log('[credits] broadcast accepted', {
    txHash: txHash.slice(0, 16),
    clientAccepted: broadcast.clientAccepted,
    rpcAccepted: broadcast.rpcAccepted,
    clientState: broadcast.clientState,
  })

  // Poll for visibility while rebroadcasting. Soft-fail: if either path accepted
  // the tx, return the hash so the attestation poller can confirm (public RPC can lag).
  const visible = await waitForTransactionVisible(txHash, 45_000, 2_000, {
    rebroadcastHex: hex,
  })

  if (visible) {
    console.log('[credits] proof visible', {
      txHash: txHash.slice(0, 16),
      confirmations: visible.confirmations,
      blockNumber: visible.blockNumber,
    })
    return { txHash, senderAddress }
  }

  if (broadcast.clientAccepted || broadcast.rpcAccepted) {
    console.warn(
      '[credits] proof not yet visible on public RPC; proceeding with pending attestation',
      { txHash: txHash.slice(0, 16) },
    )
    return { txHash, senderAddress }
  }

  throw new Error(
    `Credit seal proof was not accepted by the Nimiq network (tx ${txHash.slice(0, 12)}…). Retry seal shortly.`,
  )
}

/** Prefer getBlockNumber from RPC module if client height fails. */
export async function getNetworkHeightFallback(): Promise<number> {
  try {
    const client = await getBroadcastClientForService()
    return await client.getHeadHeight()
  } catch {
    return getBlockNumber()
  }
}
