/**
 * Supported local document kinds for VeriLock fingerprint / seal flows.
 * Files stay on-device; only SHA-256 is sent to the server.
 */

export type DocumentKind = 'pdf' | 'image'

const PDF_EXTS = ['.pdf'] as const
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'] as const

const PDF_MIMES = new Set(['application/pdf', 'application/x-pdf'])
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

/** HTML accept attribute for file inputs (PDF + images). */
export const DOCUMENT_ACCEPT =
  'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'

/** User-facing list of allowed formats. */
export const DOCUMENT_FORMATS_LABEL = 'PDF, PNG, JPEG, or WebP'

export function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return ''
  return lower.slice(dot)
}

export function detectDocumentKind(file: File): DocumentKind | null {
  const ext = extensionOf(file.name)
  const type = (file.type || '').toLowerCase().trim()

  if (PDF_EXTS.includes(ext as (typeof PDF_EXTS)[number]) || PDF_MIMES.has(type)) {
    return 'pdf'
  }
  if (IMAGE_EXTS.includes(ext as (typeof IMAGE_EXTS)[number]) || IMAGE_MIMES.has(type)) {
    return 'image'
  }
  // Some browsers report empty type for dropped files — trust extension only.
  return null
}

export function isSupportedDocumentFile(file: File): boolean {
  return detectDocumentKind(file) !== null
}

export function isPdfDocumentFile(file: File): boolean {
  return detectDocumentKind(file) === 'pdf'
}

export function isImageDocumentFile(file: File): boolean {
  return detectDocumentKind(file) === 'image'
}

/** Strip known document extensions for default titles. */
export function stripDocumentExtension(filename: string): string {
  return filename.replace(/\.(pdf|png|jpe?g|webp)$/i, '')
}

/**
 * Best-effort MIME for share / .eml packaging when File.type is empty.
 */
export function mimeForDocumentFile(file: File): string {
  const type = (file.type || '').toLowerCase().trim()
  if (type && type !== 'application/octet-stream') return type

  const ext = extensionOf(file.name)
  switch (ext) {
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return type || 'application/octet-stream'
  }
}

/** Infer kind from a stored filename (share copy, agreement metadata). */
export function detectDocumentKindFromName(filename: string | null | undefined): DocumentKind | null {
  if (!filename) return null
  const ext = extensionOf(filename)
  if (PDF_EXTS.includes(ext as (typeof PDF_EXTS)[number])) return 'pdf'
  if (IMAGE_EXTS.includes(ext as (typeof IMAGE_EXTS)[number])) return 'image'
  return null
}

/** Short noun for UI: "PDF" vs "file" when kind unknown. */
export function documentFileNoun(
  fileOrName: File | string | null | undefined,
): 'PDF' | 'file' {
  if (!fileOrName) return 'file'
  const kind =
    typeof fileOrName === 'string'
      ? detectDocumentKindFromName(fileOrName)
      : detectDocumentKind(fileOrName)
  return kind === 'pdf' ? 'PDF' : 'file'
}

export function unsupportedDocumentMessage(): string {
  return `Please choose a ${DOCUMENT_FORMATS_LABEL} file`
}
