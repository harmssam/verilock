import { useEffect, useRef, useState } from 'react'
import { paintAnnotation, type PdfAnnotation } from './annotations'
import { loadDocumentSurface } from './documentSurface'
import './PdfAnnotator.css'

interface PdfReconstructorProps {
  file: File
  annotations: PdfAnnotation[]
  /** CSS target width for each page (default 560) */
  pageWidth?: number
  className?: string
}

/**
 * Reconstruct a sealed view: original local document + server annotations overlaid.
 * Positions use normalized coords. Supports PDF and single-page images.
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

    async function run() {
      setLoading(true)
      setError(null)
      const host = containerRef.current
      if (host) host.innerHTML = ''

      let surface: Awaited<ReturnType<typeof loadDocumentSurface>> | null = null
      try {
        surface = await loadDocumentSurface(file)
        if (cancelled) return
        setPageCount(surface.pageCount)

        for (let pageNum = 1; pageNum <= surface.pageCount; pageNum++) {
          if (cancelled) return
          const rendered = await surface.renderPage(pageNum, pageWidth)
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
          setError(err instanceof Error ? err.message : 'Could not reconstruct document view')
        }
      } finally {
        surface?.destroy()
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [file, annotations, pageWidth])

  return (
    <div className={className ?? 'pdf-annotator'}>
      {loading && <p className="pdf-annotator-hint">Reconstructing sealed view…</p>}
      {error && (
        <p className="pdf-annotator-error" role="alert">
          {error}
        </p>
      )}
      <div ref={containerRef} />
      {!loading && !error && pageCount > 0 && (
        <p className="pdf-annotator-hint muted">
          {pageCount} page{pageCount === 1 ? '' : 's'}
          {annotations.length > 0
            ? ' · local file + recorded signatures and fields'
            : ' · local file'}
        </p>
      )}
    </div>
  )
}
