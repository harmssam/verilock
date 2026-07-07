const SEAL_IN_FLIGHT_KEY = 'verilock-seal-in-flight'
const LEGACY_SEAL_IN_FLIGHT_KEY = 'nimiq-seal-seal-in-flight'
/** @deprecated migrated on read — remove after a few releases */
const LEGACY_PENDING_SEAL_KEY = 'nimiq-seal-pending-seal'
/** @deprecated migrated on read — remove after a few releases */
const LEGACY_SEAL_REDIRECT_KEY = 'nimiq-seal-seal-redirect'
const LEGACY_SESSION_KEY = 'nimiq-seal-session'

export const SEAL_IN_FLIGHT_TTL_MS = 60 * 60 * 1000
export const HUB_REFERRER_HOST = 'hub.nimiq.com'
export const RPC_ID_SEARCH_PARAM = 'rpcId'

export interface SealInFlight {
  slug: string
  docId: string
  token: string
  address: string
  startedAt: number
  finalSha256?: string
}

function readStorage(store: Storage, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value)
  } catch {
    // ignore
  }
}

function removeStorage(store: Storage, key: string): void {
  try {
    store.removeItem(key)
  } catch {
    // ignore
  }
}

function readLegacySession(): { token?: string; address?: string } | null {
  const sessionRaw =
    readStorage(sessionStorage, 'verilock-session') ?? readStorage(sessionStorage, LEGACY_SESSION_KEY)
  if (!sessionRaw) return null
  try {
    return JSON.parse(sessionRaw) as { token?: string; address?: string }
  } catch {
    return null
  }
}

function migrateLegacySealRecovery(): SealInFlight | null {
  const redirectRaw = readStorage(localStorage, LEGACY_SEAL_REDIRECT_KEY)
  if (redirectRaw) {
    try {
      const parsed = JSON.parse(redirectRaw) as {
        slug?: string
        docId?: string
        token?: string
        savedAt?: number
      }
      removeStorage(localStorage, LEGACY_SEAL_REDIRECT_KEY)
      removeStorage(sessionStorage, LEGACY_PENDING_SEAL_KEY)
      if (parsed.slug && parsed.docId && parsed.token) {
        const session = readLegacySession()
        return {
          slug: parsed.slug,
          docId: parsed.docId,
          token: parsed.token,
          address: session?.address ?? '',
          startedAt: parsed.savedAt ?? Date.now(),
        }
      }
    } catch {
      removeStorage(localStorage, LEGACY_SEAL_REDIRECT_KEY)
    }
  }

  const pendingRaw = readStorage(sessionStorage, LEGACY_PENDING_SEAL_KEY)
  if (!pendingRaw) return null
  try {
    const parsed = JSON.parse(pendingRaw) as { slug?: string; docId?: string; savedAt?: number }
    removeStorage(sessionStorage, LEGACY_PENDING_SEAL_KEY)
    if (!parsed.slug || !parsed.docId) return null
    const session = readLegacySession()
    if (!session?.token) return null
    return {
      slug: parsed.slug,
      docId: parsed.docId,
      token: session.token,
      address: session.address ?? '',
      startedAt: parsed.savedAt ?? Date.now(),
    }
  } catch {
    removeStorage(sessionStorage, LEGACY_PENDING_SEAL_KEY)
    return null
  }
}

export function saveSealInFlight(seal: Omit<SealInFlight, 'startedAt'>): void {
  writeStorage(
    localStorage,
    SEAL_IN_FLIGHT_KEY,
    JSON.stringify({ ...seal, startedAt: Date.now() } satisfies SealInFlight),
  )
  removeStorage(localStorage, LEGACY_SEAL_IN_FLIGHT_KEY)
}

export function clearSealInFlight(): void {
  removeStorage(localStorage, SEAL_IN_FLIGHT_KEY)
  removeStorage(localStorage, LEGACY_SEAL_IN_FLIGHT_KEY)
}

export function loadSealInFlight(): SealInFlight | null {
  const raw =
    readStorage(localStorage, SEAL_IN_FLIGHT_KEY) ??
    readStorage(localStorage, LEGACY_SEAL_IN_FLIGHT_KEY)
  if (!raw) return migrateLegacySealRecovery()

  try {
    const parsed = JSON.parse(raw) as SealInFlight
    if (!parsed.slug || !parsed.docId || !parsed.token) {
      clearSealInFlight()
      return null
    }
    if (Date.now() - parsed.startedAt > SEAL_IN_FLIGHT_TTL_MS) {
      clearSealInFlight()
      return null
    }
    if (readStorage(localStorage, SEAL_IN_FLIGHT_KEY) === null) {
      saveSealInFlight(parsed)
    }
    return parsed
  } catch {
    clearSealInFlight()
    return null
  }
}

export function pruneExpiredSealInFlight(): void {
  loadSealInFlight()
}

/** True when the URL still contains an unprocessed Hub redirect response in the hash. */
export function peekHubRedirectInUrl(): boolean {
  if (typeof window === 'undefined') return false
  const url = new URL(window.location.href)
  const fragment = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash)
  return fragment.has('id') && fragment.has('status') && fragment.has('result')
}

export function hasHubReturnSignal(): boolean {
  if (typeof window === 'undefined') return false
  if (peekHubRedirectInUrl()) return true
  if (new URLSearchParams(window.location.search).has(RPC_ID_SEARCH_PARAM)) return true
  // Referrer intentionally omitted (unreliable per Hub integration review).
  // Primary signals are the redirect hash/?rpcId and persisted seal-in-flight.
  return false
}

/** Hub actually sent the user back and we have (or had) an in-flight seal to finish. */
export function shouldResumeHubSeal(): boolean {
  return hasHubReturnSignal() && loadSealInFlight() !== null
}

export function staleSealMessage(docStatus: string): string {
  return docStatus === 'locking'
    ? 'Seal was interrupted in Hub. Your signatures are still saved — tap Retry seal to continue.'
    : 'Previous Hub redirect did not finish. Your signatures are still saved — tap Seal via Hub to try again.'
}

/** Returns false in private mode, storage blocked, or quota issues (common on iOS Safari PWA/WebView). */
export function canUsePersistentStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const k = '__verilock_test__'
    localStorage.setItem(k, '1')
    localStorage.removeItem(k)
    sessionStorage.setItem(k, '1')
    sessionStorage.removeItem(k)
    return true
  } catch {
    return false
  }
}