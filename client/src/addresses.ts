export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
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