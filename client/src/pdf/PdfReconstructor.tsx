import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { paintAnnotation, type PdfAnnotation } from './annotations'
import { loadDocumentSurface } from './documentSurface'
import './PdfAnnotator.css'

interface PdfReconstructorProps {
  file: File
  annotations: PdfAnnotation[]
  /** CSS target width for each page (default 640 — matches signing surface). */
  pageWidth?: number
  className?: string
  /** Fires when page canvases are ready (or cleared on error/loading). */
  onReadyChange?: (ready: boolean) => void
}

export interface PdfReconstructorHandle {
  /** Root that holds rendered page canvases. */
  getPagesRoot: () => HTMLElement | null
}

/**
 * Reconstruct a sealed view: original local document + server annotations overlaid.
 * Uses the same stage chrome as PlacementEditor / SignerFillView.
 */
export const PdfReconstructor = forwardRef<PdfReconstructorHandle, PdfReconstructorProps>(
  function PdfReconstructor(
    { file, annotations, pageWidth = 640, className, onReadyChange },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [pageCount, setPageCount] = useState(0)

    useImperativeHandle(
      ref,
      () => ({
        getPagesRoot: () => containerRef.current,
      }),
      [],
    )

    useEffect(() => {
      let cancelled = false

      async function run() {
        setLoading(true)
        onReadyChange?.(false)
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
          if (!cancelled) {
            setLoading(false)
            onReadyChange?.(true)
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Could not open document view')
            setLoading(false)
            onReadyChange?.(false)
          }
        } finally {
          surface?.destroy()
        }
      }

      void run()
      return () => {
        cancelled = true
        onReadyChange?.(false)
      }
      // onReadyChange is optional UI glue; omit from deps to avoid re-render loops.
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <p className="pdf-annotator-hint muted signed-doc-recon-meta">
            {pageCount} page{pageCount === 1 ? '' : 's'}
            {annotations.length > 0
              ? ' · local file with signatures and fields on the page'
              : ' · local file'}
          </p>
        )}
      </div>
    )
  },
)

/**
 * Open a print dialog with the rendered page canvases (signatures already painted).
 * Uses a temporary window so shell chrome is not printed.
 */
export async function printRenderedPages(
  pagesRoot: HTMLElement | null,
  title = 'Signed document',
): Promise<void> {
  if (!pagesRoot) throw new Error('Document is not ready to print')
  const canvases = Array.from(pagesRoot.querySelectorAll('canvas'))
  if (canvases.length === 0) throw new Error('No pages to print')

  const dataUrls = canvases.map(c => {
    try {
      return c.toDataURL('image/png')
    } catch {
      throw new Error('Could not capture page for print')
    }
  })

  const safeTitle = title.replace(/[<>&"]/g, '')
  const w = window.open('', '_blank', 'noopener,noreferrer')
  if (!w) throw new Error('Pop-up blocked — allow pop-ups to print')

  const pagesHtml = dataUrls
    .map(
      (src, i) =>
        `<img class="print-page" src="${src}" alt="Page ${i + 1}" />`,
    )
    .join('\n')

  w.document.open()
  w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <style>
    @page { margin: 10mm; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      color: #0f172a;
    }
    .print-page {
      display: block;
      width: 100%;
      max-width: 100%;
      height: auto;
      margin: 0 auto;
      page-break-after: always;
      break-after: page;
    }
    .print-page:last-child {
      page-break-after: auto;
      break-after: auto;
    }
  </style>
</head>
<body>
${pagesHtml}
</body>
</html>`)
  w.document.close()

  const imgs = Array.from(w.document.images)
  await Promise.all(
    imgs.map(
      img =>
        new Promise<void>(resolve => {
          if (img.complete) {
            resolve()
            return
          }
          img.onload = () => resolve()
          img.onerror = () => resolve()
        }),
    ),
  )

  // Let the layout settle before the dialog.
  await new Promise<void>(r => {
    window.setTimeout(r, 50)
  })

  w.focus()
  w.print()
  // Leave the window open so the user can cancel/reprint; close after print if supported.
  const closeSoon = () => {
    try {
      w.close()
    } catch {
      /* ignore */
    }
  }
  if ('onafterprint' in w) {
    w.addEventListener('afterprint', closeSoon, { once: true })
  } else {
    window.setTimeout(closeSoon, 1000)
  }
}
