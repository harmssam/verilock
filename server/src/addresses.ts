export function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

export function shortAddress(address: string): string {
  const clean = normalizeAddress(address)
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`
}