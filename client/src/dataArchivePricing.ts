/**
 * Credits for multi-tx on-chain data archive (signatures, initials, text).
 * Keep in sync with server `creditsForStreamTxCount` / FRAMES_PER_DATA_ARCHIVE_CREDIT.
 *
 * Rule: 1 credit per 10 Nimiq txs, rounded up.
 * Examples: 10 → 1, 11 → 2, 51 → 6 (ceil(5.1)).
 */
export const FRAMES_PER_DATA_ARCHIVE_CREDIT = 10

export function creditsForStreamTxCount(txCount: number): number {
  const n = Math.floor(Number(txCount))
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.ceil(n / FRAMES_PER_DATA_ARCHIVE_CREDIT)
}

export function formatDataArchiveCredits(credits: number): string {
  const n = Math.max(0, Math.floor(credits))
  return n === 1 ? '1 credit' : `${n} credits`
}
