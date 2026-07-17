export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

/**
 * Lightweight Nimiq basic-address shape check (NQ + 34 alphanumerics).
 * Does not verify checksum — enough to reject typos at construction time.
 */
export function isValidNimiqAddress(address: string | null | undefined): boolean {
  if (address == null || !String(address).trim()) return false
  const clean = normalizeAddress(address)
  return /^NQ[0-9A-Z]{34}$/.test(clean)
}

export function shortAddress(address: string): string {
  const clean = normalizeAddress(address)
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}

/** Nimiq-style display: groups of four characters (e.g. NQ84 DT0K U4SC …). */
export function formatDisplayAddress(address: string): string {
  const clean = normalizeAddress(address)
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean
}