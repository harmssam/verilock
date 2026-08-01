/**
 * Detect admin portal surface:
 * - Path `/admin` or `/admin/*` on the main site
 * - Path `/admin-v2` or `/admin-v2/*` on the main site
 * - Host `admin.*` (e.g. admin.verilock.online)
 */
export function isAdminHost(hostname?: string): boolean {
  if (typeof window === 'undefined' && hostname == null) return false
  const host = (hostname ?? window.location.hostname).toLowerCase()
  return host === 'admin.verilock.online' || host.startsWith('admin.')
}

export function isAdminPath(pathname?: string): boolean {
  const path =
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  return /^\/admin(?:\/.*)?\/?$/.test(path)
}

export function isAdminV2Path(pathname?: string): boolean {
  const path =
    pathname ?? (typeof window !== 'undefined' ? window.location.pathname : '')
  return /^\/admin-v2(?:\/.*)?\/?$/.test(path)
}

/** True when this page load should mount the admin-v2 shell instead of the product SPA. */
export function isAdminV2Surface(): boolean {
  if (typeof window === 'undefined') return false
  return isAdminV2Path()
}

/** True when this page load should mount the admin shell instead of the product SPA. */
export function isAdminSurface(): boolean {
  if (typeof window === 'undefined') return false
  return isAdminHost() || isAdminPath()
}
