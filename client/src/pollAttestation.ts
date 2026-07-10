import { api } from './api'
import type { AttestationStatus } from './types'

const DEFAULT_INTERVAL_MS = 3_000
/** Align with server poller window (see attestations.ts POLL_TIMEOUT_MS). */
const DEFAULT_TIMEOUT_MS = 180_000

export interface PollAttestationOptions {
  token: string
  txHash: string
  intervalMs?: number
  timeoutMs?: number
  onStatus?: (status: AttestationStatus) => void
}

export async function pollAttestation({
  token,
  txHash,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  onStatus,
}: PollAttestationOptions): Promise<AttestationStatus> {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    let status: Awaited<ReturnType<typeof api.attestationStatus>>
    try {
      status = await api.attestationStatus(token, txHash)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('404') || message.toLowerCase().includes('not found')) {
        throw new Error(
          'Seal proof was not registered on the server. Return to the document and tap Retry seal.',
        )
      }
      throw err
    }
    onStatus?.(status)

    if (status.status === 'confirmed') return status
    if (status.status === 'failed') {
      throw new Error(status.error ?? 'Attestation failed on-chain')
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }

  throw new Error('Attestation confirmation timed out. Check status later.')
}