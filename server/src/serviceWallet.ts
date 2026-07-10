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
  broadcastRawTransaction,
  buildAttestationPayloadBytes,
  getBlockNumber,
  getBroadcastClientForService,
} from './nimiq-rpc.js'

const MAX_PROOF_LUNA = 2

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

/**
 * Broadcast a minimal self-send attestation from the service wallet.
 * Value is capped; only called after a credit reservation exists.
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

  const payload = buildAttestationPayloadBytes(input.documentId, input.finalSha256)
  const client: Client = await getBroadcastClientForService()
  const networkId = await client.getNetworkId()
  const headHeight = await client.getHeadHeight()
  // validity window: current head is fine for newBasicWithData
  const validityStartHeight = headHeight

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
  console.log('[credits] service wallet broadcasting proof', {
    documentId: input.documentId,
    sender: senderAddress,
    valueLuna,
  })
  const txHash = await broadcastRawTransaction(hex)
  return { txHash, senderAddress }
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
