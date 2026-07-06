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

export function sanitizeDisplayName(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? fallback)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 48)
  return cleaned || fallback
}

export function sanitizeFilename(name: string | undefined): string | null {
  if (!name) return null
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '_')
    .trim()
    .slice(0, 255)
  return cleaned || null
}

export const DOCUMENT_TYPES = ['rental', 'contract', 'nda', 'other'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

const MAX_NOTE_LENGTH = 256
const MAX_RENTAL_FIELD_LENGTH = 120

export function sanitizeDocumentType(type: string | undefined): DocumentType {
  if (type && (DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return type as DocumentType
  }
  return 'other'
}

function sanitizeMetadataString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength)
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