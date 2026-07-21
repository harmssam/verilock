import { useEffect, useRef, useState } from 'react'
import { paintAnnotation, type PdfAnnotation } from './annotations'
import { loadDocumentSurface } from './documentSurface'
import './PdfAnnotator.css'

interface PdfReconstructorProps {
  file: File
  annotations: PdfAnnotation[]
  /** CSS target width for each page (default 640 — matches signing surface). */
  pageWidth?: number
  className?: string
}

/**
 * Reconstruct a sealed view: original local document + server annotations overlaid.
 * Uses the same stage chrome as PlacementEditor / SignerFillView.
 */
export function PdfReconstructor({
  file,
  annotations,
  pageWidth = 640,
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
          wrap.style.width = `${rendered.cssWidth}px`
          wrap.style.marginBottom = pageNum < surface.pageCount ? '1rem' : '0'
          wrap.appendChild(rendered.canvas)
          containerRef.current.appendChild(wrap)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not open document view')
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
    <div className={className ?? 'pdf-annotator signed-doc-recon'}>
      {loading && <p className="pdf-annotator-hint">Opening document…</p>}
      {error && (
        <p className="pdf-annotator-error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-annotator-stage signed-doc-recon-stage">
        <div ref={containerRef} />
        {!loading && !error && pageCount === 0 && (
          <p className="pdf-annotator-hint muted">No pages to display.</p>
        )}
      </div>
      {!loading && !error && pageCount > 0 && (
        <p className="pdf-annotator-hint muted">
          {pageCount} page{pageCount === 1 ? '' : 's'}
          {annotations.length > 0
            ? ' · local file with signatures and fields on the page'
            : ' · local file'}
        </p>
      )}
    </div>
  )
}
