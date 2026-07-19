import HubApi from '@nimiq/hub-api'
import type { ChooseAddressResult, SignedMessage, SignedTransaction } from '@nimiq/hub-api'

const { RedirectRequestBehavior, RequestType } = HubApi
import { getHostLanguage, init } from '@nimiq/mini-app-sdk'
import {
  processLenientHubRedirect,
  type HubLockRedirectResult,
} from './hubSealRedirect'
import { saveHubReturnPath } from './hubReturnPath'
import { clearStaleHubRpcStateIfIdle, getHubReturnUrl } from './hubRedirectParse'
import { peekHubRedirectInUrl, RPC_ID_SEARCH_PARAM } from './sealRecovery'
import { sealError, sealLog, sealWarn } from './sealDebug'
import { getSealFeeLuna } from './sealPricing'

export { peekHubRedirectInUrl }
export type { HubLockRedirectResult }

const HUB_ENDPOINT = import.meta.env.VITE_NIMIQ_HUB_URL ?? 'https://hub.nimiq.com'
const NIMIQ_RPC_URL = import.meta.env.VITE_NIMIQ_RPC_URL ?? 'https://rpc.nimiqwatch.com'
/** Shown in Nimiq Hub / Pay when approving login and seal transactions. */
const APP_NAME = 'VeriLock'

export type WalletMode = 'nimiq-pay' | 'hub'

let hubApi: HubApi | null = null
let hubRedirectHandlersReady = false
const hubLockCompletionInFlight = new Set<string>()

export function getProviderErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  const maybeError = (value as { error?: { message?: unknown } }).error
  if (maybeError && typeof maybeError.message === 'string') return maybeError.message
  return 'Provider request failed.'
}

export function getWalletMode(): WalletMode {
  if (isNimiqPayHost() || (typeof window !== 'undefined' && window.nimiq)) return 'nimiq-pay'
  return 'hub'
}

/** Nimiq Pay injects `window.nimiqPay` before page scripts — reliable host detection. */
export function isNimiqPayHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nimiqPay)
}

export async function probeNimiqPay(timeoutMs = 2_500): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (window.nimiq) return true
  const timeout = isNimiqPayHost() ? Math.max(timeoutMs, 20_000) : timeoutMs
  try {
    await init({ timeout })
    return Boolean(window.nimiq)
  } catch {
    return false
  }
}

/** Pre-warm the injected provider as soon as the Nimiq Pay host is detected. */
export function warmNimiqProvider(): void {
  if (!isNimiqPayHost() || window.nimiq) return
  void init({ timeout: 30_000 }).catch(() => {
    /* user may connect manually */
  })
}

function getHubApi(): HubApi {
  if (!hubApi) hubApi = new HubApi(HUB_ENDPOINT)
  return hubApi
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function ensureNimiqProvider(existing: Awaited<ReturnType<typeof init>> | null = null) {
  if (existing) return existing
  if (typeof window !== 'undefined' && window.nimiq) return window.nimiq
  const inPay = await probeNimiqPay(isNimiqPayHost() ? 30_000 : 10_000)
  if (!inPay) {
    throw new Error(
      'Nimiq Pay wallet not found. On desktop, lock via Nimiq Hub instead.',
    )
  }
  const { nimiq } = await connectNimiq()
  return nimiq
}

export async function connectNimiq() {
  const timeout = isNimiqPayHost() ? 30_000 : 10_000
  const nimiq = await init({ timeout })
  // connect() prompts the native Nimiq Pay account dialog when needed.
  await nimiq.connect()
  const accountsResult = await nimiq.listAccounts()
  const accountsError = getProviderErrorMessage(accountsResult)
  if (accountsError) throw new Error(accountsError)
  const accounts = accountsResult as string[]
  if (!accounts.length) throw new Error('No Nimiq accounts returned.')
  return { nimiq, address: accounts[0] }
}

export async function signChallenge(nimiq: Awaited<ReturnType<typeof init>>, nonce: string) {
  // Pass as object with isHex:false so the provider treats the nonce as a plain text/UTF-8 message
  // (not a hex string). This must match the isHex:false passed to verifySignature on the server for 'pay'.
  const signatureResult = await nimiq.sign({ message: nonce, isHex: false })
  const signatureError = getProviderErrorMessage(signatureResult)
  if (signatureError) throw new Error(signatureError)
  const { publicKey, signature } = signatureResult as { publicKey: string; signature: string }
  return { publicKey, signature }
}

export function isPopupBlockedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /failed to open popup|popup blocked|blocked/i.test(message)
}

export function popupBlockedHelp(): string {
  return (
    'Pop-up blocked. Allow pop-ups for this site in your browser settings, ' +
    'or open VeriLock inside the Nimiq Pay app (recommended — no pop-ups needed).'
  )
}

function hubRedirectBehavior(localState: Record<string, unknown>) {
  return new RedirectRequestBehavior(getHubReturnUrl(), localState)
}

/** Hub redirect is the supported desktop flow; popup is opt-in only. */
export function shouldUseHubRedirect(options?: { useRedirect?: boolean; usePopup?: boolean }): boolean {
  if (options?.usePopup === true) return false
  if (options?.useRedirect === false) return false
  // Per integration guide: prefer redirects for mobile/kiosk to avoid popup blockers.
  // Force redirect on detected mobile to make cross-platform reliable.
  if (isMobileDevice()) return true
  return true
}

export const HUB_REDIRECT_MESSAGE = 'Redirecting to Nimiq Hub…'

export function isHubRedirectError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message === HUB_REDIRECT_MESSAGE
}

/** Friendly copy when the user dismisses Hub / Pay login. */
export const LOGIN_CANCELED_MESSAGE = 'Login Canceled'

/**
 * Per Nimiq Hub integration guide: explicit cancel vs error.
 * Hub/Pay may surface "Request was cancelled", "CANCELED", or similar.
 */
export function isHubCancelError(err: unknown): boolean {
  const message = (err instanceof Error ? err.message : String(err)).trim()
  if (!message) return false
  if (message === 'Request was cancelled') return true
  // US/UK spelling; Hub often returns bare "CANCELED"
  if (/^cancell?ed$/i.test(message)) return true
  if (/cancell?ed by user/i.test(message)) return true
  if (/request was cancell?ed/i.test(message)) return true
  if (/user cancell?ed/i.test(message)) return true
  return false
}

function normalizeTxHash(hash: string): string {
  return hash.replace(/^0x/i, '').toLowerCase()
}

function signedTxHash(signed: SignedTransaction): string {
  if (signed.hash) return normalizeTxHash(signed.hash)
  throw new Error('Hub did not return a transaction hash.')
}

function formatRpcError(error: { message?: string; data?: unknown }): string {
  const message = error.message?.trim() || 'Nimiq RPC error'
  const data = typeof error.data === 'string' ? error.data.trim() : ''
  if (!data || message.toLowerCase().includes(data.toLowerCase())) return message
  return `${message}: ${data}`
}

function isTransactionNotFoundError(message: string): boolean {
  return message.toLowerCase().includes('not found')
}

async function nimiqRpcCall<T>(
  method: string,
  params: unknown[],
  options?: { allowEmpty?: boolean },
): Promise<T> {
  const res = await fetch(NIMIQ_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  if (!res.ok) throw new Error(`Nimiq RPC HTTP ${res.status}`)
  const json = (await res.json()) as {
    result?: { data: T }
    error?: { message: string; data?: unknown }
  }
  if (json.error) throw new Error(formatRpcError(json.error))
  if (json.result?.data === undefined || json.result?.data === null) {
    if (options?.allowEmpty) return undefined as T
    throw new Error(`Empty Nimiq RPC response (${method})`)
  }
  return json.result.data
}

async function transactionKnownOnNetwork(hash: string): Promise<boolean> {
  const clean = normalizeTxHash(hash)
  try {
    await nimiqRpcCall<Record<string, unknown>>('getTransactionByHash', [clean])
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isTransactionNotFoundError(message)) {
      sealWarn('hub:transactionLookupFailed', { hash: clean, message })
    }
  }
  try {
    await nimiqRpcCall<Record<string, unknown>>('getTransactionFromMempool', [clean])
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!isTransactionNotFoundError(message)) {
      sealWarn('hub:mempoolLookupFailed', { hash: clean, message })
    }
    return false
  }
}

const BROADCAST_POLL_MS = 1_500
const BROADCAST_VERIFY_MS = 4_000
const BROADCAST_VERIFY_POLL_MS = 500
const HUB_CHECKOUT_NETWORK_WAIT_MS = 30_000
const RELAY_NETWORK_SOFT_WAIT_MS = 20_000

/** Cache for recent block height to allow sync access during user gesture for Hub calls.
 *  Refreshed in background; allows Hub request to be prepared without await in click path.
 *  We keep a lastKnown fallback (even if older) because validityStartHeight is usually
 *  tolerant, and we always refresh async. This makes the seal gesture path never block on RPC.
 */
let cachedBlock: { height: number; fetchedAt: number } | null = null
let lastKnownBlock: number | null = null
const BLOCK_CACHE_MS = 60_000 // generous for long redirects

async function refreshBlockHeight(): Promise<number> {
  try {
    const h = await nimiqRpcCall<number>('getBlockNumber', [])
    cachedBlock = { height: h, fetchedAt: Date.now() }
    lastKnownBlock = h
    return h
  } catch (e) {
    sealWarn('hub:blockRefreshFailed', e)
    if (cachedBlock) return cachedBlock.height
    if (lastKnownBlock != null) return lastKnownBlock
    throw e
  }
}

/** Sync read of recent block (or triggers background refresh). Used to avoid await before Hub sign in gesture.
 *  Falls back to lastKnown (possibly slightly stale) rather than blocking — Hub/Keyguard tolerate it.
 */
function getRecentBlockHeightSync(): number | null {
  const now = Date.now()
  if (cachedBlock && now - cachedBlock.fetchedAt < BLOCK_CACHE_MS) {
    void refreshBlockHeight().catch(() => {})
    lastKnownBlock = cachedBlock.height
    return cachedBlock.height
  }
  // Always refresh in background
  void refreshBlockHeight().catch(() => {})
  if (cachedBlock) {
    lastKnownBlock = cachedBlock.height
    return cachedBlock.height
  }
  return lastKnownBlock
}

/** Hub checkout payload for seal — checkout() signs and broadcasts. */
export type HubLockCheckoutRequest = {
  appName: string
  sender: string
  forceSender: true
  recipient: string
  value: number
  flags: number
  extraData: Uint8Array
  /** Hub sets validityStartHeight; 120 is the documented max/default duration. */
  validityDuration: number
}

/**
 * Hub checkout request for seal (sync — safe on user-gesture path).
 *
 * Per Nimiq Hub docs, checkout() signs **and broadcasts**. Prefer this over
 * signTransaction(), which only returns a signed payload and often fails to
 * land when we rebroadcast ourselves (see docs/nimiq-network-integration.md).
 */
export function buildLockRequestSync(
  address: string,
  docId: string,
  finalSha256: string,
): HubLockCheckoutRequest {
  const recipient = getHubAttestationRecipient()
  return {
    appName: APP_NAME,
    sender: address,
    forceSender: true,
    recipient,
    value: getSealFeeLuna(),
    flags: 0,
    extraData: buildAttestationPayloadBytes(docId, finalSha256.toLowerCase()),
    validityDuration: 120,
  }
}

let sealProgressReporter: ((message: string) => void) | null = null

export function setSealProgressReporter(reporter: ((message: string) => void) | null): void {
  sealProgressReporter = reporter
}

function reportSealProgress(message: string): void {
  sealProgressReporter?.(message)
  sealLog('hub:progress', { message })
}

async function waitForTransactionOnNetwork(
  hash: string,
  timeoutMs: number,
  options?: { required?: boolean },
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await transactionKnownOnNetwork(hash)) {
      sealLog('hub:transactionVisibleOnNetwork', { hash })
      return true
    }
    await new Promise(resolve => setTimeout(resolve, BROADCAST_POLL_MS))
  }
  if (options?.required) {
    throw new Error(
      'Transaction was signed in Hub but did not reach the Nimiq network. Tap Retry seal to sign again.',
    )
  }
  return false
}

export type TransactionBroadcastFallback = (serializedTx: string) => Promise<void>
export type BroadcastFallbackFactory = (token: string, docId: string) => TransactionBroadcastFallback

function normalizeRawTransactionHex(rawTx: string): string {
  const clean = rawTx.replace(/^0x/i, '').trim()
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid serialized transaction from Hub')
  }
  return clean.toLowerCase()
}

function serializedTxFromSigned(signed: SignedTransaction): string {
  if (signed.serializedTx) return normalizeRawTransactionHex(signed.serializedTx)
  if (signed.transaction instanceof Uint8Array && signed.transaction.length > 0) {
    return bytesToHex(signed.transaction)
  }
  throw new Error('Hub did not return a serialized transaction.')
}

async function broadcastViaServer(
  serialized: string,
  broadcastFallback: TransactionBroadcastFallback,
  label: string,
): Promise<void> {
  sealLog(label, { bytes: serialized.length / 2 })
  await broadcastFallback(serialized)
}

async function broadcastRawTransaction(
  serialized: string,
  broadcastFallback?: TransactionBroadcastFallback,
  options?: { preferServer?: boolean },
): Promise<void> {
  const clean = normalizeRawTransactionHex(serialized)

  if (options?.preferServer && broadcastFallback) {
    await broadcastViaServer(clean, broadcastFallback, 'hub:broadcastViaServer')
    return
  }

  sealLog('hub:broadcastRawTransaction', { bytes: clean.length / 2 })
  let acceptedHash: string | null = null
  try {
    const hash = await nimiqRpcCall<string>('sendRawTransaction', [clean])
    if (hash) {
      acceptedHash = normalizeTxHash(hash)
      sealLog('hub:broadcastAccepted', { hash: acceptedHash })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sealWarn('hub:clientBroadcastFailed', { message })
  }

  if (acceptedHash && broadcastFallback) {
    const visible = await waitForTransactionVisible(
      acceptedHash,
      BROADCAST_VERIFY_MS,
      BROADCAST_VERIFY_POLL_MS,
    )
    if (visible) return
    sealWarn('hub:clientBroadcastNotVisible', { hash: acceptedHash })
    await broadcastViaServer(clean, broadcastFallback, 'hub:broadcastViaServerRetry')
    return
  }

  if (acceptedHash) return

  if (broadcastFallback) {
    await broadcastViaServer(clean, broadcastFallback, 'hub:broadcastViaServer')
    return
  }

  throw new Error('Could not broadcast transaction to the Nimiq network.')
}

async function waitForTransactionVisible(
  hash: string,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await transactionKnownOnNetwork(hash)) return true
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  return false
}

/** Must match server default in nimiq-rpc.ts. */
const DEFAULT_ATTESTATION_RECIPIENT = 'NQ815N9JRGBJMLJQNBKEMQ1RD27TXS8PCVKA'

/** Seal fee is sent here; override via VITE_ATTESTATION_RECIPIENT at build time. */
export function getHubAttestationRecipient(): string {
  const configured = import.meta.env.VITE_ATTESTATION_RECIPIENT?.trim()
  if (configured) return configured.replace(/\s+/g, '')
  return DEFAULT_ATTESTATION_RECIPIENT
}

async function buildHubLockCheckoutRequest(
  address: string,
  docId: string,
  finalSha256: string,
): Promise<HubLockCheckoutRequest> {
  // Checkout does not require validityStartHeight (Hub sets it). Keep this async
  // so call sites can warm block height for other Hub paths without blocking.
  void getRecentBlockHeightSync()
  void refreshBlockHeight().catch(() => {})
  return buildLockRequestSync(address, docId, finalSha256)
}

export function isLockHubCommand(command: string, state: Record<string, unknown> | null | undefined): boolean {
  return (
    state?.flow === 'lock' &&
    (command === RequestType.CHECKOUT || command === RequestType.SIGN_TRANSACTION)
  )
}

export async function relaySignedTransaction(
  signed: SignedTransaction,
  broadcastFallback?: TransactionBroadcastFallback,
): Promise<string> {
  const hash = signedTxHash(signed)
  if (await transactionKnownOnNetwork(hash)) {
    sealLog('hub:relaySkipped (already known)', { hash })
    return hash
  }

  const serialized = serializedTxFromSigned(signed)
  sealLog('hub:relaySignedTransaction', { hash })
  reportSealProgress('Broadcasting signed transaction to the Nimiq network…')
  let broadcastAttempted = false
  try {
    await broadcastRawTransaction(serialized, broadcastFallback, { preferServer: true })
    broadcastAttempted = true
  } catch (err) {
    if (await transactionKnownOnNetwork(hash)) {
      sealLog('hub:relayRecovered (broadcast race)', { hash })
      return hash
    }
    throw err
  }
  reportSealProgress('Waiting for transaction to appear on the network…')
  if (await waitForTransactionOnNetwork(hash, RELAY_NETWORK_SOFT_WAIT_MS)) {
    return hash
  }
  if (broadcastAttempted) {
    sealWarn('hub:relayProceedingBeforeVisible', { hash })
    reportSealProgress('Broadcast submitted — confirming on-chain…')
    return hash
  }
  throw new Error('Could not broadcast transaction to the Nimiq network.')
}

export async function finalizeHubLockTransaction(
  signed: SignedTransaction,
  options?: {
    hubBroadcast?: boolean
    broadcastFallback?: TransactionBroadcastFallback
  },
): Promise<string> {
  const hash = signedTxHash(signed)
  if (await transactionKnownOnNetwork(hash)) {
    sealLog('hub:lockTxAlreadyOnNetwork', { hash })
    return hash
  }

  if (options?.hubBroadcast) {
    sealLog('hub:checkoutAwaitNetwork', { hash })
    reportSealProgress('Hub signed your transaction — waiting for network confirmation…')
    if (await waitForTransactionOnNetwork(hash, HUB_CHECKOUT_NETWORK_WAIT_MS)) {
      return hash
    }
    // Hub checkout should broadcast; if RPC still cannot see it, rebroadcast ourselves.
    sealWarn('hub:checkoutNotVisibleYet', { hash })
    reportSealProgress('Rebroadcasting signed transaction…')
    try {
      return await relaySignedTransaction(signed, options?.broadcastFallback)
    } catch (err) {
      sealWarn('hub:checkoutRelayFallbackFailed', err)
      // Still return hash so the server poller can confirm if Hub broadcast was slow.
      reportSealProgress('Transaction submitted — confirming on-chain…')
      return hash
    }
  }

  return relaySignedTransaction(signed, options?.broadcastFallback)
}

const hubRedirectDeps = () => ({
  appName: APP_NAME,
  getHubApi,
  bytesToHex,
  isLockHubCommand,
  finalizeHubLockTransaction,
})

function registerHubEventHandlers(
  hub: HubApi,
  getChallenge: (address: string) => Promise<{ token: string; nonce: string }>,
  onComplete: (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => void,
  onError: (err: Error) => void,
  handleLockComplete: (result: HubLockRedirectResult) => Promise<void>,
  handleLockError: (err: Error) => Promise<void>,
  createBroadcastFallback?: BroadcastFallbackFactory,
  registerLockWork?: (work: Promise<void>) => void,
): void {
  hub.on(RequestType.CHOOSE_ADDRESS, async chosen => {
    try {
      const { address } = chosen as ChooseAddressResult
      const { token, nonce } = await getChallenge(address)
      const behavior = hubRedirectBehavior({ token })
      await hub.signMessage(
        { appName: APP_NAME, message: nonce, signer: address },
        behavior as Parameters<typeof hub.signMessage>[1],
      )
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })
  hub.on(RequestType.SIGN_MESSAGE, (signed, state) => {
    try {
      const token = state?.token as string | undefined
      if (!token) throw new Error('Login session expired — try again.')
      const msg = signed as SignedMessage
      onComplete({
        token,
        address: msg.signer,
        publicKey: bytesToHex(msg.signerPublicKey),
        signature: bytesToHex(msg.signature),
      })
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })
  const handleLockSigned = (
    signed: SignedTransaction,
    state: Record<string, unknown> | null | undefined,
    hubBroadcast: boolean,
    registerLockWork?: (work: Promise<void>) => void,
  ) => {
    try {
      const token = state?.token as string | undefined
      const docId = state?.docId as string | undefined
      if (!token || !docId) throw new Error('Lock session expired — try again.')
      sealLog('hub:lockTxSigned', { docId, hash: signed.hash, hubBroadcast })
      const lockWork = finalizeHubLockTransaction(signed, {
        hubBroadcast,
        broadcastFallback: token ? createBroadcastFallback?.(token, docId) : undefined,
      })
        .then(txHash => handleLockComplete({ token, docId, txHash }))
        .catch(err => handleLockError(err instanceof Error ? err : new Error(String(err))))
      registerLockWork?.(lockWork)
    } catch (err) {
      sealError('hub:lockTxHandlerFailed', err)
      registerLockWork?.(handleLockError(err instanceof Error ? err : new Error(String(err))))
    }
  }

  const handleCreditTopupSigned = (
    signed: SignedTransaction,
    state: Record<string, unknown> | null | undefined,
    hubBroadcast: boolean,
    registerWork?: (work: Promise<void>) => void,
  ) => {
    try {
      const token = state?.token as string | undefined
      if (!token) throw new Error('Credit top-up session expired — try again.')
      sealLog('hub:creditTopupTxSigned', { hash: signed.hash, hubBroadcast })
      const work = finalizeHubLockTransaction(signed, {
        hubBroadcast,
      })
        .then(async txHash => {
          const { claimNimTopupWithRetry } = await import('./creditTopupClaim')
          sealLog('hub:creditTopupClaiming', { txHash })
          const result = await claimNimTopupWithRetry(token, txHash)
          try {
            sessionStorage.removeItem('verilock-credit-topup')
          } catch {
            /* ignore */
          }
          window.dispatchEvent(
            new CustomEvent('verilock:credits-topup', {
              detail: { ok: true, ...result, txHash },
            }),
          )
        })
        .catch(err => {
          const error = err instanceof Error ? err : new Error(String(err))
          sealError('hub:creditTopupClaimFailed', error)
          window.dispatchEvent(
            new CustomEvent('verilock:credits-topup', {
              detail: { ok: false, message: error.message },
            }),
          )
        })
      registerWork?.(work)
    } catch (err) {
      sealError('hub:creditTopupHandlerFailed', err)
      const error = err instanceof Error ? err : new Error(String(err))
      window.dispatchEvent(
        new CustomEvent('verilock:credits-topup', {
          detail: { ok: false, message: error.message },
        }),
      )
    }
  }

  hub.on(RequestType.CHECKOUT, (signed, state) => {
    sealLog('hub:CHECKOUT', { flow: state?.flow, hasToken: Boolean(state?.token), docId: state?.docId })
    if (state?.flow === 'credit_topup') {
      handleCreditTopupSigned(signed as SignedTransaction, state, true, registerLockWork)
      return
    }
    if (state?.flow !== 'lock') return
    handleLockSigned(signed as SignedTransaction, state, true, registerLockWork)
  })

  hub.on(RequestType.SIGN_TRANSACTION, (signed, state) => {
    sealLog('hub:SIGN_TRANSACTION', { flow: state?.flow, hasToken: Boolean(state?.token), docId: state?.docId })
    if (state?.flow === 'credit_topup') {
      handleCreditTopupSigned(signed as SignedTransaction, state, false, registerLockWork)
      return
    }
    if (state?.flow !== 'lock') {
      sealWarn('hub:SIGN_TRANSACTION ignored (not a lock flow)', { flow: state?.flow })
      return
    }
    handleLockSigned(signed as SignedTransaction, state, false, registerLockWork)
  })
}

export type HubRedirectSetupResult = {
  redirectHandled: boolean
  loginHandled: boolean
  lockHandled: boolean
  lockCompletion: Promise<void> | null
}

/** Call on app load to finish Hub redirect login and lock round-trips. */
export async function setupHubRedirectHandlers(
  getChallenge: (address: string) => Promise<{ token: string; nonce: string }>,
  onComplete: (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => void,
  onError: (err: Error) => void,
  onLockComplete?: (result: HubLockRedirectResult) => void,
  onLockError?: (err: Error) => void,
  createBroadcastFallback?: BroadcastFallbackFactory,
): Promise<HubRedirectSetupResult> {
  const hub = getHubApi()
  let lockRedirectHandled = false
  let loginRedirectHandled = false
  let lockCompletion: Promise<void> | null = null

  const registerLockWork = (work: Promise<void>) => {
    lockCompletion = lockCompletion ? lockCompletion.then(() => work) : work
  }

  const handleLoginComplete = (result: {
    address: string
    publicKey: string
    signature: string
    token: string
  }) => {
    loginRedirectHandled = true
    onComplete(result)
  }

  const handleLockComplete = (result: HubLockRedirectResult): Promise<void> => {
    const key = `${result.docId}:${normalizeTxHash(result.txHash)}`
    if (hubLockCompletionInFlight.has(key)) {
      sealWarn('hub:lockCompleteDuplicate', { key })
      return Promise.resolve()
    }
    hubLockCompletionInFlight.add(key)
    lockRedirectHandled = true
    return Promise.resolve(onLockComplete?.(result)).finally(() => {
      hubLockCompletionInFlight.delete(key)
    })
  }

  const handleLockError = (err: Error): Promise<void> => {
    lockRedirectHandled = true
    return Promise.resolve(onLockError?.(err)).then(() => undefined)
  }

  const lenientHandled = processLenientHubRedirect(
    hubRedirectDeps(),
    getChallenge,
    handleLoginComplete,
    onError,
    handleLockComplete,
    handleLockError,
    createBroadcastFallback,
    registerLockWork,
  )

  if (!hubRedirectHandlersReady) {
    hubRedirectHandlersReady = true
    registerHubEventHandlers(
      hub,
      getChallenge,
      handleLoginComplete,
      onError,
      handleLockComplete,
      handleLockError,
      createBroadcastFallback,
      registerLockWork,
    )
  }

  if (lenientHandled) {
    sealLog('hub:lenientRedirectHandled', {
      lockCompletionAsync: Boolean(lockCompletion),
      loginHandled: loginRedirectHandled,
      lockHandled: lockRedirectHandled,
    })
    return {
      redirectHandled: true,
      loginHandled: loginRedirectHandled,
      lockHandled: lockRedirectHandled,
      lockCompletion,
    }
  }

  sealLog('hub:checkRedirectResponse', {
    href: window.location.href,
    referrer: document.referrer || '(empty)',
    rpcId: new URLSearchParams(window.location.search).get(RPC_ID_SEARCH_PARAM),
  })
  await hub.checkRedirectResponse()
  const redirectHandled = loginRedirectHandled || lockRedirectHandled
  sealLog('hub:redirectHandlersReady', { redirectHandled, loginRedirectHandled, lockRedirectHandled })
  return {
    redirectHandled,
    loginHandled: loginRedirectHandled,
    lockHandled: lockRedirectHandled,
    lockCompletion,
  }
}

export async function connectViaHub(
  getChallenge: (address: string) => Promise<{ token: string; nonce: string }>,
  options?: { preferRedirect?: boolean },
): Promise<{
  token: string
  address: string
  publicKey: string
  signature: string
  authScheme: 'hub'
}> {
  const hub = getHubApi()

  const preferRedirect = options?.preferRedirect ?? true
  if (preferRedirect) {
    clearStaleHubRpcStateIfIdle()
    saveHubReturnPath()
    sealLog('hub:redirectChooseAddress', { returnUrl: getHubReturnUrl() })
    const behavior = hubRedirectBehavior({ flow: 'login' })
    await hub.chooseAddress(
      { appName: APP_NAME },
      behavior as Parameters<typeof hub.chooseAddress>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
    clearStaleHubRpcStateIfIdle()
    sealLog('hub:popupChooseAddress')
    const chosen = await hub.chooseAddress({ appName: APP_NAME })
    const address = chosen.address
    const { token, nonce } = await getChallenge(address)
    const signed = await hub.signMessage({
      appName: APP_NAME,
      message: nonce,
      signer: address,
    })
    return {
      token,
      address: signed.signer,
      publicKey: bytesToHex(signed.signerPublicKey),
      signature: bytesToHex(signed.signature),
      authScheme: 'hub',
    }
  } catch (err) {
    if (isPopupBlockedError(err)) {
      throw new Error(popupBlockedHelp())
    }
    throw err
  }
}

export function normalizeMiniAppUrl(appUrl: string): string {
  try {
    const parsed = new URL(appUrl)
    return parsed.origin
  } catch {
    return appUrl.replace(/\/+$/, '')
  }
}

export const NIMIQ_PAY_IOS_URL = 'https://apps.apple.com/us/app/nimiq-pay/id6471844738'
export const NIMIQ_PAY_ANDROID_URL =
  'https://play.google.com/store/apps/details?id=com.nimiq.pay'

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
  // iPadOS 13+ often reports as Macintosh (desktop UA) with multi-touch.
  // Without this, Login skips the mobile sheet and jumps straight to Hub.
  return (
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  )
}

export function getMiniAppWebUrl(appUrl?: string): string {
  return normalizeMiniAppUrl(appUrl ?? window.location.origin)
}

export function nimiqPayDeepLink(appUrl: string): string {
  const target = normalizeMiniAppUrl(appUrl)
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`
}

export type NimiqPayLaunchResult = 'already-in-pay' | 'launched' | 'unavailable'

/** Only attempts nimiqpay:// on mobile — desktop browsers have no registered handler. */
export function launchNimiqPayMiniApp(appUrl?: string): NimiqPayLaunchResult {
  if (isNimiqPayHost()) return 'already-in-pay'
  if (!isMobileDevice()) return 'unavailable'
  window.location.assign(nimiqPayDeepLink(appUrl ?? window.location.origin))
  return 'launched'
}

/** @deprecated Use launchNimiqPayMiniApp — avoids desktop scheme errors */
export function openNimiqPayMiniApp(appUrl?: string): void {
  launchNimiqPayMiniApp(appUrl)
}

export async function copyNimiqPayDeepLink(appUrl?: string): Promise<string> {
  const link = nimiqPayDeepLink(appUrl ?? window.location.origin)
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(link)
  }
  return link
}

/** Nimiq basic transactions allow at most 64 bytes of unstructured data. */
const ATTESTATION_PAYLOAD_VERSION = 1
const ATTESTATION_PAYLOAD_SIZE = 37

function docShortId(docId: string): string {
  return docId.replace(/-/g, '').slice(0, 8).toLowerCase()
}

export function buildAttestationPayloadBytes(docId: string, finalSha256: string): Uint8Array {
  const hash = finalSha256.toLowerCase()
  const shortHex = docShortId(docId)
  if (!/^[a-f0-9]{8}$/.test(shortHex)) {
    throw new Error('Invalid document id for attestation payload')
  }
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new Error('Invalid sha256 for attestation payload')
  }

  const payload = new Uint8Array(ATTESTATION_PAYLOAD_SIZE)
  payload[0] = ATTESTATION_PAYLOAD_VERSION
  for (let i = 0; i < 4; i++) {
    payload[1 + i] = parseInt(shortHex.slice(i * 2, i * 2 + 2), 16)
  }
  for (let i = 0; i < 32; i++) {
    payload[5 + i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16)
  }
  return payload
}

export function buildAttestationPayload(docId: string, finalSha256: string): string {
  return bytesToHex(buildAttestationPayloadBytes(docId, finalSha256))
}

export async function sendLockAttestation(
  nimiq: Awaited<ReturnType<typeof init>>,
  _address: string,
  docId: string,
  finalSha256: string,
) {
  const txHash = await nimiq.sendBasicTransactionWithData({
    recipient: getHubAttestationRecipient(),
    value: getSealFeeLuna(),
    data: buildAttestationPayload(docId, finalSha256.toLowerCase()),
  })
  const txError = getProviderErrorMessage(txHash)
  if (txError) throw new Error(txError)
  return txHash as string
}

/** Credit top-up payload: version=2, kind=1 — must match server creditTopup.ts */
export const TOPUP_PAYLOAD_VERSION = 2
export const TOPUP_PAYLOAD_KIND = 1

export function buildTopupPayloadBytes(): Uint8Array {
  const payload = new Uint8Array(2)
  payload[0] = TOPUP_PAYLOAD_VERSION
  payload[1] = TOPUP_PAYLOAD_KIND
  return payload
}

export function buildTopupPayloadHex(): string {
  return bytesToHex(buildTopupPayloadBytes())
}

async function buildHubCreditTopupCheckoutRequest(address: string, valueLuna: number) {
  void getRecentBlockHeightSync()
  void refreshBlockHeight().catch(() => {})
  return {
    appName: APP_NAME,
    sender: address,
    forceSender: true,
    recipient: getHubAttestationRecipient(),
    value: valueLuna,
    flags: 0,
    extraData: buildTopupPayloadBytes(),
    validityDuration: 120,
  }
}

/** One-click NIM credit purchase via Nimiq Pay. */
export async function sendCreditTopupViaPay(
  nimiq: Awaited<ReturnType<typeof init>>,
  valueLuna: number,
): Promise<string> {
  if (!Number.isFinite(valueLuna) || valueLuna <= 0) {
    throw new Error('Invalid credit top-up amount')
  }
  const txHash = await nimiq.sendBasicTransactionWithData({
    recipient: getHubAttestationRecipient(),
    value: valueLuna,
    data: buildTopupPayloadHex(),
  })
  const txError = getProviderErrorMessage(txHash)
  if (txError) throw new Error(txError)
  return txHash as string
}

/**
 * One-click NIM credit purchase via Nimiq Hub.
 * Uses checkout() so Hub broadcasts (signTransaction alone does not).
 */
export async function sendCreditTopupViaHub(
  address: string,
  valueLuna: number,
  options?: {
    preferRedirect?: boolean
    token?: string
    credits?: number
    broadcastFallback?: TransactionBroadcastFallback
  },
): Promise<string> {
  if (!Number.isFinite(valueLuna) || valueLuna <= 0) {
    throw new Error('Invalid credit top-up amount')
  }
  const hub = getHubApi()
  const request = await buildHubCreditTopupCheckoutRequest(address, valueLuna)

  sealLog('hub:creditTopupCheckoutRequest', {
    recipient: request.recipient,
    value: request.value,
    preferRedirect: options?.preferRedirect ?? false,
  })

  const topupState = {
    flow: 'credit_topup' as const,
    token: options?.token,
    credits: options?.credits,
  }

  const preferRedirect = options?.preferRedirect ?? false
  if (preferRedirect) {
    clearStaleHubRpcStateIfIdle()
    saveHubReturnPath()
    const behavior = hubRedirectBehavior(topupState)
    await hub.checkout(
      request,
      behavior as Parameters<typeof hub.checkout>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
    clearStaleHubRpcStateIfIdle()
    const signed = await hub.checkout(request)
    const txHash = await finalizeHubLockTransaction(signed as SignedTransaction, {
      // Hub checkout already broadcasts to the network.
      hubBroadcast: true,
      broadcastFallback: options?.broadcastFallback,
    })
    sealLog('hub:creditTopupSuccess', { txHash })
    return txHash
  } catch (err) {
    sealError('hub:creditTopupFailed', err)
    if (isPopupBlockedError(err)) {
      throw new Error(popupBlockedHelp())
    }
    throw err
  }
}

/**
 * Seal via Nimiq Hub using checkout() — signs and broadcasts (official path).
 * signTransaction is only kept as a handler for in-flight legacy redirects.
 */
export async function sendLockAttestationViaHub(
  address: string,
  docId: string,
  finalSha256: string,
  options?: {
    preferRedirect?: boolean
    token?: string
    broadcastFallback?: TransactionBroadcastFallback
    /** Prebuilt checkout request to avoid await inside the gesture path. */
    prebuiltRequest?: HubLockCheckoutRequest
    finalSha256?: string
  },
): Promise<string> {
  const hub = getHubApi()
  const request =
    options?.prebuiltRequest ??
    (await buildHubLockCheckoutRequest(address, docId, finalSha256))

  sealLog('hub:checkoutRequest', {
    docId,
    recipient: request.recipient,
    extraDataBytes: request.extraData instanceof Uint8Array ? request.extraData.length : 0,
    value: request.value,
    preferRedirect: options?.preferRedirect ?? false,
  })

  const lockState = {
    flow: 'lock' as const,
    token: options?.token,
    docId,
    finalSha256: options?.finalSha256 ?? finalSha256,
  }

  const preferRedirect = options?.preferRedirect ?? true
  if (preferRedirect) {
    clearStaleHubRpcStateIfIdle()
    saveHubReturnPath()
    const behavior = hubRedirectBehavior(lockState)
    // checkout with RedirectRequestBehavior must stay in the user-gesture stack.
    await hub.checkout(
      request,
      behavior as Parameters<typeof hub.checkout>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
    clearStaleHubRpcStateIfIdle()
    sealLog('hub:popupCheckout', { docId })
    const signed = await hub.checkout(request)
    const txHash = await finalizeHubLockTransaction(signed as SignedTransaction, {
      hubBroadcast: true,
      broadcastFallback: options?.broadcastFallback,
    })
    sealLog('hub:checkoutSuccess', { txHash })
    return txHash
  } catch (err) {
    sealError('hub:checkoutFailed', err)
    if (isPopupBlockedError(err)) {
      throw new Error(popupBlockedHelp())
    }
    throw err
  }
}

export async function canLockViaPay(existingNimiq: unknown = null): Promise<boolean> {
  if (existingNimiq) return true
  if (typeof window !== 'undefined' && window.nimiq) return true
  return probeNimiqPay(isNimiqPayHost() ? 5_000 : 2_000)
}

export function getLocale(): string {
  return getHostLanguage() ?? navigator.language.split('-')[0] ?? 'en'
}