/** Nimiq Watch expects the hash directly in the fragment, e.g. nimiq.watch/#ABCD… */
export function buildNimiqExplorerUrl(txHash: string): string {
  const clean = txHash.replace(/^0x/i, '').toUpperCase()
  return `https://nimiq.watch/#${clean}`
}