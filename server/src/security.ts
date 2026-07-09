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