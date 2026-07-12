import type { PathRole } from './types'

const INTENT_KEY = 'verilock-journey-intent'

export function saveJourneyIntent(role: PathRole): void {
  try {
    sessionStorage.setItem(INTENT_KEY, role)
  } catch {
    /* private mode */
  }
}

export function readJourneyIntent(): PathRole | null {
  try {
    const v = sessionStorage.getItem(INTENT_KEY)
    if (v === 'creator' || v === 'signer' || v === 'verifier') return v
  } catch {
    /* ignore */
  }
  return null
}

export function clearJourneyIntent(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY)
  } catch {
    /* ignore */
  }
}

function isHomePath(pathname: string): boolean {
  return pathname === '/' || pathname === ''
}

function isDeepLinkPath(pathname: string): boolean {
  return pathname.startsWith('/d/') || pathname.startsWith('/v/')
}

/** Put intent in the URL so Hub redirect returns to the same path. */
export function syncIntentToUrl(role: PathRole | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  // Don't clobber document or verify deep links
  if (isDeepLinkPath(url.pathname)) return

  if (role) {
    url.searchParams.set('intent', role)
  } else {
    url.searchParams.delete('intent')
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== cur) {
    window.history.replaceState(window.history.state, '', next)
  }
}

export function intentFromUrl(search = window.location.search): PathRole | null {
  const v = new URLSearchParams(search).get('intent')
  if (v === 'creator' || v === 'signer' || v === 'verifier') return v
  return null
}

/**
 * Resolve active path intent.
 *
 * URL wins when present. On a clean home URL (no `?intent=`), sticky
 * sessionStorage is cleared so removing the query param actually sticks —
 * otherwise boot code kept re-writing `?intent=signer` from storage.
 *
 * Deep links (/d/, /v/) do not need intent in the URL.
 */
export function resolveJourneyIntent(): PathRole | null {
  if (typeof window === 'undefined') return readJourneyIntent()

  const fromUrl = intentFromUrl()
  if (fromUrl) {
    saveJourneyIntent(fromUrl)
    return fromUrl
  }

  const { pathname } = window.location
  if (isDeepLinkPath(pathname)) {
    return readJourneyIntent()
  }

  // Clean home / shell pages: do not rehydrate sticky signer/creator intent
  if (
    isHomePath(pathname) ||
    pathname === '/pricing' ||
    pathname === '/privacy' ||
    pathname === '/agreements' ||
    pathname.startsWith('/agreements/') ||
    pathname === '/blog' ||
    pathname.startsWith('/blog/')
  ) {
    clearJourneyIntent()
    return null
  }

  return readJourneyIntent()
}

/** Intent for Hub connect: prefer live React role, then URL/session. */
export function resolveIntentForConnect(role: PathRole | null): PathRole | null {
  return role ?? intentFromUrl() ?? readJourneyIntent()
}
