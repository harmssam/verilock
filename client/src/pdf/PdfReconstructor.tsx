import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { paintAnnotation, type PdfAnnotation } from './annotations'
import { loadDocumentSurface } from './documentSurface'
import './PdfAnnotator.css'

interface PdfReconstructorProps {
  file: File
  annotations: PdfAnnotation[]
  /** CSS target width for each page (default 640 - matches signing surface). */
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
const PRINT_HIDE_ATTR = 'data-verilock-print-hide'

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

function waitForNextPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Standalone HTML that contains *only* signed page images (plus a small screen-only toolbar).
 * Used in a separate browsing context so the SPA chrome can never appear in the print sheet.
 */
function buildPrintDocumentHtml(dataUrls: string[], title: string): string {
  const safeTitle = escapeHtml(title)
  const images = dataUrls
    .map(
      (src, i) =>
        `<img class="page" src="${src}" alt="Page ${i + 1}" width="100%" />`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<title>${safeTitle}</title>
<style>
  @page { margin: 10mm; size: auto; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #0f172a;
  }
  .page {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  @media screen {
    body { padding: 12px; box-sizing: border-box; }
    .chrome {
      font: 500 14px/1.4 system-ui, -apple-system, sans-serif;
      margin: 0 0 12px;
    }
    .chrome p { margin: 0 0 10px; color: #334155; }
    .chrome button {
      font: 600 15px/1 system-ui, -apple-system, sans-serif;
      padding: 12px 16px;
      border-radius: 10px;
      border: 1px solid #0f172a;
      background: #0f172a;
      color: #fff;
    }
  }
  @media print {
    .chrome { display: none !important; }
    html, body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
  <div class="chrome">
    <p>Signed document — print preview has only the pages below (no VeriLock app chrome).</p>
    <button type="button" id="print-btn">Print</button>
  </div>
  ${images}
  <script>
    (function () {
      function doPrint() {
        try { window.focus(); window.print(); } catch (e) {}
      }
      var btn = document.getElementById('print-btn');
      if (btn) btn.addEventListener('click', doPrint);
      var images = Array.prototype.slice.call(document.images || []);
      var left = images.length;
      function tick() {
        left -= 1;
        if (left <= 0) setTimeout(doPrint, 150);
      }
      if (!images.length) setTimeout(doPrint, 150);
      else {
        images.forEach(function (img) {
          if (img.complete && img.naturalWidth > 0) tick();
          else {
            img.onload = tick;
            img.onerror = tick;
          }
        });
      }
    })();
  </script>
</body>
</html>`
}

function capturePageDataUrls(pagesRoot: HTMLElement): string[] {
  const canvases = Array.from(pagesRoot.querySelectorAll('canvas'))
  if (canvases.length === 0) throw new Error('No pages to print')
  return canvases.map(c => {
    try {
      return c.toDataURL('image/png')
    } catch {
      throw new Error('Could not capture page for print')
    }
  })
}

/**
 * Write a document-only HTML sheet into an already-opened window (about:blank).
 * Preferred path: the print context never contains the SPA.
 */
function printViaSeparateDocument(target: Window, dataUrls: string[], title: string): void {
  const html = buildPrintDocumentHtml(dataUrls, title)
  const doc = target.document
  doc.open()
  doc.write(html)
  doc.close()
  try {
    target.focus()
  } catch {
    /* ignore */
  }
}

/**
 * Same-window fallback when popups are blocked.
 * Physically hides every body child (inline styles + hidden) and mounts only page images,
 * then prints. Avoids @media-print-only tricks that mobile browsers often ignore.
 */
async function printViaSameWindowIsolation(
  dataUrls: string[],
  title: string,
): Promise<void> {
  // Tear down any prior attempt.
  document.getElementById(PRINT_ROOT_ID)?.remove()
  document.querySelectorAll(`[${PRINT_HIDE_ATTR}]`).forEach(el => {
    const node = el as HTMLElement
    const prev = node.getAttribute(PRINT_HIDE_ATTR)
    node.removeAttribute(PRINT_HIDE_ATTR)
    if (prev === '') node.style.removeProperty('display')
    else if (prev != null) node.style.display = prev
    node.removeAttribute('hidden')
  })

  const previousTitle = document.title
  const previousScrollX = window.scrollX
  const previousScrollY = window.scrollY
  const safeTitle = title.replace(/[<>&"]/g, '').trim()
  if (safeTitle) document.title = safeTitle

  const overlay = document.createElement('div')
  overlay.id = PRINT_ROOT_ID
  // Inline styles so print capture cannot miss a late stylesheet.
  overlay.setAttribute(
    'style',
    [
      'position:fixed',
      'inset:0',
      'z-index:2147483647',
      'background:#fff',
      'color:#0f172a',
      'overflow:auto',
      'margin:0',
      'padding:0',
      'width:100%',
      'height:100%',
    ].join(';'),
  )

  dataUrls.forEach((src, i) => {
    const img = document.createElement('img')
    img.src = src
    img.alt = `Page ${i + 1}`
    img.setAttribute(
      'style',
      'display:block;width:100%;max-width:100%;height:auto;margin:0 auto;page-break-after:always;break-after:page',
    )
    overlay.appendChild(img)
  })
  const last = overlay.lastElementChild as HTMLElement | null
  if (last) {
    last.style.pageBreakAfter = 'auto'
    last.style.breakAfter = 'auto'
  }

  // Hide every existing body child with inline display:none (harder for engines to ignore).
  Array.from(document.body.children).forEach(child => {
    if (child === overlay) return
    const el = child as HTMLElement
    el.setAttribute(PRINT_HIDE_ATTR, el.style.display || '')
    el.style.display = 'none'
    el.setAttribute('hidden', '')
  })
  document.body.appendChild(overlay)

  await Promise.all(Array.from(overlay.querySelectorAll('img')).map(waitForImage))
  window.scrollTo(0, 0)
  await waitForNextPaint()
  await new Promise<void>(r => {
    window.setTimeout(r, 150)
  })

  let cleaned = false
  const minAliveUntil = Date.now() + 2500
  const cleanup = () => {
    if (cleaned) return
    if (Date.now() < minAliveUntil) {
      window.setTimeout(cleanup, minAliveUntil - Date.now() + 50)
      return
    }
    cleaned = true
    document.title = previousTitle
    overlay.remove()
    document.querySelectorAll(`[${PRINT_HIDE_ATTR}]`).forEach(node => {
      const el = node as HTMLElement
      const prev = el.getAttribute(PRINT_HIDE_ATTR)
      el.removeAttribute(PRINT_HIDE_ATTR)
      if (prev === '') el.style.removeProperty('display')
      else if (prev != null) el.style.display = prev
      el.removeAttribute('hidden')
    })
    window.removeEventListener('afterprint', onAfterPrint)
    window.scrollTo(previousScrollX, previousScrollY)
  }
  const onAfterPrint = () => cleanup()
  window.addEventListener('afterprint', onAfterPrint)

  try {
    window.print()
  } catch (err) {
    cleanup()
    throw err instanceof Error ? err : new Error('Could not open print')
  }

  window.setTimeout(cleanup, 60_000)
}

/**
 * Open a print dialog with the rendered page canvases (signatures already painted).
 *
 * @param preOpenedWindow Optional window opened synchronously from the Print click
 *   (`window.open('about:blank')`). Required for reliable mobile isolation: the sheet
 *   document contains only page images, never the VeriLock SPA.
 */
export async function printRenderedPages(
  pagesRoot: HTMLElement | null,
  title = 'Signed document',
  preOpenedWindow: Window | null = null,
): Promise<void> {
  if (!pagesRoot) throw new Error('Document is not ready to print')

  const dataUrls = capturePageDataUrls(pagesRoot)
  const safeTitle = title.replace(/[<>&"]/g, '').trim() || 'Signed document'

  // 1) Preferred: separate document that has zero app chrome.
  if (preOpenedWindow && !preOpenedWindow.closed) {
    try {
      printViaSeparateDocument(preOpenedWindow, dataUrls, safeTitle)
      return
    } catch {
      try {
        preOpenedWindow.close()
      } catch {
        /* ignore */
      }
    }
  }

  // 2) Try opening a sheet now (may be blocked outside the user-gesture turn).
  try {
    const fresh = window.open('about:blank', 'verilock-print')
    if (fresh && !fresh.closed) {
      printViaSeparateDocument(fresh, dataUrls, safeTitle)
      return
    }
  } catch {
    /* fall through */
  }

  // 3) Popup blocked — isolate in-place with inline hide of the SPA.
  await printViaSameWindowIsolation(dataUrls, safeTitle)
}
