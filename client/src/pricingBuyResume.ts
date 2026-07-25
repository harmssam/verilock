/**
 * Resume buy-credits after wallet login (Hub redirect or popup remount).
 * Pack is stored in the URL (?pack=) so Hub return URL keeps it, plus
 * sessionStorage as a same-tab backup.
 */

const STORAGE_KEY = 'verilock-pricing-buy-resume'

export type PricingBuyResume = {
  pack: number
  ts: number
}

function isValidPack(n: number, allowed?: number[]): boolean {
  if (!Number.isFinite(n) || n < 1) return false
  if (allowed && allowed.length > 0) return allowed.includes(n)
  return true
}

export function readPackFromLocation(allowed?: number[]): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = new URLSearchParams(window.location.search).get('pack')
    if (!raw) return null
    const n = Number.parseInt(raw, 10)
    return isValidPack(n, allowed) ? n : null
  } catch {
    return null
  }
}

export function peekPricingBuyResume(allowed?: number[]): PricingBuyResume | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PricingBuyResume
    if (!parsed || !isValidPack(Number(parsed.pack), allowed)) return null
    // Drop stale resumes (e.g. abandoned overnight).
    if (Date.now() - Number(parsed.ts) > 60 * 60 * 1000) {
      sessionStorage.removeItem(STORAGE_KEY)
      return null
    }
    return { pack: Number(parsed.pack), ts: Number(parsed.ts) }
  } catch {
    return null
  }
}

export function consumePricingBuyResume(allowed?: number[]): PricingBuyResume | null {
  const next = peekPricingBuyResume(allowed)
  if (typeof window === 'undefined') return next
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  return next
}

/**
 * Before wallet login from pricing: remember pack + point return URL at buy-credits.
 * Updates `/pricing?pack=N#buy-credits` so Hub redirect keeps the pack query.
 */
export function preparePricingBuyLogin(pack: number): void {
  if (typeof window === 'undefined') return
  const n = Math.floor(Number(pack))
  if (!Number.isFinite(n) || n < 1) return

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ pack: n, ts: Date.now() }))
  } catch {
    /* ignore */
  }

  try {
    const url = new URL(window.location.href)
    // Stay on pricing if already there; otherwise still set pack for return.
    if (!/^\/pricing\/?$/.test(url.pathname)) {
      url.pathname = '/pricing'
    }
    url.searchParams.set('pack', String(n))
    url.hash = 'buy-credits'
    const next = `${url.pathname}${url.search}${url.hash}`
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`
    if (cur !== next) {
      window.history.replaceState(window.history.state, '', next)
    }
  } catch {
    /* ignore */
  }
}

/** Resolve pack preference: URL → session → default. */
export function resolvePricingBuyPack(fallback = 10, allowed?: number[]): number {
  const fromUrl = readPackFromLocation(allowed)
  if (fromUrl != null) return fromUrl
  const resume = peekPricingBuyResume(allowed)
  if (resume) return resume.pack
  if (allowed && allowed.length > 0 && !allowed.includes(fallback)) {
    return allowed[0]!
  }
  return fallback
}

export function shouldRestoreBuyCreditsScroll(): boolean {
  if (typeof window === 'undefined') return false
  if (window.location.hash === '#buy-credits') return true
  if (readPackFromLocation() != null) return true
  if (peekPricingBuyResume() != null) return true
  return false
}

export function scrollToBuyCredits(behavior: ScrollBehavior = 'smooth'): void {
  if (typeof window === 'undefined') return
  const el = document.getElementById('buy-credits')
  if (!el) return
  el.scrollIntoView({ behavior, block: 'start' })
}
