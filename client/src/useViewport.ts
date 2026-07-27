import { useEffect, useState } from 'react'

/**
 * Nimiq Pay mini app is portrait-locked and does not support a true landscape
 * viewport. Detect via injected `window.nimiqPay` (same as `isNimiqPayHost`).
 */
export function isNimiqPayMiniAppHost(): boolean {
  return typeof window !== 'undefined' && Boolean(window.nimiqPay)
}

/** Physical / CSS landscape (ignores Nimiq Pay). */
function readRealLandscape(): boolean {
  if (typeof window === 'undefined') return true
  const mq =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(orientation: landscape)').matches
  return mq || window.innerWidth >= window.innerHeight
}

/**
 * True when ink capture may proceed without a rotate prompt.
 * Real landscape, or Nimiq Pay mini app (portrait-locked host).
 */
export function useIsLandscape(): boolean {
  const [ok, setOk] = useState(
    () => isNimiqPayMiniAppHost() || readRealLandscape(),
  )
  useEffect(() => {
    // Pay never flips to landscape; keep gate open forever.
    if (isNimiqPayMiniAppHost()) {
      setOk(true)
      return
    }
    const sync = () => setOk(readRealLandscape())
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
  return ok
}

/**
 * True when the device is actually portrait (CSS orientation).
 * Used so Nimiq Pay can skip the rotate gate but still get a portrait pad layout
 * (wide horizontal band centered in a tall frame).
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

/** One-shot: phone-sized touch surface (narrow + coarse pointer). */
export function isLikelyMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const narrow = window.matchMedia('(max-width: 640px)').matches
    const coarse = window.matchMedia('(pointer: coarse)').matches
    return narrow && coarse
  } catch {
    return false
  }
}

/**
 * Reactive: primary surface is a phone-sized touch device.
 * Prefer this over a one-shot `isLikelyMobileViewport()` when UI must reflow.
 */
export function useLikelyMobileViewport(): boolean {
  const [mobile, setMobile] = useState(isLikelyMobileViewport)
  useEffect(() => {
    const sync = () => setMobile(isLikelyMobileViewport())
    sync()
    const mqs = [
      window.matchMedia('(max-width: 640px)'),
      window.matchMedia('(pointer: coarse)'),
    ]
    for (const mq of mqs) mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    return () => {
      for (const mq of mqs) mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])
  return mobile
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
