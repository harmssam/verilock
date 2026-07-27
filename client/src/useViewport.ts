import { useEffect, useState } from 'react'

function readLandscape(): boolean {
  if (typeof window === 'undefined') return true
  const mq =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(orientation: landscape)').matches
  return mq || window.innerWidth >= window.innerHeight
}

/**
 * True when the viewport is landscape (width ≥ height). Updates on rotate.
 * Used for mobile signature capture so the pad can match field aspect.
 */
export function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(readLandscape)
  useEffect(() => {
    const sync = () => setLandscape(readLandscape())
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
  return landscape
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
