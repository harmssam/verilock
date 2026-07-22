const HUB_RETURN_PATH_KEY = 'verilock-hub-return-path'
/**
 * Survives leaving Safari/Chrome into the Nimiq Pay app WebView (sessionStorage
 * does not). Used when `nimiqpay://miniapp?url=` only loads the site origin.
 */
const PAY_RETURN_PATH_KEY = 'verilock-pay-return-path'

export function saveHubReturnPath(): void {
  if (typeof window === 'undefined') return
  const path = `${window.location.pathname}${window.location.search}`
  try {
    sessionStorage.setItem(HUB_RETURN_PATH_KEY, path)
  } catch {
    // ignore
  }
}

export function readHubReturnPath(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return sessionStorage.getItem(HUB_RETURN_PATH_KEY)
  } catch {
    return null
  }
}

export function consumeHubReturnPath(): string | null {
  const path = readHubReturnPath()
  if (!path) return null
  try {
    sessionStorage.removeItem(HUB_RETURN_PATH_KEY)
  } catch {
    // ignore
  }
  return path
}

/** Path+query only (e.g. `/d/slug?party=…`) for post–Nimiq Pay restore. */
export function savePayReturnPath(path?: string): void {
  if (typeof window === 'undefined') return
  const next =
    path ?? `${window.location.pathname}${window.location.search}${window.location.hash}`
  // Never stash bare home — nothing useful to restore.
  if (!next || next === '/' || next === '') return
  try {
    localStorage.setItem(PAY_RETURN_PATH_KEY, next)
  } catch {
    // ignore
  }
}

export function readPayReturnPath(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(PAY_RETURN_PATH_KEY)
  } catch {
    return null
  }
}

export function clearPayReturnPath(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PAY_RETURN_PATH_KEY)
  } catch {
    // ignore
  }
}

export function consumePayReturnPath(): string | null {
  const path = readPayReturnPath()
  if (!path) return null
  clearPayReturnPath()
  return path
}

/**
 * If Nimiq Pay (or a cold open) landed on `/` but we had an invite/deep link
 * pending, restore it before React routes the shell.
 * Safe to call once at boot; only rewrites when currently on home.
 */
export function restorePayReturnPathIfNeeded(): string | null {
  if (typeof window === 'undefined') return null
  const pending = readPayReturnPath()
  if (!pending) return null

  // Absolute URL in storage (legacy) → path+search only
  let path = pending
  try {
    if (/^https?:\/\//i.test(pending)) {
      const u = new URL(pending)
      path = `${u.pathname}${u.search}${u.hash}`
    }
  } catch {
    /* keep raw */
  }

  if (!path.startsWith('/')) {
    clearPayReturnPath()
    return null
  }

  const pathOnly = path.split(/[?#]/)[0] ?? path
  // Only restore known app routes (never arbitrary paths).
  if (
    !documentSlugFromPath(pathOnly) &&
    !verifySlugFromPath(pathOnly) &&
    !isAgreementsPath(pathOnly) &&
    !isPricingPath(pathOnly) &&
    !isSignMobilePath(pathOnly)
  ) {
    clearPayReturnPath()
    return null
  }

  const current = window.location.pathname
  // Already on a document/verify deep link — drop stale pending.
  if (documentSlugFromPath(current) || verifySlugFromPath(current)) {
    clearPayReturnPath()
    return null
  }

  // Home (or unknown) after Pay open: re-apply invite path.
  if (current === '/' || current === '') {
    clearPayReturnPath()
    window.history.replaceState(window.history.state, '', path)
    return path
  }

  return null
}

export function documentSlugFromPath(path: string): string | null {
  return path.match(/^\/d\/([^/]+)/)?.[1] ?? null
}

export function verifySlugFromPath(path: string): string | null {
  return path.match(/^\/v\/([^/]+)/)?.[1] ?? null
}

export function isAgreementsPath(path: string): boolean {
  return /^\/agreements\/?$/.test(path)
}

export function isPricingPath(path: string): boolean {
  return /^\/pricing\/?$/.test(path)
}

export function isPrivacyPath(path: string): boolean {
  return /^\/privacy\/?$/.test(path)
}

export function isSecurityPath(path: string): boolean {
  return /^\/security\/?$/.test(path)
}

export function isSupportPath(path: string): boolean {
  return /^\/support\/?$/.test(path)
}

/** Blog index (`/blog`) or a post (`/blog/:slug`). */
export function isBlogPath(path: string): boolean {
  return /^\/blog(?:\/[^/]+)?\/?$/.test(path)
}

/** PDF annotation experiment (local overlays, no pdf-lib). */
export function isPdfPath(path: string): boolean {
  return /^\/pdf\/?$/.test(path) || isPdfLabPath(path)
}

/** Signature encoding lab under /pdf/lab */
export function isPdfLabPath(path: string): boolean {
  return /^\/pdf\/lab\/?$/.test(path)
}

/** Cross-device mobile signature capture (`/m/sign/:sessionId`). */
export function isSignMobilePath(path: string): boolean {
  return /^\/m\/sign\/[^/]+\/?$/.test(path)
}

export function isKnownAppPath(path: string): boolean {
  if (path === '/' || path === '') return true
  if (isAgreementsPath(path)) return true
  if (isPricingPath(path)) return true
  if (isPrivacyPath(path)) return true
  if (isSecurityPath(path)) return true
  if (isSupportPath(path)) return true
  if (isBlogPath(path)) return true
  if (isPdfPath(path)) return true
  if (isSignMobilePath(path)) return true
  if (documentSlugFromPath(path)) return true
  if (verifySlugFromPath(path)) return true
  return false
}

export function resolveDocumentSlugFromLocation(pathname?: string): string | null {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  return documentSlugFromPath(path) ?? (readHubReturnPath() ? documentSlugFromPath(readHubReturnPath()!) : null)
}