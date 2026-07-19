/**
 * PDF annotations stored server-side as JSON — never requires pdf-lib.
 * Coordinates are normalized fractions of the rendered page (origin top-left),
 * so placement is independent of zoom/DPI when reconstructing with pdf.js.
 */

export type PdfAnnotationType = 'signature' | 'text' | 'checkmark' | 'cross'

/** Shared geometry — all values are normalized [0, 1] relative to page size. */
export interface AnnotationGeometry {
  /** 0-based page index */
  pageIndex: number
  /** Left edge as fraction of page width (0 = left) */
  x: number
  /** Top edge as fraction of page height (0 = top) */
  y: number
  /** Width as fraction of page width */
  width: number
  /** Height as fraction of page height */
  height: number
  /** Optional media-box size in PDF points at placement (debug / validation) */
  pageWidthPts?: number
  pageHeightPts?: number
}

/** Stroke path in signature-local space (0–1 within the placed box). */
export interface SignaturePathStroke {
  points: Array<{ x: number; y: number }>
}

/**
 * Canonical signature ink for later on-chain packing.
 * Prefer this over PNG when present; imageDataUrl is preview/fallback.
 *
 * Points are in [0,1]² relative to the capture pad (x / padW, y / padH).
 * When `captureAspect` (padW/padH) is set, paint letterboxes into the target
 * box so strokes are not stretched if the field shape differs.
 */
export interface SignaturePathData {
  /** RDP epsilon used at capture (pad CSS pixels). */
  epsilon: number
  /** Stroke width as fraction of min(box width, box height) in CSS at capture. */
  lineWidthRatio: number
  strokes: SignaturePathStroke[]
  /**
   * Capture pad width ÷ height. Used to paint without distortion.
   * Omit only for legacy paths (paint stretches to the field).
   */
  captureAspect?: number
}

export interface SignatureAnnotation extends AnnotationGeometry {
  id: string
  type: 'signature'
  /** data:image/png;base64,... — UI preview / fallback when path missing */
  imageDataUrl: string
  /** Simplified vector ink (RDP). Primary for reconstruction / future chain. */
  path?: SignaturePathData
}

export interface TextAnnotation extends AnnotationGeometry {
  id: string
  type: 'text'
  text: string
  /** Font size as fraction of page height (default ~0.02) */
  fontSizeRatio?: number
  color?: string
}

/** Simple vector mark — no image payload; ideal for on-chain. */
export interface MarkAnnotation extends AnnotationGeometry {
  id: string
  type: 'checkmark' | 'cross'
  color?: string
}

export type PdfAnnotation = SignatureAnnotation | TextAnnotation | MarkAnnotation

export interface CanvasRect {
  left: number
  top: number
  width: number
  height: number
}

const EPS = 1e-9

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** Canvas/CSS pixels → normalized page geometry (top-left origin). */
export function canvasRectToNormalized(
  rect: CanvasRect,
  canvasWidth: number,
  canvasHeight: number,
  pageIndex: number,
  pageWidthPts?: number,
  pageHeightPts?: number,
): AnnotationGeometry {
  const w = Math.max(EPS, canvasWidth)
  const h = Math.max(EPS, canvasHeight)
  return {
    pageIndex,
    x: clamp01(rect.left / w),
    y: clamp01(rect.top / h),
    width: clamp01(rect.width / w),
    height: clamp01(rect.height / h),
    ...(pageWidthPts != null ? { pageWidthPts } : {}),
    ...(pageHeightPts != null ? { pageHeightPts } : {}),
  }
}

/** Normalized geometry → canvas/CSS pixels for the current render size. */
export function normalizedToCanvasRect(
  geo: AnnotationGeometry,
  canvasWidth: number,
  canvasHeight: number,
): CanvasRect {
  return {
    left: geo.x * canvasWidth,
    top: geo.y * canvasHeight,
    width: geo.width * canvasWidth,
    height: geo.height * canvasHeight,
  }
}

/**
 * Sub-rect inside `outer` that matches `captureAspect` (width/height), centered
 * (“contain”). Prevents signature stretch when field shape ≠ pad shape.
 */
export function fitCaptureRect(outer: CanvasRect, captureAspect: number): CanvasRect {
  const aspect = Number.isFinite(captureAspect) && captureAspect > 0.05 ? captureAspect : 1
  let width = outer.width
  let height = width / aspect
  if (height > outer.height) {
    height = outer.height
    width = height * aspect
  }
  return {
    left: outer.left + (outer.width - width) / 2,
    top: outer.top + (outer.height - height) / 2,
    width,
    height,
  }
}

/** Paint signature path into a screen rect (path coords are 0–1 on the capture pad). */
export function paintSignaturePath(
  ctx: CanvasRenderingContext2D,
  path: SignaturePathData,
  rect: CanvasRect,
  color = '#0f172a',
): void {
  // With captureAspect: letterbox so strokes keep pad proportions.
  // Without (legacy): stretch to full field (old unit-square behaviour).
  const drawRect =
    path.captureAspect != null && path.captureAspect > 0
      ? fitCaptureRect(rect, path.captureAspect)
      : rect
  const minSide = Math.min(drawRect.width, drawRect.height)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(1, path.lineWidthRatio * minSide)
  for (const stroke of path.strokes) {
    if (stroke.points.length === 0) continue
    ctx.beginPath()
    const p0 = stroke.points[0]!
    ctx.moveTo(drawRect.left + p0.x * drawRect.width, drawRect.top + p0.y * drawRect.height)
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i]!
      ctx.lineTo(drawRect.left + p.x * drawRect.width, drawRect.top + p.y * drawRect.height)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * Draw a single annotation onto a 2d context that already has the PDF page
 * rendered at (0,0) with size canvasWidth × canvasHeight (CSS pixels).
 */
export async function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: PdfAnnotation,
  canvasWidth: number,
  canvasHeight: number,
): Promise<void> {
  const rect = normalizedToCanvasRect(annotation, canvasWidth, canvasHeight)
  if (annotation.type === 'signature') {
    if (annotation.path && annotation.path.strokes.length > 0) {
      paintSignaturePath(ctx, annotation.path, rect)
      return
    }
    if (annotation.imageDataUrl) {
      const img = await loadImage(annotation.imageDataUrl)
      ctx.drawImage(img, rect.left, rect.top, rect.width, rect.height)
    }
    return
  }
  if (annotation.type === 'checkmark' || annotation.type === 'cross') {
    paintMark(ctx, annotation.type, rect, annotation.color ?? '#0f766e')
    return
  }
  if (annotation.type !== 'text') return
  const ratio = annotation.fontSizeRatio ?? 0.025
  const fontPx = Math.max(8, ratio * canvasHeight)
  ctx.save()
  ctx.fillStyle = annotation.color ?? '#0f172a'
  ctx.font = `${fontPx}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textBaseline = 'top'
  const maxWidth = Math.max(1, rect.width)
  wrapFillText(ctx, annotation.text, rect.left, rect.top, maxWidth, fontPx * 1.25)
  ctx.restore()
}

export function paintMark(
  ctx: CanvasRenderingContext2D,
  kind: 'checkmark' | 'cross',
  rect: CanvasRect,
  color: string,
): void {
  const pad = Math.min(rect.width, rect.height) * 0.15
  const x0 = rect.left + pad
  const y0 = rect.top + pad
  const x1 = rect.left + rect.width - pad
  const y1 = rect.top + rect.height - pad
  const lw = Math.max(2, Math.min(rect.width, rect.height) * 0.12)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (kind === 'checkmark') {
    const midX = x0 + (x1 - x0) * 0.32
    const midY = y1 - (y1 - y0) * 0.08
    ctx.moveTo(x0, y0 + (y1 - y0) * 0.45)
    ctx.lineTo(midX, midY)
    ctx.lineTo(x1, y0)
  } else {
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
    ctx.moveTo(x1, y0)
    ctx.lineTo(x0, y1)
  }
  ctx.stroke()
  ctx.restore()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load annotation image'))
    img.src = ensureDataUrl(src)
  })
}

export function ensureDataUrl(imageDataUrl: string): string {
  const t = imageDataUrl.trim()
  if (t.startsWith('data:')) return t
  return `data:image/png;base64,${t}`
}

function wrapFillText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return
  let line = ''
  let cy = y
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, cy)
      line = word
      cy += lineHeight
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, cy)
}

export function newAnnotationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Strip heavy fields for logging / POST size checks (no image bytes). */
export function annotationsWithoutImageBytes(
  annotations: PdfAnnotation[],
): Array<
  Omit<PdfAnnotation, 'imageDataUrl'> & {
    imageDataUrl?: string
    hasImage?: boolean
    hasPath?: boolean
  }
> {
  return annotations.map(a => {
    if (a.type === 'signature') {
      const { imageDataUrl: _img, ...rest } = a
      return {
        ...rest,
        hasImage: Boolean(_img),
        hasPath: Boolean(a.path?.strokes?.length),
      }
    }
    return a
  })
}

/** Count points in a signature path (for UI / size hints). */
export function countPathPoints(path: SignaturePathData | undefined): number {
  if (!path) return 0
  return path.strokes.reduce((n, s) => n + s.points.length, 0)
}

/** True if value looks like a create-document body that accidentally includes PDF bytes. */
export function bodyContainsPdfBytes(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false
  const o = body as Record<string, unknown>
  const keys = ['pdf', 'pdfBytes', 'file', 'fileBytes', 'documentBytes', 'content', 'data']
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'string' && v.length > 200 && (/^JVBER/i.test(v) || v.includes('%PDF'))) {
      return true
    }
    if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) return true
  }
  return false
}
