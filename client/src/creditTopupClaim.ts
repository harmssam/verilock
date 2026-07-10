import { api } from './api'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Claim top-up after confirmations appear (poll on "pending" / not found). */
export async function claimNimTopupWithRetry(
  token: string,
  txHash: string,
  onProgress?: (message: string) => void,
): Promise<{ balance: number; creditsMinted: number; alreadyClaimed: boolean }> {
  const maxAttempts = 24
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        onProgress?.(`Waiting for confirmations… (${attempt + 1}/${maxAttempts})`)
      }
      return await api.claimNimTopup(token, txHash)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      lastError = err instanceof Error ? err : new Error(message)
      const retryable =
        /pending|not found|confirmations|retry shortly|few seconds/i.test(message)
      if (!retryable) throw lastError
      await sleep(2_500)
    }
  }
  throw lastError ?? new Error('Could not claim credit top-up')
}
