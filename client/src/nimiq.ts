import HubApi from '@nimiq/hub-api'
import type { ChooseAddressResult, SignedMessage, SignedTransaction } from '@nimiq/hub-api'

const { RedirectRequestBehavior, RequestType } = HubApi
import { getHostLanguage, init } from '@nimiq/mini-app-sdk'
import {
  processLenientHubRedirect,
  type HubLockRedirectResult,
} from './hubSealRedirect'
import { saveHubReturnPath } from './hubReturnPath'
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
  const signatureResult = await nimiq.sign(nonce)
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

export const HUB_REDIRECT_MESSAGE = 'Redirecting to Nimiq Hub…'

export function isHubRedirectError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return message === HUB_REDIRECT_MESSAGE
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
export type BroadcastFallbackFactory = (token: string) => TransactionBroadcastFallback

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

async function buildHubLockSignRequest(address: string, docId: string, finalSha256: string) {
  const blockNumber = await nimiqRpcCall<number>('getBlockNumber', [])
  const recipient = getHubAttestationRecipient()
  return {
    appName: APP_NAME,
    sender: address,
    recipient,
    value: getSealFeeLuna(),
    flags: 0,
    extraData: buildAttestationPayloadBytes(docId, finalSha256.toLowerCase()),
    validityStartHeight: blockNumber,
  }
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
    sealWarn('hub:checkoutProceedingBeforeVisible', { hash })
    reportSealProgress('Transaction submitted — confirming on-chain…')
    return hash
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
      const behavior = RedirectRequestBehavior.withLocalState({ token })
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
        broadcastFallback: token ? createBroadcastFallback?.(token) : undefined,
      })
        .then(txHash => handleLockComplete({ token, docId, txHash }))
        .catch(err => handleLockError(err instanceof Error ? err : new Error(String(err))))
      registerLockWork?.(lockWork)
    } catch (err) {
      sealError('hub:lockTxHandlerFailed', err)
      registerLockWork?.(handleLockError(err instanceof Error ? err : new Error(String(err))))
    }
  }

  hub.on(RequestType.CHECKOUT, (signed, state) => {
    sealLog('hub:CHECKOUT', { flow: state?.flow, hasToken: Boolean(state?.token), docId: state?.docId })
    if (state?.flow !== 'lock') return
    handleLockSigned(signed as SignedTransaction, state, true, registerLockWork)
  })

  hub.on(RequestType.SIGN_TRANSACTION, (signed, state) => {
    sealLog('hub:SIGN_TRANSACTION', { flow: state?.flow, hasToken: Boolean(state?.token), docId: state?.docId })
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

  if (options?.preferRedirect) {
    saveHubReturnPath()
    const behavior = RedirectRequestBehavior.withLocalState({ flow: 'login' })
    await hub.chooseAddress(
      { appName: APP_NAME },
      behavior as Parameters<typeof hub.chooseAddress>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
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
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
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

export async function sendLockAttestationViaHub(
  address: string,
  docId: string,
  finalSha256: string,
  options?: {
    preferRedirect?: boolean
    token?: string
    broadcastFallback?: TransactionBroadcastFallback
  },
): Promise<string> {
  const hub = getHubApi()
  const request = await buildHubLockSignRequest(address, docId, finalSha256)

  sealLog('hub:signTransactionRequest', {
    docId,
    recipient: request.recipient,
    extraDataBytes: request.extraData.length,
    value: request.value,
    validityStartHeight: request.validityStartHeight,
    preferRedirect: options?.preferRedirect ?? false,
  })

  const lockState = {
    flow: 'lock' as const,
    token: options?.token,
    docId,
  }

  if (options?.preferRedirect) {
    saveHubReturnPath()
    const behavior = RedirectRequestBehavior.withLocalState(lockState)
    await hub.signTransaction(
      request,
      behavior as Parameters<typeof hub.signTransaction>[1],
    )
    throw new Error(HUB_REDIRECT_MESSAGE)
  }

  try {
    const signed = await hub.signTransaction(request)
    const txHash = await finalizeHubLockTransaction(signed as SignedTransaction, {
      hubBroadcast: false,
      broadcastFallback: options?.broadcastFallback,
    })
    sealLog('hub:signTransactionSuccess', { txHash })
    return txHash
  } catch (err) {
    sealError('hub:signTransactionFailed', err)
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