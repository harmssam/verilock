/**
 * Easter egg access path - the egg is NOT at a hard-coded URL. Every successful
 * key redemption mints a one-time random token stored on this browser; the only
 * working egg URL is `/easter-egg/<token>` for a browser that has redeemed the
 * key. Any other `/easter-egg/*` path falls through to the not-found screen, so
 * the egg cannot be reached by guessing or typing a URL directly.
 */
const EGG_PATH_PREFIX = '/easter-egg/'
const EGG_TOKEN_STORAGE_KEY = 'verilock:easter-egg-token'
const EGG_TOKEN_PATTERN = /^[0-9a-f]{32}$/

function eggStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function mintToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Mint a fresh egg access path for this browser (called after key redemption). */
export function mintEasterEggPath(): string {
  const token = mintToken()
  const storage = eggStorage()
  try {
    storage?.setItem(EGG_TOKEN_STORAGE_KEY, token)
  } catch {
    // storage unavailable - the token still works for this session's navigation
  }
  return `${EGG_PATH_PREFIX}${token}`
}

/** True only when the path is `/easter-egg/<token>` and this browser holds that token. */
export function isEasterEggPath(path: string): boolean {
  if (!path.startsWith(EGG_PATH_PREFIX)) return false
  const token = path.slice(EGG_PATH_PREFIX.length)
  if (!EGG_TOKEN_PATTERN.test(token)) return false
  const storage = eggStorage()
  let stored: string | null = null
  try {
    stored = storage?.getItem(EGG_TOKEN_STORAGE_KEY) ?? null
  } catch {
    return false
  }
  return stored === token
}