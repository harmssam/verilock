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