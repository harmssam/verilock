/**
 * Signature encoding experiments — strokes, simplification, size estimates.
 * Pure helpers (no React). Used by SignatureLab demo.
 */

/** Point in pad space (CSS pixels at capture time). */
export interface StrokePoint {
  x: number
  y: number
  /** Optional pressure 0–1 */
  p?: number
}

export interface Stroke {
  points: StrokePoint[]
}

export interface SignatureInk {
  /** Logical pad size when captured (CSS px). */
  width: number
  height: number
  strokes: Stroke[]
  lineWidth: number
}

/** Nimiq basic-tx data budget (documented project limit). */
export const NIMIQ_PAYLOAD_BYTES = 64
/** Bytes reserved for frame header (magic, type, docKey, seq, …). */
export const FRAME_HEADER_BYTES = 8
export const FRAME_PAYLOAD_BYTES = NIMIQ_PAYLOAD_BYTES - FRAME_HEADER_BYTES

export function countPoints(ink: SignatureInk): number {
  return ink.strokes.reduce((n, s) => n + s.points.length, 0)
}

export function cloneInk(ink: SignatureInk): SignatureInk {
  return {
    width: ink.width,
    height: ink.height,
    lineWidth: ink.lineWidth,
    strokes: ink.strokes.map(s => ({
      points: s.points.map(p => ({ x: p.x, y: p.y, ...(p.p != null ? { p: p.p } : {}) })),
    })),
  }
}

/** Perpendicular distance from point to segment a→b. */
function distToSegment(p: StrokePoint, a: StrokePoint, b: StrokePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) {
    const ex = p.x - a.x
    const ey = p.y - a.y
    return Math.hypot(ex, ey)
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

/** Ramer–Douglas–Peucker polyline simplification (pixel epsilon). */
export function simplifyStroke(points: StrokePoint[], epsilon: number): StrokePoint[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice()

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]!
  const last = points[points.length - 1]!
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i]!, first, last)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyStroke(points.slice(0, maxIdx + 1), epsilon)
    const right = simplifyStroke(points.slice(maxIdx), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [first, last]
}

export function simplifyInk(ink: SignatureInk, epsilon: number): SignatureInk {
  return {
    ...ink,
    strokes: ink.strokes.map(s => ({
      points: simplifyStroke(s.points, epsilon),
    })),
  }
}

/** Normalize points to [0,1]² relative to pad (for portable encoding). */
export function normalizeInk(ink: SignatureInk): SignatureInk {
  const w = Math.max(1, ink.width)
  const h = Math.max(1, ink.height)
  return {
    width: 1,
    height: 1,
    lineWidth: ink.lineWidth / Math.min(w, h),
    strokes: ink.strokes.map(s => ({
      points: s.points.map(p => ({
        x: p.x / w,
        y: p.y / h,
        ...(p.p != null ? { p: p.p } : {}),
      })),
    })),
  }
}

/** Quantize normalized coords to N-bit fixed point (0..2^bits-1). */
export function quantizeInk(ink: SignatureInk, bits: number): SignatureInk {
  const max = (1 << bits) - 1
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * max) / max
  return {
    ...ink,
    strokes: ink.strokes.map(s => ({
      points: s.points.map(p => ({
        x: q(p.x),
        y: q(p.y),
        ...(p.p != null ? { p: p.p } : {}),
      })),
    })),
  }
}

/**
 * Estimate binary path size (no image codecs).
 * Layout: version(1) + padWH optional skip when normalized + strokeCount(1)
 * + per stroke: pointCount(2) + points as delta-coded int16 or fixed-bit abs.
 */
export function estimateBinaryPathBytes(
  ink: SignatureInk,
  opts: { bitsPerCoord?: number; delta?: boolean } = {},
): number {
  const bits = opts.bitsPerCoord ?? 12
  const delta = opts.delta ?? true
  // Pack two coords into ceil(2*bits/8) bytes (e.g. 12-bit pair → 3 B)
  const packedPairBytes = Math.ceil((bits * 2) / 8)

  let bytes = 1 + 1 // version + strokeCount
  bytes += 2 // lineWidth as u16 millis

  for (const stroke of ink.strokes) {
    bytes += 2 // point count
    if (stroke.points.length === 0) continue
    if (delta) {
      // first point absolute (packed pair), then delta as int8/int16
      bytes += packedPairBytes
      // deltas: assume 1 byte each axis after normalize (most local motion)
      bytes += Math.max(0, stroke.points.length - 1) * 2
    } else {
      bytes += stroke.points.length * packedPairBytes
    }
  }
  return bytes
}

/** SVG path `d` attribute only (no XML wrapper). */
export function inkToSvgPathD(ink: SignatureInk, precision = 2): string {
  const parts: string[] = []
  const f = (n: number) => n.toFixed(precision).replace(/\.?0+$/, '')
  for (const stroke of ink.strokes) {
    if (stroke.points.length === 0) continue
    const [first, ...rest] = stroke.points
    parts.push(`M${f(first!.x)} ${f(first!.y)}`)
    for (const p of rest) {
      parts.push(`L${f(p.x)} ${f(p.y)}`)
    }
  }
  return parts.join('')
}

export function inkToSvgDocument(ink: SignatureInk, strokeColor = '#0f172a'): string {
  const d = inkToSvgPathD(ink, 2)
  const lw = ink.lineWidth
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ink.width} ${ink.height}" ` +
    `width="${ink.width}" height="${ink.height}" fill="none">` +
    `<path d="${d}" stroke="${strokeColor}" stroke-width="${lw}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  )
}

export function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

export function framesForBytes(payloadBytes: number): number {
  if (payloadBytes <= 0) return 0
  return Math.ceil(payloadBytes / FRAME_PAYLOAD_BYTES)
}

export interface EncodingRow {
  id: string
  label: string
  detail: string
  bytes: number
  points?: number
  frames: number
}

/** Rasterize ink to canvas at given CSS size (devicePixelRatio=1 for stable sizes). */
export function renderInkToCanvas(
  ink: SignatureInk,
  outWidth: number,
  outHeight: number,
  options?: { lineScale?: number; color?: string },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(outWidth))
  canvas.height = Math.max(1, Math.round(outHeight))
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = options?.color ?? '#0f172a'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const sx = canvas.width / Math.max(1e-6, ink.width)
  const sy = canvas.height / Math.max(1e-6, ink.height)
  const scale = Math.min(sx, sy)
  ctx.lineWidth = Math.max(1, ink.lineWidth * scale * (options?.lineScale ?? 1))

  for (const stroke of ink.strokes) {
    if (stroke.points.length === 0) continue
    ctx.beginPath()
    const p0 = stroke.points[0]!
    ctx.moveTo(p0.x * sx, p0.y * sy)
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i]!
      ctx.lineTo(p.x * sx, p.y * sy)
    }
    ctx.stroke()
  }
  return canvas
}

export async function canvasPngBytes(canvas: HTMLCanvasElement): Promise<number> {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  return blob?.size ?? 0
}

/** Optional palette-ish recompress: draw small, export PNG. */
export async function measurePngVariants(ink: SignatureInk): Promise<EncodingRow[]> {
  const variants: Array<{ id: string; label: string; w: number; h: number }> = [
    { id: 'png-native', label: 'PNG · pad resolution', w: ink.width, h: ink.height },
    { id: 'png-320', label: 'PNG · max width 320', w: 320, h: Math.round((320 * ink.height) / ink.width) },
    { id: 'png-160', label: 'PNG · max width 160', w: 160, h: Math.round((160 * ink.height) / ink.width) },
    { id: 'png-80', label: 'PNG · max width 80', w: 80, h: Math.round((80 * ink.height) / ink.width) },
  ]

  const rows: EncodingRow[] = []
  for (const v of variants) {
    const c = renderInkToCanvas(ink, v.w, Math.max(1, v.h))
    const bytes = await canvasPngBytes(c)
    rows.push({
      id: v.id,
      label: v.label,
      detail: `${c.width}×${c.height}px`,
      bytes,
      frames: framesForBytes(bytes),
    })
  }
  return rows
}

export function measureVectorRows(
  ink: SignatureInk,
  simplified: SignatureInk,
  epsilon: number,
): EncodingRow[] {
  const rawPts = countPoints(ink)
  const simpPts = countPoints(simplified)

  const svgRaw = inkToSvgDocument(ink)
  const svgSimp = inkToSvgDocument(simplified)
  const pathDRaw = inkToSvgPathD(ink)
  const pathDSimp = inkToSvgPathD(simplified)

  const norm = normalizeInk(simplified)
  const q12 = quantizeInk(norm, 12)
  const q8 = quantizeInk(norm, 8)

  const binRaw = estimateBinaryPathBytes(normalizeInk(ink), { bitsPerCoord: 12, delta: true })
  const binSimp12 = estimateBinaryPathBytes(q12, { bitsPerCoord: 12, delta: true })
  const binSimp8 = estimateBinaryPathBytes(q8, { bitsPerCoord: 8, delta: true })

  return [
    {
      id: 'path-raw',
      label: 'Binary path · raw strokes',
      detail: `${rawPts} pts · 12-bit Δ estimate`,
      bytes: binRaw,
      points: rawPts,
      frames: framesForBytes(binRaw),
    },
    {
      id: 'path-rdp',
      label: `Binary path · RDP ε=${epsilon.toFixed(1)}px`,
      detail: `${simpPts} pts · 12-bit Δ estimate`,
      bytes: binSimp12,
      points: simpPts,
      frames: framesForBytes(binSimp12),
    },
    {
      id: 'path-rdp-8',
      label: `Binary path · RDP + 8-bit`,
      detail: `${simpPts} pts · coarser quantize`,
      bytes: binSimp8,
      points: simpPts,
      frames: framesForBytes(binSimp8),
    },
    {
      id: 'svg-path-d',
      label: 'SVG path `d` only (simplified)',
      detail: 'text, no XML wrapper',
      bytes: utf8ByteLength(pathDSimp),
      points: simpPts,
      frames: framesForBytes(utf8ByteLength(pathDSimp)),
    },
    {
      id: 'svg-doc',
      label: 'Full SVG document (simplified)',
      detail: 'XML + path',
      bytes: utf8ByteLength(svgSimp),
      points: simpPts,
      frames: framesForBytes(utf8ByteLength(svgSimp)),
    },
    {
      id: 'svg-doc-raw',
      label: 'Full SVG document (raw)',
      detail: 'XML + path, all points',
      bytes: utf8ByteLength(svgRaw),
      points: rawPts,
      frames: framesForBytes(utf8ByteLength(svgRaw)),
    },
    {
      id: 'svg-d-raw',
      label: 'SVG path `d` only (raw)',
      detail: 'text, all points',
      bytes: utf8ByteLength(pathDRaw),
      points: rawPts,
      frames: framesForBytes(utf8ByteLength(pathDRaw)),
    },
  ]
}

export function paintInkOnCanvas(
  ctx: CanvasRenderingContext2D,
  ink: SignatureInk,
  cssWidth: number,
  cssHeight: number,
): void {
  const sx = cssWidth / Math.max(1e-6, ink.width)
  const sy = cssHeight / Math.max(1e-6, ink.height)
  ctx.save()
  ctx.strokeStyle = '#0f172a'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, ink.lineWidth * Math.min(sx, sy))
  for (const stroke of ink.strokes) {
    if (stroke.points.length === 0) continue
    ctx.beginPath()
    ctx.moveTo(stroke.points[0]!.x * sx, stroke.points[0]!.y * sy)
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i]!.x * sx, stroke.points[i]!.y * sy)
    }
    ctx.stroke()
  }
  ctx.restore()
}
