const SESSION_KEY = 'nimiq-seal-session'

export interface StoredSession {
  token: string
  address: string
}

export function saveSession(session: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // sessionStorage may be unavailable in some WebViews
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (!parsed.token || !parsed.address) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}