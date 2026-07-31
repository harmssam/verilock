export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export function shortAddress(address: string): string {
  const clean = normalizeAddress(address)
  // e.g. NQ23…JGT6 (4 + ellipsis + 4)
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`
}