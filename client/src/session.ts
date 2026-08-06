const SESSION_KEY = 'verilock-session'
const LEGACY_SESSION_KEY = 'nimiq-seal-session'

export interface StoredSession {
  token: string
  address: string
}

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
  } catch {
    // sessionStorage may be unavailable in some WebViews
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(LEGACY_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed.token || !parsed.address) return null
    if (!sessionStorage.getItem(SESSION_KEY)) {
      saveSession(parsed)
    }
    return parsed
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
    sessionStorage.removeItem(LEGACY_SESSION_KEY)
  } catch {
    // ignore
  }
}

/**
 * Guest sessions use `localStorage`, not `sessionStorage` like the wallet session above.
 * This is intentional, not an inconsistency: a wallet session always has a recovery path
 * (reconnect the wallet), so losing it on tab close is fine. A guest has no such
 * fallback - losing a tab mid multi-day flow (create -> wait on co-signers -> claim) must
 * not mean losing the session (`docs/guest-signing-plan.md` locked decision #6).
 */
const GUEST_SESSION_KEY = 'verilock-guest-session'

export interface StoredGuestSession {
  token: string
  documentId: string
  partyId: string | null
  role: 'creator' | 'signer'
}

export function saveGuestSession(session: StoredGuestSession): void {
  try {
    localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(session))
  } catch {
    // localStorage may be unavailable in some WebViews
  }
}

export function loadGuestSession(): StoredGuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredGuestSession
    if (!parsed.token || !parsed.documentId || !parsed.role) return null
    return parsed
  } catch {
    return null
  }
}

export function clearGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_SESSION_KEY)
  } catch {
    // ignore
  }
}