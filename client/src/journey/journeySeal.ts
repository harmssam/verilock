import { api } from '../api'
import { pollAttestation } from '../pollAttestation'
import type { SealDocument } from '../types'

export type SealJourneyResult =
  | { ok: true; document: SealDocument }
  | { ok: false; redirecting: true; message: string }
  | { ok: false; redirecting: false; message: string }

/**
 * Lock using 1 prepaid credit — server posts the on-chain proof (no user NIM tx).
 */
export async function sealJourneyDocumentWithCredit(args: {
  token: string
  doc: SealDocument
  onProgress: (message: string | null) => void
}): Promise<SealJourneyResult> {
  const { token, doc, onProgress } = args
  const finalHash = doc.finalSha256 ?? doc.originalSha256

  try {
    onProgress('Reserving 1 credit - you can leave this page anytime…')
    const result = await api.payWithCredit(token, doc.id, finalHash)

    if (result.status === 'failed') {
      return {
        ok: false,
        redirecting: false,
        message: result.error ?? 'Credit lock failed',
      }
    }

    if (result.status === 'pending') {
      onProgress('Proof submitted - waiting for Nimiq to confirm…')
      await pollAttestation({
        token,
        txHash: result.txHash,
        onStatus: s => {
          onProgress?.(
            s.status === 'pending'
              ? 'Confirming on Nimiq - safe to close this tab…'
              : 'Confirmed on Nimiq!',
          )
        },
      })
    }

    if (typeof result.balance === 'number') {
      try {
        const { writeCreditsBalanceCache } = await import('../creditsBalanceCache')
        writeCreditsBalanceCache(token, result.balance)
        window.dispatchEvent(
          new CustomEvent('verilock:credits-topup', {
            detail: { ok: true, balance: result.balance, creditsMinted: 0 },
          }),
        )
      } catch {
        /* ignore */
      }
    }

    // Authenticated read: lock completes as creator - unlock participant details.
    const { document } = await api.getDocument(doc.id, token)
    onProgress('Locked forever on Nimiq (1 credit).')
    return { ok: true, document }
  } catch (err) {
    return {
      ok: false,
      redirecting: false,
      message: err instanceof Error ? err.message : 'Credit lock failed',
    }
  }
}
