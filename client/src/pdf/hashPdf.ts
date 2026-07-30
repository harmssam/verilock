import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfWorkerReady: Promise<void> | null = null

const STALE_CHUNK =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

function mapPdfImportError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (STALE_CHUNK.test(msg)) {
    return new Error(
      'VeriLock was updated while this tab was open. Refresh the page, then try the document again.',
    )
  }
  return err instanceof Error ? err : new Error(String(err ?? 'Document library failed to load'))
}

function ensurePdfWorker(): Promise<void> {
  if (!pdfWorkerReady) {
    pdfWorkerReady = import('pdfjs-dist')
      .then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      })
      .catch(err => {
        pdfWorkerReady = null
        throw mapPdfImportError(err)
      })
  }
  return pdfWorkerReady
}

/** SHA-256 needs Web Crypto (`crypto.subtle`), which browsers only expose in a secure context. */
function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (subtle) return subtle
  const host = typeof location !== 'undefined' ? location.hostname : ''
  const viaLanIp = Boolean(host && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.local'))
  throw new Error(
    viaLanIp
      ? 'Document fingerprinting needs a secure context (HTTPS or localhost). ' +
          'This page is open over plain HTTP on a network address, so the browser blocks crypto. ' +
          'On this machine use http://localhost:5176 — or open the phone via HTTPS / a tunnel for mobile testing.'
      : 'Document fingerprinting needs a secure context (HTTPS or localhost). ' +
          'Open VeriLock over HTTPS or http://localhost and try again.',
  )
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await requireSubtleCrypto().digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function shortHash(hash: string, chars = 8): string {
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`
}

export async function getPdfPageCount(file: File): Promise<number> {
  try {
    await ensurePdfWorker()
    const pdfjs = await import('pdfjs-dist')
    const buffer = await file.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: buffer }).promise
    return doc.numPages
  } catch (err) {
    throw mapPdfImportError(err)
  }
}