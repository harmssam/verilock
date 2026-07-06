import HubApi from '@nimiq/hub-api'
import type { ChooseAddressResult, SignedMessage, SignedTransaction } from '@nimiq/hub-api'

import {
  clearRpcIdSearchParam,
  consumeRedirectHash,
  getHubReturnUrl,
  loadStoredRpcRequest,
  readRedirectResponse,
  type RpcRedirectResponse,
  type StoredRpcRequest,
} from './hubRedirectParse'
import { loadSealInFlight } from './sealRecovery'
import type { BroadcastFallbackFactory, TransactionBroadcastFallback } from './nimiq'
import { sealError, sealLog, sealWarn } from './sealDebug'

const { RedirectRequestBehavior, RequestType } = HubApi

export type HubLockRedirectResult = {
  token: string
  docId: string
  txHash: string
}

export type HubRedirectDeps = {
  appName: string
  getHubApi: () => HubApi
  bytesToHex: (bytes: Uint8Array) => string
  isLockHubCommand: (command: string, state: Record<string, unknown> | null | undefined) => boolean
  finalizeHubLockTransaction: (
    signed: SignedTransaction,
    options?: {
      hubBroadcast?: boolean
      broadcastFallback?: TransactionBroadcastFallback
    },
  ) => Promise<string>
}

function formatHubRedirectError(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof result === 'string' && result.trim()) return result
  return 'Hub redirect failed'
}

function looksLikeSignedTransaction(value: unknown): value is SignedTransaction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as SignedTransaction
  return Boolean(
    candidate.hash ||
      candidate.serializedTx ||
      (candidate.transaction instanceof Uint8Array && candidate.transaction.length > 0),
  )
}

function lockContextFromRequest(
  request: StoredRpcRequest,
  isLockHubCommand: HubRedirectDeps['isLockHubCommand'],
): { token: string; docId: string; hubBroadcast: boolean } | null {
  if (!isLockHubCommand(request.command, request.state)) return null
  const token = request.state?.token as string | undefined
  const docId = request.state?.docId as string | undefined
  if (!token || !docId) return null
  return {
    token,
    docId,
    hubBroadcast: request.command === RequestType.CHECKOUT,
  }
}

function lockContextFromSealInFlight(): { token: string; docId: string; hubBroadcast: boolean } | null {
  const seal = loadSealInFlight()
  if (!seal) return null
  return { token: seal.token, docId: seal.docId, hubBroadcast: false }
}

function completeLockRedirect(
  deps: HubRedirectDeps,
  redirect: RpcRedirectResponse,
  lockCtx: { token: string; docId: string; hubBroadcast: boolean },
  onLockComplete: ((result: HubLockRedirectResult) => void) | undefined,
  onLockError: ((err: Error) => void) | undefined,
  createBroadcastFallback: BroadcastFallbackFactory | undefined,
  registerLockWork?: (work: Promise<void>) => void,
): boolean {
  consumeRedirectHash()
  clearRpcIdSearchParam()

  if (redirect.status === 'error') {
    const err = new Error(formatHubRedirectError(redirect.result))
    registerLockWork?.(Promise.resolve(onLockError?.(err)).then(() => undefined))
    return true
  }

  try {
    const signed = redirect.result as SignedTransaction
    if (!looksLikeSignedTransaction(signed)) {
      throw new Error('Hub did not return a signed transaction.')
    }
    const { token, docId, hubBroadcast } = lockCtx
    sealLog('hub:lenientLockComplete', { docId, hash: signed.hash, hubBroadcast })
    const lockWork = deps
      .finalizeHubLockTransaction(signed, {
        hubBroadcast,
        broadcastFallback: createBroadcastFallback?.(token, docId),
      })
      .then(async txHash => {
        sealLog('hub:lenientLockRelayed', { docId, txHash })
        await onLockComplete?.({ token, docId, txHash })
      })
      .catch(err => onLockError?.(err instanceof Error ? err : new Error(String(err))))
    registerLockWork?.(lockWork)
    return true
  } catch (err) {
    sealError('hub:lenientLockFailed', err)
    registerLockWork?.(
      Promise.resolve(onLockError?.(err instanceof Error ? err : new Error(String(err)))).then(
        () => undefined,
      ),
    )
    return true
  }
}

/**
 * Hub's default redirect parser requires document.referrer, which is often empty when
 * Hub sends the user back. Parse the URL hash (and stored rpc responses) ourselves.
 */
export function processLenientHubRedirect(
  deps: HubRedirectDeps,
  getChallenge: (address: string) => Promise<{ token: string; nonce: string }>,
  onComplete: (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => void,
  onError: (err: Error) => void,
  onLockComplete?: (result: HubLockRedirectResult) => void | Promise<void>,
  onLockError?: (err: Error) => void | Promise<void>,
  createBroadcastFallback?: BroadcastFallbackFactory,
  registerLockWork?: (work: Promise<void>) => void,
): boolean {
  const redirect = readRedirectResponse()
  if (!redirect) return false

  const request = loadStoredRpcRequest(redirect.id)
  const lockFromRequest = request ? lockContextFromRequest(request, deps.isLockHubCommand) : null
  // When rpcRequests is lost after cross-site redirect, sealInFlight identifies lock round-trips
  // (including Hub error responses — not only successful signed transactions).
  const lockFromFallback = !request ? lockContextFromSealInFlight() : null
  const lockCtx = lockFromRequest ?? lockFromFallback
  sealLog('hub:lenientRedirect', {
    redirectId: redirect.id,
    hasRequest: Boolean(request),
    lockDocId: lockCtx?.docId,
    usedSealFallback: Boolean(lockFromFallback),
  })

  if (!request && !lockCtx) {
    sealWarn('hub:lenientRedirectMissingRequest', { id: redirect.id })
    return false
  }

  if (lockCtx) {
    if (!request) {
      sealWarn('hub:lenientRedirectMissingRequest', { id: redirect.id, fallback: 'sealInFlight' })
    }
    return completeLockRedirect(
      deps,
      redirect,
      lockCtx,
      onLockComplete,
      onLockError,
      createBroadcastFallback,
      registerLockWork,
    )
  }

  consumeRedirectHash()
  clearRpcIdSearchParam()

  if (redirect.status === 'error') {
    onError(new Error(formatHubRedirectError(redirect.result)))
    return true
  }

  if (request!.command === RequestType.CHOOSE_ADDRESS) {
    try {
      const { address } = redirect.result as ChooseAddressResult
      sealLog('hub:lenientChooseAddress', { address })
      void (async () => {
        try {
          const { token, nonce } = await getChallenge(address)
          const hub = deps.getHubApi()
          const behavior = new RedirectRequestBehavior(getHubReturnUrl(), { token })
          await hub.signMessage(
            { appName: deps.appName, message: nonce, signer: address },
            behavior as Parameters<typeof hub.signMessage>[1],
          )
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)))
        }
      })()
      return true
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
      return true
    }
  }

  if (request!.command === RequestType.SIGN_MESSAGE) {
    try {
      const token = request!.state?.token as string | undefined
      if (!token) throw new Error('Login session expired — try again.')
      const msg = redirect.result as SignedMessage
      onComplete({
        token,
        address: msg.signer,
        publicKey: deps.bytesToHex(msg.signerPublicKey),
        signature: deps.bytesToHex(msg.signature),
      })
      return true
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
      return true
    }
  }

  return false
}