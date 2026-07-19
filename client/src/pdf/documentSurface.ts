/**
 * Unified render surface for local PDFs and images.
 * Annotations use normalized page geometry; both backends paint to canvas.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  detectDocumentKind,
  type DocumentKind,
  unsupportedDocumentMessage,
} from './documentKinds'
import { loadPdfFromFile, renderPageToCanvas } from './pdfDocument'
import { getPdfPageCount } from './hashPdf'

export interface RenderedSurfacePage {
  canvas: HTMLCanvasElement
  cssWidth: number
  cssHeight: number
  /** Layout size units (PDF points or image natural pixels). */
  pageWidthPts: number
  pageHeightPts: number
}

export interface DocumentSurface {
  kind: DocumentKind
  pageCount: number
  /** 1-based page index. Images always have page 1. */
  renderPage(
    pageNumber: number,
    targetCssWidth: number,
    canvas?: HTMLCanvasElement,
  ): Promise<RenderedSurfacePage>
  destroy(): void
}

/** Cap CSS width so huge phone photos stay interactive. */
const MAX_CSS_WIDTH = 1600

function clampTargetWidth(targetCssWidth: number): number {
  if (!Number.isFinite(targetCssWidth) || targetCssWidth <= 0) return 560
  return Math.min(MAX_CSS_WIDTH, Math.max(32, targetCssWidth))
}

function pdfSurface(doc: PDFDocumentProxy): DocumentSurface {
  return {
    kind: 'pdf',
    pageCount: doc.numPages,
    async renderPage(pageNumber, targetCssWidth, canvas) {
      const rendered = await renderPageToCanvas(
        doc,
        pageNumber,
        clampTargetWidth(targetCssWidth),
        canvas,
      )
      return {
        canvas: rendered.canvas,
        cssWidth: rendered.cssWidth,
        cssHeight: rendered.cssHeight,
        pageWidthPts: rendered.pageWidthPts,
        pageHeightPts: rendered.pageHeightPts,
      }
    },
    destroy() {
      void doc.destroy()
    },
  }
}

async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through to HTMLImageElement */
    }
  }
  return await new Promise<ImageBitmap>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) {
        URL.revokeObjectURL(url)
        reject(new Error('Could not read image dimensions'))
        return
      }
      // createImageBitmap from image if available
      if (typeof createImageBitmap === 'function') {
        void createImageBitmap(img)
          .then(bitmap => {
            URL.revokeObjectURL(url)
            resolve(bitmap)
          })
          .catch(err => {
            URL.revokeObjectURL(url)
            reject(err)
          })
        return
      }
      // Manual canvas copy as ImageBitmap stand-in is not available without createImageBitmap.
      // Draw path uses HTMLImageElement via Offscreen-less path below — reject so caller can message.
      URL.revokeObjectURL(url)
      reject(new Error('This browser cannot decode images for placement preview'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not open image'))
    }
    img.src = url
  })
}

function imageSurface(bitmap: ImageBitmap): DocumentSurface {
  const naturalW = bitmap.width
  const naturalH = bitmap.height
  return {
    kind: 'image',
    pageCount: 1,
    async renderPage(pageNumber, targetCssWidth, canvas) {
      if (pageNumber !== 1) {
        throw new Error('Images have only one page')
      }
      const widthTarget = clampTargetWidth(targetCssWidth)
      const scale = widthTarget / Math.max(1, naturalW)
      const cssWidth = widthTarget
      const cssHeight = Math.max(1, Math.round(naturalH * scale))
      const dpr =
        typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1

      const out = canvas ?? document.createElement('canvas')
      out.width = Math.floor(cssWidth * dpr)
      out.height = Math.floor(cssHeight * dpr)
      out.style.width = `${cssWidth}px`
      out.style.height = `${cssHeight}px`

      const ctx = out.getContext('2d')
      if (!ctx) throw new Error('Could not get canvas context')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, cssWidth, cssHeight)
      ctx.drawImage(bitmap, 0, 0, cssWidth, cssHeight)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      return {
        canvas: out,
        cssWidth,
        cssHeight,
        pageWidthPts: naturalW,
        pageHeightPts: naturalH,
      }
    },
    destroy() {
      bitmap.close()
    },
  }
}

export async function loadDocumentSurface(file: File): Promise<DocumentSurface> {
  const kind = detectDocumentKind(file)
  if (!kind) {
    throw new Error(unsupportedDocumentMessage())
  }
  if (kind === 'pdf') {
    const doc = await loadPdfFromFile(file)
    return pdfSurface(doc)
  }
  const bitmap = await loadImageBitmap(file)
  return imageSurface(bitmap)
}

/** Page count without keeping a surface open (create path). Images are always 1 page. */
export async function getDocumentPageCount(file: File): Promise<number> {
  const kind = detectDocumentKind(file)
  if (!kind) {
    throw new Error(unsupportedDocumentMessage())
  }
  if (kind === 'pdf') {
    return getPdfPageCount(file)
  }
  return 1
}
