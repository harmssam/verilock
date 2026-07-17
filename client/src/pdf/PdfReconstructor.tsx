import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { paintAnnotation, type PdfAnnotation } from './annotations'
import { loadPdfFromFile, renderPageToCanvas } from './pdfDocument'
import './PdfAnnotator.css'

interface PdfReconstructorProps {
  file: File
  annotations: PdfAnnotation[]
  /** CSS target width for each page (default 560) */
  pageWidth?: number
  className?: string
}

/**
 * Reconstruct a sealed view: original local PDF + server annotations overlaid.
 * No pdf-lib — pure pdf.js render + canvas paint. Positions use normalized coords.
 */
export function PdfReconstructor({
  file,
  annotations,
  pageWidth = 560,
  className,
}: PdfReconstructorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let pdf: PDFDocumentProxy | null = null

    async function run() {
      setLoading(true)
      setError(null)
      const host = containerRef.current
      if (host) host.innerHTML = ''

      try {
        pdf = await loadPdfFromFile(file)
        if (cancelled) return
        setPageCount(pdf.numPages)

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return
          const rendered = await renderPageToCanvas(pdf, pageNum, pageWidth)
          const ctx = rendered.canvas.getContext('2d')
          if (!ctx) continue

          const pageAnns = annotations.filter(a => a.pageIndex === pageNum - 1)
          for (const ann of pageAnns) {
            await paintAnnotation(ctx, ann, rendered.cssWidth, rendered.cssHeight)
          }

          if (cancelled || !containerRef.current) return
          const wrap = document.createElement('div')
          wrap.className = 'pdf-annotator-page-wrap'
          wrap.style.marginBottom = '1rem'
          wrap.appendChild(rendered.canvas)
          containerRef.current.appendChild(wrap)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not reconstruct PDF view')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
      void pdf?.destroy()
    }
  }, [file, annotations, pageWidth])

  return (
    <div className={className ?? 'pdf-annotator'}>
      {loading && <p className="pdf-annotator-hint">Reconstructing sealed view…</p>}
      {error && <p className="pdf-annotator-hint">{error}</p>}
      {!loading && !error && (
        <p className="pdf-annotator-hint">
          {pageCount} page{pageCount === 1 ? '' : 's'} · {annotations.length} annotation
          {annotations.length === 1 ? '' : 's'} from server (PDF never uploaded)
        </p>
      )}
      <div ref={containerRef} className="pdf-annotator-stage" />
    </div>
  )
}

/**
 * Headless reconstruction for tests: returns one canvas per page with annotations painted.
 */
export async function reconstructPagesToCanvases(
  file: File,
  annotations: PdfAnnotation[],
  pageWidth = 560,
): Promise<HTMLCanvasElement[]> {
  const pdf = await loadPdfFromFile(file)
  const canvases: HTMLCanvasElement[] = []
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const rendered = await renderPageToCanvas(pdf, pageNum, pageWidth)
      const ctx = rendered.canvas.getContext('2d')
      if (!ctx) continue
      const pageAnns = annotations.filter(a => a.pageIndex === pageNum - 1)
      for (const ann of pageAnns) {
        await paintAnnotation(ctx, ann, rendered.cssWidth, rendered.cssHeight)
      }
      canvases.push(rendered.canvas)
    }
  } finally {
    await pdf.destroy()
  }
  return canvases
}
