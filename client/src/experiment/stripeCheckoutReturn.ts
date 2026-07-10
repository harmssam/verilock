import { api } from '../api'
import { writeCreditsBalanceCache } from '../creditsBalanceCache'

/**
 * Stripe Checkout success_url is `/?credits=success&session_id=cs_...`.
 * Credits used to mint only via webhook — if the webhook missed, balance stayed 0.
 * This claims the session on return (same idea as NIM top-up claim).
 */
export function peekStripeCheckoutReturn(): {
  status: 'success' | 'cancel' | null
  sessionId: string | null
} {
  if (typeof window === 'undefined') return { status: null, sessionId: null }
  const params = new URLSearchParams(window.location.search)
  const credits = params.get('credits')
  if (credits === 'success') {
    return { status: 'success', sessionId: params.get('session_id') }
  }
  if (credits === 'cancel') {
    return { status: 'cancel', sessionId: null }
  }
  return { status: null, sessionId: null }
}

export function clearStripeCheckoutReturnFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('credits') && !url.searchParams.has('session_id')) return
  url.searchParams.delete('credits')
  url.searchParams.delete('session_id')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState({}, '', next || '/')
}

/**
 * Confirm a paid Checkout Session and notify the balance UI.
 * Retries briefly while payment_status may still be settling.
 */
export async function fulfillStripeCheckoutReturn(
  token: string,
  sessionId: string,
): Promise<{
  ok: boolean
  balance?: number
  creditsMinted?: number
  alreadyClaimed?: boolean
  message: string
}> {
  const maxAttempts = 6
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise(r => setTimeout(r, 1_500))
      }
      const result = await api.confirmCreditsCheckout(token, sessionId)
      if (!result.paid) {
        lastError = new Error('Payment not completed yet')
        continue
      }
      writeCreditsBalanceCache(token, result.balance)
      window.dispatchEvent(
        new CustomEvent('verilock:credits-topup', {
          detail: {
            ok: true,
            balance: result.balance,
            creditsMinted: result.creditsMinted,
          },
        }),
      )
      const message = result.alreadyClaimed
        ? 'Card payment already applied'
        : result.creditsMinted > 0
          ? `+${result.creditsMinted} credit${result.creditsMinted === 1 ? '' : 's'} added`
          : 'Card payment confirmed'
      return {
        ok: true,
        balance: result.balance,
        creditsMinted: result.creditsMinted,
        alreadyClaimed: result.alreadyClaimed,
        message,
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const retryable = /not completed|pending|try again|retry/i.test(lastError.message)
      if (!retryable) break
    }
  }

  return {
    ok: false,
    message: lastError?.message ?? 'Could not confirm card payment',
  }
}
