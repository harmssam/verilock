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