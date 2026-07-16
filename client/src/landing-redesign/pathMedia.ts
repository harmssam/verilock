/**
 * Path stills + locked object-position crops for landing cards and track banners.
 * Card crops can be live-tuned in the redesign preview (Place images mode).
 */
import type { CSSProperties } from 'react'
import type { PathRole } from '../experiment/types'

/** Focal crop (0–100%) + zoom scale (1 = cover, >1 = zoom in). */
export type ImagePlacement = { x: number; y: number; zoom: number }

export type PathPlacements = {
  card: Record<PathRole, ImagePlacement>
  track: Record<PathRole, ImagePlacement>
}

const PATH_ROLES: PathRole[] = ['creator', 'signer', 'verifier']

/** Zoom range for place mode (1 = natural cover). */
export const PATH_ZOOM_MIN = 1
export const PATH_ZOOM_MAX = 2.5
export const PATH_ZOOM_STEP = 0.05

/**
 * Locked focal crops (0–100%) + zoom.
 * Tuned so seal / handoff / magnifier read clearly under light label scrims.
 * Live-tune with dev `?place=1`, then paste back here.
 */
export const PATH_PLACEMENTS: PathPlacements = {
  card: {
    // Wax seal centered, slightly higher so the strip does not cover the lock mark
    creator: { x: 48, y: 38, zoom: 1.12 },
    // Folder handoff: keep hands + document in the upper two-thirds
    signer: { x: 62, y: 42, zoom: 1.2 },
    // Magnifier + stamp: crop to the instrument cluster
    verifier: { x: 44, y: 32, zoom: 1.18 },
  },
  track: {
    creator: { x: 50, y: 36, zoom: 1.08 },
    signer: { x: 58, y: 40, zoom: 1.1 },
    verifier: { x: 46, y: 34, zoom: 1.1 },
  },
}

export const PATH_STILLS: Record<PathRole, string> = {
  creator: '/landing-redesign/path-create.jpg',
  signer: '/landing-redesign/path-invite.jpg',
  verifier: '/landing-redesign/path-verify.jpg',
}

/** localStorage key for redesign preview card placement overrides. Bump when defaults change. */
export const PATH_PLACEMENTS_STORAGE_KEY = 'verilock.landing-redesign.pathPlacements.v3'

export function formatObjectPosition(p: Pick<ImagePlacement, 'x' | 'y'>): string {
  return `${p.x}% ${p.y}%`
}

export function clampPlacement(n: number): number {
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(0, Math.round(n * 10) / 10))
}

export function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1
  const stepped = Math.round(n / PATH_ZOOM_STEP) * PATH_ZOOM_STEP
  return Math.min(PATH_ZOOM_MAX, Math.max(PATH_ZOOM_MIN, Math.round(stepped * 100) / 100))
}

export function normalizePlacement(p: Partial<ImagePlacement> | null | undefined): ImagePlacement {
  return {
    x: clampPlacement(p?.x ?? 50),
    y: clampPlacement(p?.y ?? 50),
    zoom: clampZoom(p?.zoom ?? 1),
  }
}

/** Inline style for still: object-position + scale zoom (origin at focus point). */
export function placementImageStyle(p: ImagePlacement): CSSProperties {
  const zoom = clampZoom(p.zoom)
  const origin = formatObjectPosition(p)
  return {
    objectPosition: origin,
    transform: `scale(${zoom})`,
    transformOrigin: origin,
    // Used by CSS hover so zoom multiplies cleanly
    ['--lr-path-zoom' as string]: String(zoom),
  }
}

export function clonePathPlacements(src: PathPlacements = PATH_PLACEMENTS): PathPlacements {
  return {
    card: {
      creator: { ...src.card.creator },
      signer: { ...src.card.signer },
      verifier: { ...src.card.verifier },
    },
    track: {
      creator: { ...src.track.creator },
      signer: { ...src.track.signer },
      verifier: { ...src.track.verifier },
    },
  }
}

function isPlacementLike(v: unknown): v is Partial<ImagePlacement> {
  if (!v || typeof v !== 'object') return false
  const o = v as Partial<ImagePlacement>
  return typeof o.x === 'number' && typeof o.y === 'number'
}

/** Merge stored overrides onto defaults (card only is required). */
export function loadPathPlacementsFromStorage(): PathPlacements {
  const base = clonePathPlacements()
  if (typeof window === 'undefined') return base
  try {
    // Prefer v2; fall back to v1 (x/y only → zoom 1)
    const raw =
      window.localStorage.getItem(PATH_PLACEMENTS_STORAGE_KEY) ??
      window.localStorage.getItem('verilock.landing-redesign.pathPlacements.v1')
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<PathPlacements>
    for (const role of PATH_ROLES) {
      if (parsed.card && isPlacementLike(parsed.card[role])) {
        base.card[role] = normalizePlacement(parsed.card[role])
      }
      if (parsed.track && isPlacementLike(parsed.track[role])) {
        base.track[role] = normalizePlacement(parsed.track[role])
      }
    }
  } catch {
    /* ignore corrupt storage */
  }
  return base
}

export function savePathPlacementsToStorage(p: PathPlacements): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PATH_PLACEMENTS_STORAGE_KEY, JSON.stringify(p))
  } catch {
    /* quota / private mode */
  }
}

/** TS snippet to paste into pathMedia.ts after tuning. */
export function formatPathPlacementsSource(p: PathPlacements): string {
  const fmt = (role: PathRole, slot: 'card' | 'track') => {
    const n = normalizePlacement(p[slot][role])
    return `    ${role}: { x: ${n.x}, y: ${n.y}, zoom: ${n.zoom} },`
  }
  return `export const PATH_PLACEMENTS: PathPlacements = {
  card: {
${PATH_ROLES.map(r => fmt(r, 'card')).join('\n')}
  },
  track: {
${PATH_ROLES.map(r => fmt(r, 'track')).join('\n')}
  },
}`
}
