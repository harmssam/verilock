const HUB_RETURN_PATH_KEY = 'verilock-hub-return-path'

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


export function isKnownAppPath(path: string): boolean {
  if (path === '/' || path === '') return true
  if (isAgreementsPath(path)) return true
  if (isPricingPath(path)) return true
  if (isPrivacyPath(path)) return true
  if (isSecurityPath(path)) return true
  if (documentSlugFromPath(path)) return true
  if (verifySlugFromPath(path)) return true
  return false
}

export function resolveDocumentSlugFromLocation(pathname?: string): string | null {
  const path = pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  return documentSlugFromPath(path) ?? (readHubReturnPath() ? documentSlugFromPath(readHubReturnPath()!) : null)
}