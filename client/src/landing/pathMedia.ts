/**
 * Path stills + locked object-position crops for landing cards and track banners.
 */
import type { CSSProperties } from 'react'
import type { PathRole } from '../journey/types'

/** Focal crop (0–100%) + zoom scale (1 = cover, >1 = zoom in). */
export type ImagePlacement = { x: number; y: number; zoom: number }

export type PathPlacements = {
  card: Record<PathRole, ImagePlacement>
  track: Record<PathRole, ImagePlacement>
}

/** Locked focal crops (0–100%) + zoom for path cards and track banners. */
export const PATH_PLACEMENTS: PathPlacements = {
  card: {
    creator: { x: 39, y: 55, zoom: 1 },
    signer: { x: 54.5, y: 51, zoom: 1 },
    verifier: { x: 46.5, y: 36, zoom: 1 },
  },
  track: {
    creator: { x: 52, y: 40, zoom: 1 },
    signer: { x: 44, y: 49, zoom: 1 },
    verifier: { x: 48.5, y: 73, zoom: 1 },
  },
}

export const PATH_STILLS: Record<PathRole, string> = {
  creator: '/landing/path-create.jpg',
  signer: '/landing/path-invite.jpg',
  verifier: '/landing/path-verify.jpg',
}

/** Home hero visual: VeriLock mark + Nimiq hex network (not a path still). */
export const HERO_STILL = '/landing/hero.jpg'

/** object-position for the hero still (lock sits slightly left of center). */
export const HERO_PLACEMENT: ImagePlacement = { x: 42, y: 48, zoom: 1 }

export function formatObjectPosition(p: Pick<ImagePlacement, 'x' | 'y'>): string {
  return `${p.x}% ${p.y}%`
}

/** Inline style for still: object-position + scale zoom (origin at focus point). */
export function placementImageStyle(p: ImagePlacement): CSSProperties {
  const zoom = p.zoom > 0 ? p.zoom : 1
  const origin = formatObjectPosition(p)
  return {
    objectPosition: origin,
    transform: `scale(${zoom})`,
    transformOrigin: origin,
    ['--lr-path-zoom' as string]: String(zoom),
  }
}
