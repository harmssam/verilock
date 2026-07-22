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

const PRINT_ROOT_ID = 'verilock-print-root'
const PRINT_STYLE_ID = 'verilock-print-style'

function waitForImage(img: HTMLImageElement): Promise<void> {
  return new Promise(resolve => {
    if (img.complete && img.naturalWidth > 0) {
      resolve()
      return
    }
    img.onload = () => resolve()
    img.onerror = () => resolve()
  })
}

/**
 * Open a print dialog with the rendered page canvases (signatures already painted).
 * Prints from the current window (no pop-up) so mobile Safari/Chrome work —
 * window.open print sheets are blocked or unusable on many phones.
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

  // Drop leftovers if a prior print was interrupted.
  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.getElementById(PRINT_STYLE_ID)?.remove()

  const style = document.createElement('style')
  style.id = PRINT_STYLE_ID
  style.textContent = `
    /* Keep the print root out of the interactive UI until the print sheet opens. */
    #${PRINT_ROOT_ID} {
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      width: 100% !important;
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      z-index: -1 !important;
    }
    @media print {
      @page { margin: 10mm; }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        height: auto !important;
        overflow: visible !important;
      }
      /* Hide app chrome; only the signed pages go to the printer. */
      body > *:not(#${PRINT_ROOT_ID}) {
        display: none !important;
      }
      #${PRINT_ROOT_ID} {
        display: block !important;
        position: static !important;
        width: 100% !important;
        height: auto !important;
        overflow: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        z-index: auto !important;
        background: #fff !important;
        color: #0f172a !important;
      }
      #${PRINT_ROOT_ID} .print-page {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        height: auto !important;
        margin: 0 auto !important;
        page-break-after: always;
        break-after: page;
      }
      #${PRINT_ROOT_ID} .print-page:last-child {
        page-break-after: auto;
        break-after: auto;
      }
    }
  `
  document.head.appendChild(style)

  const root = document.createElement('div')
  root.id = PRINT_ROOT_ID
  root.setAttribute('aria-hidden', 'true')

  dataUrls.forEach((src, i) => {
    const img = document.createElement('img')
    img.className = 'print-page'
    img.src = src
    img.alt = `Page ${i + 1}`
    root.appendChild(img)
  })
  document.body.appendChild(root)

  await Promise.all(Array.from(root.querySelectorAll('img')).map(waitForImage))

  // Let layout settle before the system print UI.
  await new Promise<void>(r => {
    window.setTimeout(r, 50)
  })

  const previousTitle = document.title
  const safeTitle = title.replace(/[<>&"]/g, '').trim()
  if (safeTitle) document.title = safeTitle

  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    document.title = previousTitle
    root.remove()
    style.remove()
    window.removeEventListener('afterprint', onAfterPrint)
  }
  const onAfterPrint = () => cleanup()
  window.addEventListener('afterprint', onAfterPrint)

  try {
    window.print()
  } catch (err) {
    cleanup()
    throw err instanceof Error ? err : new Error('Could not open print')
  }

  // iOS Safari often never fires afterprint; always tear down eventually.
  window.setTimeout(cleanup, 60_000)
}
