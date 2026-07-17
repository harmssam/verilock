/**
 * Shared pdf.js helpers — render pages client-side only.
 * No pdf-lib; PDF bytes never leave the browser for rendering.
 */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

let pdfWorkerReady: Promise<void> | null = null

const STALE_CHUNK =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i

function mapPdfImportError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (STALE_CHUNK.test(msg)) {
    return new Error(
      'VeriLock was updated while this tab was open. Refresh the page, then try the PDF again.',
    )
  }
  return err instanceof Error ? err : new Error(String(err ?? 'PDF library failed to load'))
}

export async function ensurePdfWorker(): Promise<void> {
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

export async function loadPdfFromFile(file: File): Promise<PDFDocumentProxy> {
  try {
    await ensurePdfWorker()
    const pdfjs = await import('pdfjs-dist')
    const data = new Uint8Array(await file.arrayBuffer())
    return await pdfjs.getDocument({ data }).promise
  } catch (err) {
    throw mapPdfImportError(err)
  }
}

export async function loadPdfFromBuffer(buffer: ArrayBuffer): Promise<PDFDocumentProxy> {
  try {
    await ensurePdfWorker()
    const pdfjs = await import('pdfjs-dist')
    return await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
  } catch (err) {
    throw mapPdfImportError(err)
  }
}

export interface RenderedPage {
  page: PDFPageProxy
  canvas: HTMLCanvasElement
  /** CSS pixel size (may differ from canvas.width when devicePixelRatio applied) */
  cssWidth: number
  cssHeight: number
  /** PDF media box width in points */
  pageWidthPts: number
  pageHeightPts: number
  scale: number
  devicePixelRatio: number
}

/**
 * Render a 1-based page index onto a canvas.
 * Uses devicePixelRatio for sharp output; cssWidth/cssHeight are layout size.
 */
export async function renderPageToCanvas(
  doc: PDFDocumentProxy,
  pageNumber: number,
  targetCssWidth: number,
  canvas?: HTMLCanvasElement,
): Promise<RenderedPage> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.max(0.5, targetCssWidth / base.width)
  const viewport = page.getViewport({ scale })
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1

  const out = canvas ?? document.createElement('canvas')
  const cssWidth = viewport.width
  const cssHeight = viewport.height
  out.width = Math.floor(cssWidth * dpr)
  out.height = Math.floor(cssHeight * dpr)
  out.style.width = `${cssWidth}px`
  out.style.height = `${cssHeight}px`

  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Could not get canvas context')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  await page.render({ canvasContext: ctx, viewport }).promise

  // pdf.js may alter the transform; restore CSS-pixel space for annotation overlays.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  return {
    page,
    canvas: out,
    cssWidth,
    cssHeight,
    pageWidthPts: base.width,
    pageHeightPts: base.height,
    scale,
    devicePixelRatio: dpr,
  }
}
