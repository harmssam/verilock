import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { api } from '../api'
import {
  buildLockRequestSync,
  canLockViaPay,
  ensureNimiqProvider,
  HUB_REDIRECT_MESSAGE,
  isHubCancelError,
  isHubRedirectError,
  isNimiqPayHost,
  isPopupBlockedError,
  sendLockAttestation,
  sendLockAttestationViaHub,
  setSealProgressReporter,
  shouldUseHubRedirect,
  type BroadcastFallbackFactory,
} from '../nimiq'
import { pollAttestation } from '../pollAttestation'
import { markSealRedirectStarted } from '../sealFlow'
import { evaluateSealFunds, insufficientSealFundsMessage } from '../sealFunds'
import { formatSealFeeSummary, getSealPricing } from '../sealPricing'
import { clearSealInFlight, loadSealInFlight } from '../sealRecovery'
import { saveSession } from '../session'
import type { SealDocument } from '../types'

export const createServerBroadcastFallback: BroadcastFallbackFactory = (
  sessionToken,
  docId,
) => {
  return async serializedTx => {
    await api.broadcastTransaction(sessionToken, docId, serializedTx)
  }
}

export interface SealProgress {
  message: string | null
  error: string | null
}

export async function finishJourneyLock(
  docId: string,
  txHash: string,
  sessionToken: string,
  onProgress?: (message: string) => void,
): Promise<SealDocument> {
  onProgress?.('Submitting on-chain proof…')
  await api.submitAttestation(sessionToken, docId, txHash)
  onProgress?.('Waiting for block confirmation…')
  await pollAttestation({
    token: sessionToken,
    txHash,
    onStatus: s => {
      onProgress?.(s.status === 'pending' ? 'Confirming on-chain…' : 'Confirmed!')
    },
  })
  const { document } = await api.getDocument(docId)
  clearSealInFlight()
  onProgress?.('Agreement locked on the Nimiq blockchain.')
  return document
}

export type SealJourneyResult =
  | { ok: true; document: SealDocument }
  | { ok: false; redirecting: true; message: string }
  | { ok: false; redirecting: false; message: string }

/**
 * Seal using 1 prepaid credit — server posts the on-chain proof (no NIM required).
 */
export async function sealJourneyDocumentWithCredit(args: {
  token: string
  doc: SealDocument
  onProgress: (message: string | null) => void
}): Promise<SealJourneyResult> {
  const { token, doc, onProgress } = args
  const finalHash = doc.finalSha256 ?? doc.originalSha256

  try {
    onProgress('Reserving credit and posting on-chain proof…')
    const result = await api.payWithCredit(token, doc.id, finalHash)

    if (result.status === 'failed') {
      return {
        ok: false,
        redirecting: false,
        message: result.error ?? 'Credit seal failed',
      }
    }

    if (result.status === 'pending') {
      onProgress('Waiting for block confirmation…')
      await pollAttestation({
        token,
        txHash: result.txHash,
        onStatus: s => {
          onProgress?.(s.status === 'pending' ? 'Confirming on-chain…' : 'Confirmed!')
        },
      })
    }

    if (typeof result.balance === 'number') {
      try {
        window.dispatchEvent(
          new CustomEvent('verilock:credits-topup', {
            detail: { ok: true, balance: result.balance, creditsMinted: 0 },
          }),
        )
      } catch {
        /* ignore */
      }
    }

    const { document } = await api.getDocument(doc.id)
    clearSealInFlight()
    onProgress('Agreement locked on the Nimiq blockchain (1 credit).')
    return { ok: true, document }
  } catch (err) {
    return {
      ok: false,
      redirecting: false,
      message: err instanceof Error ? err.message : 'Credit seal failed',
    }
  }
}

/**
 * Seal a ready document using the same Pay / Hub paths as production App.
 */
export async function sealJourneyDocument(args: {
  token: string
  address: string
  doc: SealDocument
  nimiq: NimiqProvider | null
  setNimiq: (p: NimiqProvider | null) => void
  onProgress: (message: string | null) => void
}): Promise<SealJourneyResult> {
  const { token, address, doc, setNimiq, onProgress } = args
  const finalHash = doc.finalSha256 ?? doc.originalSha256

  try {
    const balance = await api.walletBalance(token)
    if (!balance.sufficient) {
      const message = insufficientSealFundsMessage(evaluateSealFunds(balance.balanceLuna))
      return { ok: false, redirecting: false, message }
    }
  } catch (err) {
    return {
      ok: false,
      redirecting: false,
      message: err instanceof Error ? err.message : 'Could not verify wallet balance',
    }
  }

  setSealProgressReporter(message => onProgress(message))

  try {
    await api.prepareLock(token, doc.id, finalHash)

    let usePay =
      isNimiqPayHost() || Boolean(typeof window !== 'undefined' && window.nimiq)
    if (!usePay) {
      usePay = await canLockViaPay(args.nimiq)
    }

    let txHash: string

    if (usePay) {
      const provider = await ensureNimiqProvider(args.nimiq)
      setNimiq(provider)
      const feeSummary = formatSealFeeSummary(getSealPricing())
      onProgress(`Confirm the ${feeSummary} seal transaction in Nimiq Pay…`)
      txHash = await sendLockAttestation(provider, address, doc.id, finalHash)
    } else {
      const preferRedirect = shouldUseHubRedirect()
      if (preferRedirect) {
        saveSession({ token, address })
        markSealRedirectStarted({
          slug: doc.slug,
          docId: doc.id,
          token,
          address,
          finalSha256: finalHash,
        })
      }
      const feeSummary = formatSealFeeSummary(getSealPricing())
      onProgress(
        preferRedirect
          ? HUB_REDIRECT_MESSAGE
          : `Hub popup - confirm the ${feeSummary} seal transaction.`,
      )
      const prebuilt = buildLockRequestSync(address, doc.id, finalHash)
      txHash = await sendLockAttestationViaHub(address, doc.id, finalHash, {
        preferRedirect,
        token,
        broadcastFallback: createServerBroadcastFallback(token, doc.id),
        prebuiltRequest: prebuilt,
        finalSha256: finalHash,
      })
    }

    onProgress('Submitting on-chain proof…')
    await api.beginLock(token, doc.id)
    const document = await finishJourneyLock(doc.id, txHash, token, onProgress)
    return { ok: true, document }
  } catch (err) {
    if (isHubRedirectError(err)) {
      return { ok: false, redirecting: true, message: HUB_REDIRECT_MESSAGE }
    }
    if (isHubCancelError(err)) {
      return {
        ok: false,
        redirecting: false,
        message: 'Cancelled in Hub. Tap Seal to try again.',
      }
    }
    if (isPopupBlockedError(err)) {
      return {
        ok: false,
        redirecting: false,
        message:
          err instanceof Error
            ? err.message
            : 'Popup blocked - try again or open in Nimiq Pay.',
      }
    }
    return {
      ok: false,
      redirecting: false,
      message: err instanceof Error ? err.message : 'Seal failed',
    }
  } finally {
    setSealProgressReporter(null)
  }
}

export function restoreSealInFlightDocId(): string | null {
  return loadSealInFlight()?.docId ?? null
}
