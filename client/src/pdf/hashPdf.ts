import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfWorkerReady: Promise<void> | null = null

function ensurePdfWorker(): Promise<void> {
  if (!pdfWorkerReady) {
    pdfWorkerReady = import('pdfjs-dist').then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    })
  }
  return pdfWorkerReady
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function shortHash(hash: string, chars = 8): string {
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`
}

export async function getPdfPageCount(file: File): Promise<number> {
  await ensurePdfWorker()
  const pdfjs = await import('pdfjs-dist')
  const buffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  return doc.numPages
}