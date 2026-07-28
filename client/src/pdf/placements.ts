/**
 * Construction placements: named people + empty page slots (no ink yet).
 * Locked plan geometry is immutable; fills bind content-addressed blobs later.
 */

import type { SignaturePathData } from './annotations'

/** Stable ArrayBuffer from a UTF-8 string (no shared-buffer length traps). */
export function utf8Buffer(s: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(s)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** SHA-256 hex - uses Web Crypto (browser + Node 19+); no pdf.js dependency. */
export async function sha256HexBytes(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : data
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 1-based display index ("Person 1"). */
export interface ConstructionPerson {
  slotIndex: number
  displayName: string
  role?: string
  /**
   * Optional pre-bound Nimiq wallet (normalized, no spaces).
   * When set, only this address may sign as this person.
   * When omitted, invitees pick this person by name (or use a ?party= link).
   */
  walletAddress?: string | null
}

export type PlacementKind =
  | 'signature'
  | 'initial'
  | 'name'
  | 'text'
  | 'checkmark'
  | 'cross'

/** Signature and initials are drawn ink; both reuse one stroke across same-kind slots. */
export function isInkPlacementKind(kind: PlacementKind | string): boolean {
  return kind === 'signature' || kind === 'initial'
}

/** Empty template on the page - no ink/text payload until a fill. */
export interface PlacementSlot {
  id: string
  /** Which person fills this (matches ConstructionPerson.slotIndex). */
  personSlotIndex: number
  kind: PlacementKind
  pageIndex: number
  /** Normalized geometry [0,1], top-left origin. */
  x: number
  y: number
  width: number
  height: number
  /** Creator-owned fixed content (marks / static notes) locked with the plan. */
  lockedContent?: {
    text?: string
    mark?: 'checkmark' | 'cross'
    fontSizeRatio?: number
    color?: string
  }
}

export type ConstructionPlanStatus = 'draft' | 'locked'

export interface ConstructionPlan {
  pdfSha256: string
  people: ConstructionPerson[]
  slots: PlacementSlot[]
  status: ConstructionPlanStatus
  lockedAt?: number
  /** sha256 hex of canonical plan JSON (set when locked). */
  planRoot?: string
  /**
   * 1-based person the agreement creator will sign as.
   * `null` = organizer only (does not sign). Omitted defaults to null.
   */
  creatorSigningAs?: number | null
}

/** Content-addressed ink or text payload. */
export type BlobKind = 'ink' | 'text'

export interface InkBlobPayload {
  kind: 'ink'
  path: SignaturePathData
}

export interface TextBlobPayload {
  kind: 'text'
  text: string
  fontSizeRatio?: number
  color?: string
}

export type BlobPayload = InkBlobPayload | TextBlobPayload

export interface ContentBlob {
  /** First 16 bytes of sha256(canonical payload) as 32 hex chars. */
  blobId: string
  payload: BlobPayload
}

/** Bind a blob into a placement slot. */
export interface SlotFill {
  slotId: string
  blobId: string
  personSlotIndex: number
}

export interface PlacementBatch {
  batchIndex: number
  /** Full sha256 hex of previous batch payload; 64 zeros for batch 0. */
  prevRoot: string
  pdfSha256: string
  planRoot: string
  /** Present on plan-lock batch (usually index 0). */
  people?: ConstructionPerson[]
  places?: PlacementSlot[]
  blobs: ContentBlob[]
  fills: SlotFill[]
  /** sha256 hex of this batch's canonical wire JSON (set after pack). */
  batchRoot?: string
}

export const ZERO_ROOT =
  '0000000000000000000000000000000000000000000000000000000000000000'

const EPS = 1e-9

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Quantize for stable hashes / wire size. */
export function q(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return 0
  const p = 10 ** digits
  return Math.round(n * p) / p
}

// ---------------------------------------------------------------------------
// Placement box scale (editor UX only — chain stores absolute width/height)
// ---------------------------------------------------------------------------

/**
 * Uniform scale relative to {@link defaultSizeForKind} (100%).
 * Discrete steps keep the editor slider stable; wire format still uses w/h floats.
 *
 * **Do not change defaults casually.** Draft re-open infers slider % as
 * `slot.size / defaultSize`. Locked plans / chain restore only need w/h.
 */
export const PLACEMENT_SCALE_MIN_PCT = 40
export const PLACEMENT_SCALE_MAX_PCT = 140
export const PLACEMENT_SCALE_STEP_PCT = 10
export const PLACEMENT_SCALE_DEFAULT_PCT = 100

/** Page-height font ratios at 100% box scale (paint + fill). */
export const DEFAULT_LABEL_FONT_RATIO = 0.018
export const DEFAULT_NAME_FILL_FONT_RATIO = 0.025
export const DEFAULT_TEXT_FILL_FONT_RATIO = 0.022

/**
 * Default normalized box size at 100% scale.
 * Frozen contract for place / ghost / scale reverse-inference.
 */
export function defaultSizeForKind(kind: PlacementKind): { width: number; height: number } {
  if (kind === 'signature') return { width: 0.28, height: 0.08 }
  // Initials: short box (about 1/3 signature width)
  if (kind === 'initial') return { width: 0.1, height: 0.055 }
  if (kind === 'name') return { width: 0.28, height: 0.045 }
  if (kind === 'text') return { width: 0.28, height: 0.045 }
  // Check / X: equal fractions are NOT square on-screen (page height ≠ width).
  // Use {@link markNormalizedSize} when placing so the CSS box is a perfect square.
  return { width: 0.045, height: 0.045 }
}

/**
 * Normalized w/h for a check or X box that is square in CSS pixels.
 * `pageCssAspect` = rendered page width ÷ height (e.g. cssSize.width / cssSize.height).
 */
export function markNormalizedSize(
  scalePercent: number,
  pageCssAspect: number,
): { width: number; height: number } {
  const pct = snapPlacementScalePercent(scalePercent)
  const scale = pct / PLACEMENT_SCALE_DEFAULT_PCT
  const base = defaultSizeForKind('checkmark')
  const width = clamp01(base.width * scale)
  const aspect =
    Number.isFinite(pageCssAspect) && pageCssAspect > 0.05 && pageCssAspect < 20
      ? pageCssAspect
      : 1
  // CSS square: side = width_norm * cssW = height_norm * cssH
  // → height_norm = width_norm * (cssW / cssH) = width_norm * pageCssAspect
  const height = clamp01(width * aspect)
  return { width, height }
}

export function isMarkPlacementKind(kind: PlacementKind | string): boolean {
  return kind === 'checkmark' || kind === 'cross'
}

/** CSS pixel size for a check/X placement (perfect square on the rendered page). */
export function markCssPixelSize(
  cssPage: { width: number; height: number },
  scalePercent: number = PLACEMENT_SCALE_DEFAULT_PCT,
): { width: number; height: number } {
  const aspect = cssPage.height > 0 ? cssPage.width / cssPage.height : 1
  const norm = markNormalizedSize(scalePercent, aspect)
  return {
    width: norm.width * cssPage.width,
    height: norm.height * cssPage.height,
  }
}

/** Snap to an allowed scale percent (40–140, step 10). Accepts percent or ratio (≤ 2). */
export function snapPlacementScalePercent(value: number): number {
  if (!Number.isFinite(value)) return PLACEMENT_SCALE_DEFAULT_PCT
  // Allow callers to pass either 100 or 1.0
  const pct = value > 0 && value <= 2 ? value * 100 : value
  if (pct <= 0) return PLACEMENT_SCALE_DEFAULT_PCT
  const stepped =
    Math.round((pct - PLACEMENT_SCALE_MIN_PCT) / PLACEMENT_SCALE_STEP_PCT) *
      PLACEMENT_SCALE_STEP_PCT +
    PLACEMENT_SCALE_MIN_PCT
  return Math.min(
    PLACEMENT_SCALE_MAX_PCT,
    Math.max(PLACEMENT_SCALE_MIN_PCT, stepped),
  )
}

/** Infer slider percent from stored geometry vs kind defaults. */
export function scalePercentFromSlot(slot: Pick<PlacementSlot, 'kind' | 'width' | 'height'>): number {
  const d = defaultSizeForKind(slot.kind)
  // Marks keep a CSS square via unequal norm w/h — scale from width only.
  if (isMarkPlacementKind(slot.kind)) {
    return snapPlacementScalePercent(slot.width / Math.max(EPS, d.width))
  }
  const sx = slot.width / Math.max(EPS, d.width)
  const sy = slot.height / Math.max(EPS, d.height)
  return snapPlacementScalePercent((sx + sy) / 2)
}

/** Base×scale font ratio, quantized for wire stability. */
export function fontSizeRatioAtScale(baseRatio: number, scalePercent: number): number {
  const pct = snapPlacementScalePercent(scalePercent)
  return q(Math.max(0, baseRatio) * (pct / PLACEMENT_SCALE_DEFAULT_PCT), 4)
}

/**
 * Font ratio for a text/name fill, proportional to the placement box scale.
 * Stored on the text blob at sign time so review/chain paint match the field size.
 */
export function fillFontSizeRatioForSlot(
  slot: Pick<PlacementSlot, 'kind' | 'width' | 'height'>,
): number {
  const base =
    slot.kind === 'name' ? DEFAULT_NAME_FILL_FONT_RATIO : DEFAULT_TEXT_FILL_FONT_RATIO
  return fontSizeRatioAtScale(base, scalePercentFromSlot(slot))
}

/**
 * Apply uniform scale from kind defaults; keep box center; clamp on page.
 * Updates label `lockedContent.fontSizeRatio` when present (text field labels).
 * Does not write a separate scale field — only geometry (+ optional locked font).
 */
export function applyPlacementScale(
  slot: PlacementSlot,
  scalePercent: number,
  /**
   * Rendered page width÷height. Required for check/X so the box stays a
   * perfect square on screen; ignored for other kinds.
   */
  pageCssAspect?: number,
): Partial<PlacementSlot> {
  const pct = snapPlacementScalePercent(scalePercent)
  const scale = pct / PLACEMENT_SCALE_DEFAULT_PCT
  const d = defaultSizeForKind(slot.kind)
  const sized =
    isMarkPlacementKind(slot.kind) && pageCssAspect != null
      ? markNormalizedSize(pct, pageCssAspect)
      : { width: clamp01(d.width * scale), height: clamp01(d.height * scale) }
  const width = sized.width
  const height = sized.height
  const cx = slot.x + slot.width / 2
  const cy = slot.y + slot.height / 2
  let x = cx - width / 2
  let y = cy - height / 2
  x = Math.min(Math.max(0, x), 1 - width)
  y = Math.min(Math.max(0, y), 1 - height)

  const patch: Partial<PlacementSlot> = {
    x: clamp01(x),
    y: clamp01(y),
    width,
    height,
  }

  // Field labels / static text notes: keep font proportional to box scale.
  if (slot.lockedContent && (slot.kind === 'text' || slot.kind === 'name')) {
    const hasTextLabel =
      slot.lockedContent.text != null || slot.lockedContent.fontSizeRatio != null
    if (hasTextLabel) {
      patch.lockedContent = {
        ...slot.lockedContent,
        fontSizeRatio: fontSizeRatioAtScale(DEFAULT_LABEL_FONT_RATIO, pct),
      }
    }
  }

  return patch
}

export function newSlotId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Max people on one construction plan (Setup). Keep in sync with server placementPlans. */
export const MAX_CONSTRUCTION_PEOPLE = 10
export const MIN_CONSTRUCTION_PEOPLE = 1

/** Stable palette for person chips / slots (cycles if ever needed beyond length). */
/**
 * Person chip / slot colors - spaced around the hue wheel so neighbors stay distinct
 * on light UI (no two teals, no amber+orange pair, no rose+pink+fuchsia pile-up).
 */
export const PERSON_COLORS = [
  '#0f766e', // 1 deep teal
  '#b45309', // 2 amber
  '#1d4ed8', // 3 blue
  '#7c3aed', // 4 violet (was too close to #1 when teal)
  '#be123c', // 5 rose
  '#15803d', // 6 green
  '#92400e', // 7 brown
  '#db2777', // 8 pink
  '#0369a1', // 9 ocean (darker sky; not the same family as #3)
  '#a16207', // 10 gold
] as const

export function personColor(slotIndex: number): string {
  return PERSON_COLORS[(Math.max(1, slotIndex) - 1) % PERSON_COLORS.length]!
}

export function defaultPeople(count: number): ConstructionPerson[] {
  const n = Math.max(
    MIN_CONSTRUCTION_PEOPLE,
    Math.min(MAX_CONSTRUCTION_PEOPLE, Math.floor(count)),
  )
  return Array.from({ length: n }, (_, i) => ({
    slotIndex: i + 1,
    displayName: `Person ${i + 1}`,
  }))
}

export function emptyPlan(pdfSha256: string, peopleCount = 1): ConstructionPlan {
  return {
    pdfSha256: normalizeHex64(pdfSha256),
    people: defaultPeople(peopleCount),
    slots: [],
    status: 'draft',
    creatorSigningAs: null,
  }
}

export function normalizeHex64(hex: string): string {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new Error('expected 64 hex chars')
  }
  return clean
}

export function normalizeHex32(hex: string): string {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(clean)) {
    throw new Error('expected 32 hex chars (16-byte blob id)')
  }
  return clean
}

/** Canonical plan object (stable key order, quantized geometry). */
export function canonicalizePlan(plan: ConstructionPlan): Record<string, unknown> {
  const people = [...plan.people]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map(p => {
      const row: Record<string, unknown> = {
        i: p.slotIndex,
        n: String(p.displayName ?? '').trim().slice(0, 80),
      }
      if (p.role) row.r = String(p.role).slice(0, 40)
      const w = p.walletAddress?.replace(/\s+/g, '').toUpperCase()
      if (w) row.w = w
      return row
    })

  const places = [...plan.slots]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(s => {
      const row: Record<string, unknown> = {
        id: s.id,
        p: s.personSlotIndex,
        k: kindToWire(s.kind),
        page: s.pageIndex | 0,
        x: q(clamp01(s.x)),
        y: q(clamp01(s.y)),
        w: q(Math.max(EPS, clamp01(s.width))),
        h: q(Math.max(EPS, clamp01(s.height))),
      }
      if (s.lockedContent) {
        const lc: Record<string, unknown> = {}
        if (s.lockedContent.text != null) lc.t = String(s.lockedContent.text).slice(0, 500)
        if (s.lockedContent.mark) lc.m = s.lockedContent.mark === 'checkmark' ? 'c' : 'k'
        if (s.lockedContent.fontSizeRatio != null) lc.f = q(s.lockedContent.fontSizeRatio, 4)
        if (s.lockedContent.color) lc.c = s.lockedContent.color
        if (Object.keys(lc).length) row.lc = lc
      }
      return row
    })

  const row: Record<string, unknown> = {
    v: 2,
    pdf: normalizeHex64(plan.pdfSha256),
    people,
    places,
  }
  // Include creator role so planRoot commits to organizer-vs-signer choice
  if (plan.creatorSigningAs == null) row.cs = null
  else row.cs = plan.creatorSigningAs | 0
  return row
}

export function kindToWire(kind: PlacementKind): string {
  switch (kind) {
    case 'signature':
      return 's'
    case 'initial':
      return 'i'
    case 'name':
      return 'n'
    case 'text':
      return 'x'
    case 'checkmark':
      return 'c'
    case 'cross':
      return 'k'
    default:
      return 's'
  }
}

export function kindFromWire(k: string): PlacementKind {
  switch (k) {
    case 's':
      return 'signature'
    case 'i':
    case 'initial':
      return 'initial'
    case 'n':
      return 'name'
    case 'x':
      return 'text'
    case 'c':
      return 'checkmark'
    case 'k':
      return 'cross'
    default:
      return 'signature'
  }
}

export function planToCanonicalJson(plan: ConstructionPlan): string {
  return JSON.stringify(canonicalizePlan(plan))
}

export async function computePlanRoot(plan: ConstructionPlan): Promise<string> {
  return sha256HexBytes(utf8Buffer(planToCanonicalJson(plan)))
}

/** Canonical blob payload for hashing (no blob id). */
export function canonicalizeBlobPayload(payload: BlobPayload): Record<string, unknown> {
  if (payload.kind === 'ink') {
    const path: Record<string, unknown> = {
      epsilon: q(payload.path.epsilon, 2),
      lineWidthRatio: q(payload.path.lineWidthRatio, 4),
      strokes: payload.path.strokes.map(s => ({
        points: s.points.map(pt => ({ x: q(pt.x), y: q(pt.y) })),
      })),
    }
    if (payload.path.captureAspect != null && Number.isFinite(payload.path.captureAspect)) {
      path.captureAspect = q(payload.path.captureAspect, 4)
    }
    return {
      t: 'ink',
      path,
    }
  }
  const row: Record<string, unknown> = {
    t: 'text',
    text: String(payload.text ?? '').slice(0, 500),
  }
  if (payload.fontSizeRatio != null) row.font = q(payload.fontSizeRatio, 4)
  if (payload.color) row.color = payload.color
  return row
}

export function blobPayloadToCanonicalJson(payload: BlobPayload): string {
  return JSON.stringify(canonicalizeBlobPayload(payload))
}

/** Full sha256 hex of blob payload. */
export async function computeBlobSha256(payload: BlobPayload): Promise<string> {
  return sha256HexBytes(utf8Buffer(blobPayloadToCanonicalJson(payload)))
}

/** First 16 bytes (32 hex) of payload hash - content-addressed blob id. */
export async function computeBlobId(payload: BlobPayload): Promise<string> {
  const full = await computeBlobSha256(payload)
  return full.slice(0, 32)
}

export async function makeContentBlob(payload: BlobPayload): Promise<ContentBlob> {
  const blobId = await computeBlobId(payload)
  // Re-canonicalize path so stored payload matches hash input
  if (payload.kind === 'ink') {
    const c = canonicalizeBlobPayload(payload) as {
      path: {
        epsilon: number
        lineWidthRatio: number
        captureAspect?: number
        strokes: SignaturePathData['strokes']
      }
    }
    const path: SignaturePathData = {
      epsilon: c.path.epsilon,
      lineWidthRatio: c.path.lineWidthRatio,
      strokes: c.path.strokes,
      ...(c.path.captureAspect != null ? { captureAspect: c.path.captureAspect } : {}),
    }
    return {
      blobId,
      payload: { kind: 'ink', path },
    }
  }
  const c = canonicalizeBlobPayload(payload) as {
    text: string
    font?: number
    color?: string
  }
  return {
    blobId,
    payload: {
      kind: 'text',
      text: c.text,
      ...(c.font != null ? { fontSizeRatio: c.font } : {}),
      ...(c.color ? { color: c.color } : {}),
    },
  }
}

/** People who have no placement slots assigned (any kind). */
export function peopleWithoutSlots(
  plan: Pick<ConstructionPlan, 'people' | 'slots'>,
): ConstructionPerson[] {
  const people = plan.people.length > 0 ? plan.people : []
  return people.filter(p => !plan.slots.some(s => s.personSlotIndex === p.slotIndex))
}

/** True when every person has ≥1 slot and the plan has at least one placement. */
export function planHasSlotPerPerson(
  plan: Pick<ConstructionPlan, 'people' | 'slots'>,
): boolean {
  if (plan.slots.length === 0) return false
  if (plan.people.length === 0) return false
  return peopleWithoutSlots(plan).length === 0
}

/** Human-readable lock blocker when someone still has zero fields. */
export function peopleWithoutSlotsMessage(
  plan: Pick<ConstructionPlan, 'people' | 'slots'>,
): string | null {
  const missing = peopleWithoutSlots(plan)
  if (missing.length === 0) return null
  const labels = missing.map(p => `Person ${p.slotIndex}`)
  if (labels.length === 1) {
    return `${labels[0]} has no fields yet — place at least one field for each person.`
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]} have no fields yet — place at least one field for each person.`
  }
  const last = labels[labels.length - 1]
  return `${labels.slice(0, -1).join(', ')}, and ${last} have no fields yet — place at least one field for each person.`
}

export function lockPlan(
  plan: ConstructionPlan,
  planRoot: string,
  lockedAt = Date.now(),
): ConstructionPlan {
  if (plan.slots.length === 0) {
    throw new Error('Add at least one placement before locking')
  }
  if (plan.people.length === 0) {
    throw new Error('Add at least one person before locking')
  }
  const missingMsg = peopleWithoutSlotsMessage(plan)
  if (missingMsg) {
    throw new Error(missingMsg)
  }
  const cs =
    plan.creatorSigningAs == null || plan.creatorSigningAs === 0
      ? null
      : plan.creatorSigningAs
  return {
    ...plan,
    pdfSha256: normalizeHex64(plan.pdfSha256),
    status: 'locked',
    lockedAt,
    planRoot: normalizeHex64(planRoot),
    // Explicit null so “organizer only” is never lost as undefined → open-claim Person 1
    creatorSigningAs: cs,
  }
}

/** Local draft re-open (pair with server unlock before anyone fills or signs). */
export function unlockPlanLocal(plan: ConstructionPlan): ConstructionPlan {
  const { planRoot: _root, lockedAt: _at, ...rest } = plan
  return {
    ...rest,
    status: 'draft',
    planRoot: undefined,
    lockedAt: undefined,
  }
}

/** Build batch 0 from a locked plan (places only; no fills yet). */
export function planLockBatch(plan: ConstructionPlan): PlacementBatch {
  if (plan.status !== 'locked' || !plan.planRoot) {
    throw new Error('Plan must be locked with planRoot before packing')
  }
  return {
    batchIndex: 0,
    prevRoot: ZERO_ROOT,
    pdfSha256: normalizeHex64(plan.pdfSha256),
    planRoot: normalizeHex64(plan.planRoot),
    people: plan.people,
    places: plan.slots,
    blobs: [],
    fills: [],
  }
}

/**
 * Build a fill batch. Only includes blobs whose ids are not in knownBlobIds
 * (dedup: same ink for two slots → one BLOB, two FILLs).
 */
export async function buildFillBatch(args: {
  batchIndex: number
  prevRoot: string
  pdfSha256: string
  planRoot: string
  fills: Array<{ slotId: string; personSlotIndex: number; payload: BlobPayload }>
  knownBlobIds: ReadonlySet<string>
}): Promise<PlacementBatch> {
  const blobs: ContentBlob[] = []
  const fills: SlotFill[] = []
  const emitted = new Set<string>()

  for (const f of args.fills) {
    const blob = await makeContentBlob(f.payload)
    fills.push({
      slotId: f.slotId,
      blobId: blob.blobId,
      personSlotIndex: f.personSlotIndex,
    })
    if (!args.knownBlobIds.has(blob.blobId) && !emitted.has(blob.blobId)) {
      blobs.push(blob)
      emitted.add(blob.blobId)
    }
  }

  return {
    batchIndex: args.batchIndex,
    prevRoot: normalizeHex64(args.prevRoot),
    pdfSha256: normalizeHex64(args.pdfSha256),
    planRoot: normalizeHex64(args.planRoot),
    blobs,
    fills,
  }
}

/** Collect all blob ids already present across batches. */
export function collectKnownBlobIds(batches: PlacementBatch[]): Set<string> {
  const ids = new Set<string>()
  for (const b of batches) {
    for (const blob of b.blobs) ids.add(blob.blobId)
    for (const f of b.fills) ids.add(f.blobId)
  }
  return ids
}
