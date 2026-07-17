const IS_PRODUCTION = process.env.NODE_ENV === 'production'

export function assertSafeBootConfig(): void {
  if (process.env.SKIP_CHAIN_VERIFY === 'true' && IS_PRODUCTION) {
    console.error('FATAL: SKIP_CHAIN_VERIFY=true is not allowed when NODE_ENV=production')
    process.exit(1)
  }
}

export function resolveCorsOrigin(): string | string[] | true {
  const raw = process.env.CORS_ORIGIN
  if (!raw || raw.trim() === '') {
    if (IS_PRODUCTION) {
      console.error('FATAL: CORS_ORIGIN must be set explicitly when NODE_ENV=production')
      process.exit(1)
    }
    return true
  }
  if (raw === '*') {
    if (IS_PRODUCTION) {
      console.error('FATAL: CORS_ORIGIN=* is not allowed when NODE_ENV=production')
      process.exit(1)
    }
    return true
  }
  return raw.split(',').map(origin => origin.trim()).filter(Boolean)
}

/** Keep in sync with client/src/fieldLimits.ts */
export const MAX_TITLE_LENGTH = 120
export const MAX_DISPLAY_NAME_LENGTH = 48
export const MAX_NOTE_LENGTH = 256
export const MAX_RENTAL_FIELD_LENGTH = 120
export const MAX_FILENAME_LENGTH = 255

function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '')
}

export function sanitizeDisplayName(name: string | undefined, fallback: string): string {
  const cleaned = stripControlChars(name ?? fallback)
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
  return cleaned || fallback
}

export function sanitizeTitle(title: string | undefined, fallback = 'Untitled agreement'): string {
  const cleaned = stripControlChars(title ?? '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
  return cleaned || fallback
}

export function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null
  const cleaned = stripControlChars(name)
    .replace(/[/\\]/g, '_')
    .trim()
    .slice(0, MAX_FILENAME_LENGTH)
  return cleaned || null
}

const EMAIL_MAX_LENGTH = 254
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Optional creator notify email — returns null if empty; throws if invalid. */
export function sanitizeNotifyEmail(value: string | undefined | null): string | null {
  if (value == null) return null
  const cleaned = stripControlChars(value).trim().toLowerCase().slice(0, EMAIL_MAX_LENGTH)
  if (!cleaned) return null
  if (!EMAIL_RE.test(cleaned) || cleaned.includes('..')) {
    throw new Error('Invalid notification email address')
  }
  return cleaned
}

export const DOCUMENT_TYPES = ['rental', 'contract', 'nda', 'other'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export function sanitizeDocumentType(type: string | undefined): DocumentType {
  if (type && (DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return type as DocumentType
  }
  return 'other'
}

function sanitizeMetadataString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = stripControlChars(value).trim().slice(0, maxLength)
  return cleaned || undefined
}

export function sanitizeDocumentMetadata(
  type: DocumentType,
  metadata: Record<string, unknown> | undefined | null,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null

  if (type === 'rental') {
    const result: Record<string, string> = {}
    for (const field of ['propertyAddress', 'monthlyRent', 'deposit', 'startDate', 'endDate'] as const) {
      const cleaned = sanitizeMetadataString(metadata[field], MAX_RENTAL_FIELD_LENGTH)
      if (cleaned) result[field] = cleaned
    }
    return Object.keys(result).length > 0 ? result : null
  }

  if (type === 'nda' || type === 'other') {
    const notes = sanitizeMetadataString(metadata.notes, MAX_NOTE_LENGTH)
    return notes ? { notes } : null
  }

  return null
}

/**
 * Per-document caps (1 credit ≈ 1 seal). Keep aligned with client
 * `pdf/annotationLimits.ts`.
 */
export const MAX_SIGNATURE_ANNOTATIONS = 4
export const MAX_TEXT_ANNOTATIONS = 12
export const MAX_MARK_ANNOTATIONS = 24
/** Max annotations per document (create-time overlays). */
export const MAX_ANNOTATIONS =
  MAX_SIGNATURE_ANNOTATIONS + MAX_TEXT_ANNOTATIONS + MAX_MARK_ANNOTATIONS
/** Max base64/data-URL length for a single signature image annotation (~96 KiB raw). */
export const MAX_ANNOTATION_IMAGE_CHARS = 160_000
/** Max text length for a text stamp annotation. */
export const MAX_ANNOTATION_TEXT_LENGTH = 500
/** Max total serialized annotations JSON size. */
export const MAX_ANNOTATIONS_JSON_CHARS = 1_500_000
/** Max points across all strokes in one signature path. */
export const MAX_SIGNATURE_PATH_POINTS = 2_000
/** Max strokes per signature path. */
export const MAX_SIGNATURE_PATH_STROKES = 64

function clampNorm(n: unknown): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

function sanitizeAnnotationId(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const cleaned = stripControlChars(raw).trim().slice(0, 64)
  return cleaned || fallback
}

/**
 * Sanitize client PDF annotations for storage.
 * Returns null when empty/omitted; throws on invalid payloads.
 * Never accepts PDF file bytes — only overlay geometry + small images/text.
 */
export function sanitizeAnnotations(input: unknown): unknown[] | null {
  if (input == null) return null
  if (!Array.isArray(input)) {
    throw new Error('annotations must be an array')
  }
  if (input.length === 0) return null
  if (input.length > MAX_ANNOTATIONS) {
    throw new Error(`Too many annotations (max ${MAX_ANNOTATIONS})`)
  }

  const out: unknown[] = []
  let signatureCount = 0
  let textCount = 0
  let markCount = 0
  for (let i = 0; i < input.length; i++) {
    const item = input[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Invalid annotation at index ${i}`)
    }
    const a = item as Record<string, unknown>
    const type = a.type
    if (type !== 'signature' && type !== 'text' && type !== 'checkmark' && type !== 'cross') {
      throw new Error(`Unsupported annotation type at index ${i}`)
    }

    const pageIndex = Number(a.pageIndex)
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 500) {
      throw new Error(`Invalid pageIndex at annotation ${i}`)
    }

    const x = clampNorm(a.x)
    const y = clampNorm(a.y)
    const width = clampNorm(a.width)
    const height = clampNorm(a.height)
    if (x == null || y == null || width == null || height == null) {
      throw new Error(`Invalid geometry at annotation ${i}`)
    }
    if (width <= 0 || height <= 0) {
      throw new Error(`Annotation ${i} must have positive size`)
    }

    const base = {
      id: sanitizeAnnotationId(a.id, `ann_${i}`),
      type,
      pageIndex,
      x,
      y,
      width,
      height,
      ...(typeof a.pageWidthPts === 'number' && Number.isFinite(a.pageWidthPts)
        ? { pageWidthPts: a.pageWidthPts }
        : {}),
      ...(typeof a.pageHeightPts === 'number' && Number.isFinite(a.pageHeightPts)
        ? { pageHeightPts: a.pageHeightPts }
        : {}),
    }

    if (type === 'signature') {
      signatureCount++
      if (signatureCount > MAX_SIGNATURE_ANNOTATIONS) {
        throw new Error(`Too many signature annotations (max ${MAX_SIGNATURE_ANNOTATIONS} per credit)`)
      }
      const rawImg =
        typeof a.imageDataUrl === 'string'
          ? a.imageDataUrl
          : typeof a.imageData === 'string'
            ? a.imageData
            : null
      if (!rawImg) throw new Error(`Signature annotation ${i} missing imageDataUrl`)
      const trimmed = rawImg.trim()
      if (trimmed.length > MAX_ANNOTATION_IMAGE_CHARS) {
        throw new Error(`Signature annotation ${i} image too large`)
      }
      // Accept data URL or bare base64; require PNG-ish payload (no raw PDF).
      if (/%PDF-|JVBER/i.test(trimmed.slice(0, 32))) {
        throw new Error('PDF bytes are not allowed in annotations')
      }
      const dataUrl = trimmed.startsWith('data:')
        ? trimmed
        : `data:image/png;base64,${trimmed}`
      if (!/^data:image\/png;base64,/i.test(dataUrl)) {
        throw new Error(`Signature annotation ${i} must be a PNG data URL`)
      }
      const path = sanitizeSignaturePath(a.path, i)
      out.push({
        ...base,
        type: 'signature',
        imageDataUrl: dataUrl,
        ...(path ? { path } : {}),
      })
      continue
    }

    if (type === 'checkmark' || type === 'cross') {
      markCount++
      if (markCount > MAX_MARK_ANNOTATIONS) {
        throw new Error(`Too many mark annotations (max ${MAX_MARK_ANNOTATIONS} per credit)`)
      }
      let color = type === 'checkmark' ? '#0f766e' : '#b91c1c'
      if (typeof a.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.color.trim())) {
        color = a.color.trim()
      }
      out.push({ ...base, type, color })
      continue
    }

    // text
    textCount++
    if (textCount > MAX_TEXT_ANNOTATIONS) {
      throw new Error(`Too many text annotations (max ${MAX_TEXT_ANNOTATIONS} per credit)`)
    }
    const text = stripControlChars(String(a.text ?? '')).trim().slice(0, MAX_ANNOTATION_TEXT_LENGTH)
    if (!text) throw new Error(`Text annotation ${i} is empty`)
    const fontSizeRatio =
      typeof a.fontSizeRatio === 'number' && Number.isFinite(a.fontSizeRatio)
        ? Math.min(0.2, Math.max(0.005, a.fontSizeRatio))
        : 0.025
    let color = '#0f172a'
    if (typeof a.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.color.trim())) {
      color = a.color.trim()
    }
    out.push({ ...base, type: 'text', text, fontSizeRatio, color })
  }

  const serialized = JSON.stringify(out)
  if (serialized.length > MAX_ANNOTATIONS_JSON_CHARS) {
    throw new Error('Annotations payload too large')
  }
  return out
}

/** RDP vector path in unit square (optional on signature annotations). */
function sanitizeSignaturePath(raw: unknown, annIndex: number): Record<string, unknown> | null {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid signature path at annotation ${annIndex}`)
  }
  const p = raw as Record<string, unknown>
  const strokesRaw = p.strokes
  if (!Array.isArray(strokesRaw) || strokesRaw.length === 0) return null
  if (strokesRaw.length > MAX_SIGNATURE_PATH_STROKES) {
    throw new Error(`Too many strokes on signature ${annIndex}`)
  }

  let totalPoints = 0
  const strokes: Array<{ points: Array<{ x: number; y: number }> }> = []
  for (let s = 0; s < strokesRaw.length; s++) {
    const stroke = strokesRaw[s]
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) {
      throw new Error(`Invalid stroke ${s} on signature ${annIndex}`)
    }
    const pts = (stroke as { points?: unknown }).points
    if (!Array.isArray(pts) || pts.length === 0) continue
    totalPoints += pts.length
    if (totalPoints > MAX_SIGNATURE_PATH_POINTS) {
      throw new Error(`Too many path points on signature ${annIndex}`)
    }
    const points: Array<{ x: number; y: number }> = []
    for (const pt of pts) {
      if (!pt || typeof pt !== 'object' || Array.isArray(pt)) continue
      const x = clampNorm((pt as { x?: unknown }).x)
      const y = clampNorm((pt as { y?: unknown }).y)
      if (x == null || y == null) continue
      points.push({ x, y })
    }
    if (points.length > 0) strokes.push({ points })
  }
  if (strokes.length === 0) return null

  const epsilon =
    typeof p.epsilon === 'number' && Number.isFinite(p.epsilon)
      ? Math.min(32, Math.max(0, p.epsilon))
      : 1.5
  const lineWidthRatio =
    typeof p.lineWidthRatio === 'number' && Number.isFinite(p.lineWidthRatio)
      ? Math.min(0.2, Math.max(0.001, p.lineWidthRatio))
      : 0.02

  return { epsilon, lineWidthRatio, strokes }
}