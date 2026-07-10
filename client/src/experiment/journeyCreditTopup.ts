import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { api } from '../api'
import {
  canLockViaPay,
  ensureNimiqProvider,
  HUB_REDIRECT_MESSAGE,
  isHubRedirectError,
  isMobileDevice,
  isNimiqPayHost,
  isPopupBlockedError,
  sendCreditTopupViaHub,
  sendCreditTopupViaPay,
} from '../nimiq'
import { claimNimTopupWithRetry } from '../creditTopupClaim'
import { formatSealFeeNim } from '../sealPricing'
import { saveSession } from '../session'

export { claimNimTopupWithRetry }

export type CreditTopupResult =
  | { ok: true; balance: number; creditsMinted: number; alreadyClaimed: boolean }
  | { ok: false; redirecting: true; message: string }
  | { ok: false; redirecting: false; message: string }

/**
 * One-click buy credits with NIM (Pay or Hub), then claim on the server.
 */
export async function buyCreditsWithNim(args: {
  token: string
  address: string
  credits: number
  nimiq: NimiqProvider | null
  setNimiq: (p: NimiqProvider | null) => void
  onProgress: (message: string | null) => void
}): Promise<CreditTopupResult> {
  const { token, address, credits, setNimiq, onProgress } = args
  const qty = Math.floor(credits)
  if (!Number.isFinite(qty) || qty < 1) {
    return { ok: false, redirecting: false, message: 'Choose at least 1 credit' }
  }

  try {
    onProgress('Loading top-up details…')
    const info = await api.creditsTopupInfo()
    if (!info.recipient) {
      return { ok: false, redirecting: false, message: 'Credit sink address is not configured' }
    }
    const valueLuna = info.feeLuna * qty
    if (!Number.isFinite(valueLuna) || valueLuna <= 0) {
      return { ok: false, redirecting: false, message: 'Invalid seal fee for top-up' }
    }

    const feeLabel = formatSealFeeNim(info.feeNim * qty)

    let usePay = isNimiqPayHost() || Boolean(typeof window !== 'undefined' && window.nimiq)
    if (!usePay) {
      usePay = await canLockViaPay(args.nimiq)
    }

    let txHash: string

    if (usePay) {
      const provider = await ensureNimiqProvider(args.nimiq)
      setNimiq(provider)
      onProgress(`Confirm ${feeLabel} NIM for ${qty} credit${qty === 1 ? '' : 's'} in Nimiq Pay…`)
      txHash = await sendCreditTopupViaPay(provider, valueLuna)
    } else {
      // Desktop: Hub popup (no redirect recovery needed). Mobile: redirect.
      const preferRedirect = isMobileDevice() || isMobilePreferRedirect()

      if (preferRedirect) {
        saveSession({ token, address })
        // Persist claim intent for Hub redirect return
        try {
          sessionStorage.setItem(
            'verilock-credit-topup',
            JSON.stringify({ token, address, credits: qty, at: Date.now() }),
          )
        } catch {
          /* ignore */
        }
        onProgress('Redirecting to Nimiq Hub to buy credits…')
        try {
          await sendCreditTopupViaHub(address, valueLuna, {
            preferRedirect: true,
            token,
            credits: qty,
          })
        } catch (err) {
          if (isHubRedirectError(err) || (err instanceof Error && err.message === HUB_REDIRECT_MESSAGE)) {
            return { ok: false, redirecting: true, message: HUB_REDIRECT_MESSAGE }
          }
          throw err
        }
        return { ok: false, redirecting: true, message: HUB_REDIRECT_MESSAGE }
      }

      onProgress(`Confirm ${feeLabel} NIM for ${qty} credit${qty === 1 ? '' : 's'} in Nimiq Hub…`)
      try {
        txHash = await sendCreditTopupViaHub(address, valueLuna, {
          preferRedirect: false,
          token,
          credits: qty,
        })
      } catch (err) {
        if (isPopupBlockedError(err)) {
          saveSession({ token, address })
          try {
            sessionStorage.setItem(
              'verilock-credit-topup',
              JSON.stringify({ token, address, credits: qty, at: Date.now() }),
            )
          } catch {
            /* ignore */
          }
          onProgress('Pop-up blocked — redirecting to Nimiq Hub…')
          try {
            await sendCreditTopupViaHub(address, valueLuna, {
              preferRedirect: true,
              token,
              credits: qty,
            })
          } catch (err2) {
            if (
              isHubRedirectError(err2) ||
              (err2 instanceof Error && err2.message === HUB_REDIRECT_MESSAGE)
            ) {
              return { ok: false, redirecting: true, message: HUB_REDIRECT_MESSAGE }
            }
            throw err2
          }
          return { ok: false, redirecting: true, message: HUB_REDIRECT_MESSAGE }
        }
        throw err
      }
    }

    onProgress('Claiming credits…')
    const claimed = await claimNimTopupWithRetry(token, txHash, msg => onProgress(msg))
    onProgress(null)
    return {
      ok: true,
      balance: claimed.balance,
      creditsMinted: claimed.creditsMinted,
      alreadyClaimed: claimed.alreadyClaimed,
    }
  } catch (err) {
    if (isHubRedirectError(err) || (err instanceof Error && err.message === HUB_REDIRECT_MESSAGE)) {
      return { ok: false, redirecting: true, message: HUB_REDIRECT_MESSAGE }
    }
    return {
      ok: false,
      redirecting: false,
      message: err instanceof Error ? err.message : 'NIM credit purchase failed',
    }
  }
}

function isMobilePreferRedirect(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}
