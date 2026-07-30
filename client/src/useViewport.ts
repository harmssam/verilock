import { useEffect, useState } from 'react'
import { isMobileDevice } from './nimiq'

/**
 * Nimiq Pay mini app is portrait-locked and does not support a true landscape
 * viewport. Detect via injected `window.nimiqPay` (same as `isNimiqPayHost`).
 */
export function isNimiqPayMiniAppHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nimiqPay)
}

/** Physical / CSS landscape (ignores Nimiq Pay and forced-ink hosts). */
function readRealLandscape(): boolean {
  if (typeof window === 'undefined') return true
  const mq =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(orientation: landscape)').matches
  return mq || window.innerWidth >= window.innerHeight
}

/**
 * Phone/tablet client for product UX (ink sheet, mobile CTAs).
 *
 * Same rule as {@link isMobileDevice}: browser-reported identity only.
 * **Not** CSS width — a desktop window shrunk by docked DevTools is still desktop.
 * Spoofed phone UA / device toolbar is treated as mobile (by design).
 */
export function isLikelyMobileViewport(): boolean {
  return isMobileDevice()
}

/**
 * Reactive: follows browser-reported device identity (not window width).
 * Updates if the client identity changes (rare; e.g. toggling device emulation).
 */
export function useLikelyMobileViewport(): boolean {
  const [mobile, setMobile] = useState(isLikelyMobileViewport)
  useEffect(() => {
    const sync = () => setMobile(isLikelyMobileViewport())
    sync()
    // UA rarely changes; keep light listeners for DevTools device-mode toggles.
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])
  return mobile
}

/**
 * Hosts that get the forced-landscape ink sheet (CSS rotate frame) instead of a
 * “turn the phone sideways” gate:
 * - Nimiq Pay (portrait-locked WebView — cannot OS-rotate)
 * - Mobile browser (same phone UX; Pay is just a browser shell)
 *
 * Desktop stays on the rotate gate / card modal path.
 */
export function useForceLandscapeInkHost(): boolean {
  const mobile = useLikelyMobileViewport()
  return isNimiqPayMiniAppHost() || mobile
}

/**
 * True when ink capture may proceed without a rotate prompt.
 * Real OS landscape, Nimiq Pay, or phone-sized mobile browser.
 */
export function useIsLandscape(): boolean {
  const forceInkHost = useForceLandscapeInkHost()
  const [realLandscape, setRealLandscape] = useState(readRealLandscape)
  useEffect(() => {
    const sync = () => setRealLandscape(readRealLandscape())
    sync()
    const mq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(orientation: landscape)')
        : null
    mq?.addEventListener('change', sync)
    window.addEventListener('orientationchange', sync)
    window.addEventListener('resize', sync)
    return () => {
      mq?.removeEventListener('change', sync)
      window.removeEventListener('orientationchange', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return forceInkHost || realLandscape
}

/**
 * True when the device is actually portrait (CSS orientation).
 * Combined with force-ink hosts: skip the rotate gate and use the CSS-rotated
 * landscape pad frame (same path for Nimiq Pay and mobile Safari/Chrome).
 */
export function useIsRealPortrait(): boolean {
  const [portrait, setPortrait] = useState(() => !readRealLandscape())
  useEffect(() => {
    const sync = () => setPortrait(!readRealLandscape())
    sync()
    const mq =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(orientation: landscape)')
        : null
    mq?.addEventListener('change', sync)
    window.addEventListener('orientationchange', sync)
    window.addEventListener('resize', sync)
    return () => {
      mq?.removeEventListener('change', sync)
      window.removeEventListener('orientationchange', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return portrait
}

function readPrimarilyTouch(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(pointer: coarse)').matches) return true
    if (window.matchMedia('(hover: none)').matches && 'ontouchstart' in window) {
      return true
    }
  } catch {
    /* ignore */
  }
  return 'ontouchstart' in window && navigator.maxTouchPoints > 0
}

/**
 * Prefer finger-only copy on touch / coarse-pointer devices (no “mouse” on phones).
 */
export function usePrimarilyTouch(): boolean {
  const [touch, setTouch] = useState(readPrimarilyTouch)
  useEffect(() => {
    const sync = () => setTouch(readPrimarilyTouch())
    sync()
    const mqs = [
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(hover: none)'),
    ]
    for (const mq of mqs) mq.addEventListener('change', sync)
    return () => {
      for (const mq of mqs) mq.removeEventListener('change', sync)
    }
  }, [])
  return touch
}
