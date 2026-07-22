import { Check, Eraser, MousePointer2, PenLine, Type, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  canAddMark,
  canAddSignature,
  canAddText,
  countByType,
  MAX_MARK_ANNOTATIONS,
  MAX_SIGNATURE_ANNOTATIONS,
  MAX_TEXT_ANNOTATIONS,
  SIGNATURE_RDP_EPSILON_PX,
} from './annotationLimits'
import {
  canvasRectToNormalized,
  countPathPoints,
  ensureDataUrl,
  newAnnotationId,
  normalizedToCanvasRect,
  paintMark,
  paintSignaturePath,
  type MarkAnnotation,
  type PdfAnnotation,
  type SignatureAnnotation,
  type SignaturePathData,
  type TextAnnotation,
} from './annotations'
import { loadDocumentSurface, type DocumentSurface } from './documentSurface'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './SignatureStrokePad'
import './PdfAnnotator.css'

type Tool = 'select' | 'signature' | 'text' | 'checkmark' | 'cross'

interface PdfAnnotatorProps {
  file: File
  annotations: PdfAnnotation[]
  onChange: (next: PdfAnnotation[]) => void
  disabled?: boolean
  /** CSS target width for page render (default 560) */
  pageWidth?: number
}

/**
 * Local-only document annotator: render PDF or image, place signature/text overlays.
 * Emits normalized annotations — no file bytes ever leave this component.
 */
export function PdfAnnotator({
  file,
  annotations,
  onChange,
  disabled = false,
  pageWidth = 560,
}: PdfAnnotatorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<DocumentSurface | null>(null)
  const [surface, setSurface] = useState<DocumentSurface | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [cssSize, setCssSize] = useState({ width: pageWidth, height: pageWidth * 1.3 })
  const [pagePts, setPagePts] = useState({ width: 612, height: 792 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sigDraft, setSigDraft] = useState<SignatureStrokeResult | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [placeError, setPlaceError] = useState<string | null>(null)
  const [placing, setPlacing] = useState<{
    type: 'signature' | 'text' | 'checkmark' | 'cross'
    x: number
    y: number
  } | null>(null)
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  /** Place on pointerup unless the gesture moved (mobile pan/scroll). */
  const placeGestureRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    cancelled: boolean
  } | null>(null)
  const PLACE_TAP_SLOP_PX = 12
  const [dragTick, setDragTick] = useState(0)

  const counts = useMemo(() => countByType(annotations), [annotations])
  const sigDataUrl = sigDraft?.imageDataUrl ?? null
  const sigPath: SignaturePathData | null = sigDraft?.path ?? null

  // Load document when file changes
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setPageNumber(1)
    loadDocumentSurface(file)
      .then(next => {
        if (cancelled) {
          next.destroy()
          return
        }
        surfaceRef.current?.destroy()
        surfaceRef.current = next
        setSurface(next)
        setPageCount(next.pageCount)
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not open document')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    return () => {
      surfaceRef.current?.destroy()
      surfaceRef.current = null
    }
  }, [])

  // Render current page
  useEffect(() => {
    if (!surface || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    surface
      .renderPage(pageNumber, pageWidth, canvas)
      .then(rendered => {
        if (cancelled) return
        setCssSize({ width: rendered.cssWidth, height: rendered.cssHeight })
        setPagePts({ width: rendered.pageWidthPts, height: rendered.pageHeightPts })
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not render page')
        }
      })
    return () => {
      cancelled = true
    }
  }, [surface, pageNumber, pageWidth])

  const pageAnnotations = useMemo(
    () => annotations.filter(a => a.pageIndex === pageNumber - 1),
    [annotations, pageNumber],
  )

  const defaultSigSize = useMemo(() => {
    // ~22% width × ~8% height of page
    return { width: 0.22, height: 0.08 }
  }, [])

  const defaultTextSize = useMemo(() => {
    return { width: 0.28, height: 0.06 }
  }, [])

  const defaultMarkSize = useMemo(() => {
    // ~4.5% of page width square-ish box
    return { width: 0.045, height: 0.045 }
  }, [])

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<PdfAnnotation>) => {
      onChange(
        annotations.map(a => (a.id === id ? ({ ...a, ...patch } as PdfAnnotation) : a)),
      )
    },
    [annotations, onChange],
  )

  const removeAnnotation = useCallback(
    (id: string) => {
      onChange(annotations.filter(a => a.id !== id))
      if (selectedId === id) setSelectedId(null)
    },
    [annotations, onChange, selectedId],
  )

  const pointerToLocal = (e: React.PointerEvent) => {
    const wrap = wrapRef.current
    if (!wrap) return { x: 0, y: 0 }
    const rect = wrap.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const placeAt = (cssX: number, cssY: number) => {
    if (disabled) return
    if (tool === 'signature' && sigDataUrl && sigPath) {
      if (!canAddSignature(annotations)) {
        setPlaceError(
          `Signature limit reached (${MAX_SIGNATURE_ANNOTATIONS} per agreement / credit).`,
        )
        return
      }
      setPlaceError(null)
      const geo = canvasRectToNormalized(
        {
          left: cssX - (defaultSigSize.width * cssSize.width) / 2,
          top: cssY - (defaultSigSize.height * cssSize.height) / 2,
          width: defaultSigSize.width * cssSize.width,
          height: defaultSigSize.height * cssSize.height,
        },
        cssSize.width,
        cssSize.height,
        pageNumber - 1,
        pagePts.width,
        pagePts.height,
      )
      // clamp so the box stays on page
      geo.x = Math.min(Math.max(0, geo.x), 1 - geo.width)
      geo.y = Math.min(Math.max(0, geo.y), 1 - geo.height)
      const ann: SignatureAnnotation = {
        id: newAnnotationId(),
        type: 'signature',
        ...geo,
        imageDataUrl: ensureDataUrl(sigDataUrl),
        path: sigPath,
      }
      onChange([...annotations, ann])
      setSelectedId(ann.id)
      setTool('select')
      setPlacing(null)
      return
    }
    if (tool === 'text' && textDraft.trim()) {
      if (!canAddText(annotations)) {
        setPlaceError(`Text stamp limit reached (${MAX_TEXT_ANNOTATIONS} per agreement / credit).`)
        return
      }
      setPlaceError(null)
      const geo = canvasRectToNormalized(
        {
          left: cssX,
          top: cssY,
          width: defaultTextSize.width * cssSize.width,
          height: defaultTextSize.height * cssSize.height,
        },
        cssSize.width,
        cssSize.height,
        pageNumber - 1,
        pagePts.width,
        pagePts.height,
      )
      geo.x = Math.min(Math.max(0, geo.x), 1 - geo.width)
      geo.y = Math.min(Math.max(0, geo.y), 1 - geo.height)
      const ann: TextAnnotation = {
        id: newAnnotationId(),
        type: 'text',
        ...geo,
        text: textDraft.trim(),
        fontSizeRatio: 0.025,
        color: '#0f172a',
      }
      onChange([...annotations, ann])
      setSelectedId(ann.id)
      setTool('select')
      setPlacing(null)
      return
    }
    if (tool === 'checkmark' || tool === 'cross') {
      if (!canAddMark(annotations)) {
        setPlaceError(`Mark limit reached (${MAX_MARK_ANNOTATIONS} check/X per agreement).`)
        return
      }
      setPlaceError(null)
      const geo = canvasRectToNormalized(
        {
          left: cssX - (defaultMarkSize.width * cssSize.width) / 2,
          top: cssY - (defaultMarkSize.height * cssSize.height) / 2,
          width: defaultMarkSize.width * cssSize.width,
          height: defaultMarkSize.height * cssSize.height,
        },
        cssSize.width,
        cssSize.height,
        pageNumber - 1,
        pagePts.width,
        pagePts.height,
      )
      geo.x = Math.min(Math.max(0, geo.x), 1 - geo.width)
      geo.y = Math.min(Math.max(0, geo.y), 1 - geo.height)
      const ann: MarkAnnotation = {
        id: newAnnotationId(),
        type: tool,
        ...geo,
        color: tool === 'checkmark' ? '#0f766e' : '#b91c1c',
      }
      onChange([...annotations, ann])
      setSelectedId(ann.id)
      // Keep mark tool active for rapid multi-place
      setPlacing(null)
    }
  }

  const isPlaceTool =
    tool === 'signature' || tool === 'text' || tool === 'checkmark' || tool === 'cross'

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    if (isPlaceTool) {
      // Wait for pointerup so pan/scroll on mobile does not drop a mark.
      const p = pointerToLocal(e)
      placeGestureRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        cancelled: false,
      }
      setPlacing({ type: tool, x: p.x, y: p.y })
      return
    }
    // select empty space
    if (e.target === wrapRef.current || e.target === canvasRef.current) {
      setSelectedId(null)
    }
  }

  const onStagePointerMove = (e: React.PointerEvent) => {
    const placeGesture = placeGestureRef.current
    if (placeGesture && placeGesture.pointerId === e.pointerId) {
      const dist = Math.hypot(
        e.clientX - placeGesture.startClientX,
        e.clientY - placeGesture.startClientY,
      )
      if (dist > PLACE_TAP_SLOP_PX) {
        placeGesture.cancelled = true
        setPlacing(null)
      }
    }
    if (isPlaceTool && !placeGesture?.cancelled) {
      const p = pointerToLocal(e)
      setPlacing({ type: tool, x: p.x, y: p.y })
    }
    const drag = dragRef.current
    if (!drag) return
    const wrap = wrapRef.current
    if (!wrap) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    const ann = annotations.find(a => a.id === drag.id)
    if (!ann) return
    let nx = drag.origX + dx / cssSize.width
    let ny = drag.origY + dy / cssSize.height
    nx = Math.min(Math.max(0, nx), 1 - ann.width)
    ny = Math.min(Math.max(0, ny), 1 - ann.height)
    updateAnnotation(drag.id, { x: nx, y: ny })
    setDragTick(t => t + 1)
  }

  const endDrag = () => {
    dragRef.current = null
  }

  const onStagePointerUp = (e: React.PointerEvent) => {
    const placeGesture = placeGestureRef.current
    if (placeGesture && placeGesture.pointerId === e.pointerId) {
      placeGestureRef.current = null
      if (!placeGesture.cancelled && !disabled && isPlaceTool) {
        const p = pointerToLocal(e)
        placeAt(p.x, p.y)
      }
    }
    endDrag()
  }

  const onStagePointerCancel = (e: React.PointerEvent) => {
    const placeGesture = placeGestureRef.current
    if (placeGesture && placeGesture.pointerId === e.pointerId) {
      placeGestureRef.current = null
      setPlacing(null)
    }
    endDrag()
  }

  const startItemDrag = (e: React.PointerEvent, id: string) => {
    if (disabled || tool !== 'select') return
    e.stopPropagation()
    e.preventDefault()
    const ann = annotations.find(a => a.id === id)
    if (!ann) return
    setSelectedId(id)
    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: ann.x,
      origY: ann.y,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  void dragTick // force re-render while dragging via state updates in updateAnnotation

  const ghostStyle = (): React.CSSProperties | undefined => {
    if (!placing) return undefined
    if (placing.type === 'signature') {
      const w = defaultSigSize.width * cssSize.width
      const h = defaultSigSize.height * cssSize.height
      return {
        left: placing.x - w / 2,
        top: placing.y - h / 2,
        width: w,
        height: h,
      }
    }
    if (placing.type === 'checkmark' || placing.type === 'cross') {
      const w = defaultMarkSize.width * cssSize.width
      const h = defaultMarkSize.height * cssSize.height
      return {
        left: placing.x - w / 2,
        top: placing.y - h / 2,
        width: w,
        height: h,
      }
    }
    const w = defaultTextSize.width * cssSize.width
    const h = defaultTextSize.height * cssSize.height
    return { left: placing.x, top: placing.y, width: w, height: h }
  }

  return (
    <div className={`pdf-annotator${disabled ? ' is-disabled' : ''}`}>
      <div className="pdf-annotator-toolbar">
        <button
          type="button"
          className={`btn btn-ghost${tool === 'select' ? ' is-active' : ''}`}
          onClick={() => setTool('select')}
          disabled={disabled}
        >
          <MousePointer2 size={14} strokeWidth={2.25} aria-hidden />
          Select
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'signature' ? ' is-active' : ''}`}
          onClick={() => setTool('signature')}
          disabled={disabled || !sigDataUrl}
          title={!sigDataUrl ? 'Draw a signature first' : 'Place signature on the page'}
        >
          <PenLine size={14} strokeWidth={2.25} aria-hidden />
          Place signature
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'text' ? ' is-active' : ''}`}
          onClick={() => setTool('text')}
          disabled={disabled || !textDraft.trim()}
          title={!textDraft.trim() ? 'Enter text first' : 'Place text on the page'}
        >
          <Type size={14} strokeWidth={2.25} aria-hidden />
          Place text
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'checkmark' ? ' is-active' : ''}`}
          onClick={() => setTool('checkmark')}
          disabled={disabled || !canAddMark(annotations)}
          title="Place a checkmark"
        >
          <Check size={14} strokeWidth={2.5} aria-hidden />
          Check
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'cross' ? ' is-active' : ''}`}
          onClick={() => setTool('cross')}
          disabled={disabled || !canAddMark(annotations)}
          title="Place an X mark"
        >
          <X size={14} strokeWidth={2.5} aria-hidden />
          X mark
        </button>
        <div className="pdf-annotator-pages">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || pageNumber <= 1}
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span>
            Page {pageNumber} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || pageNumber >= pageCount}
            onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      <div className="pdf-annotator-layout">
        <div className="pdf-annotator-stage">
          {loading && <p className="pdf-annotator-hint">Loading document…</p>}
          {loadError && <p className="pdf-annotator-hint">{loadError}</p>}
          <div
            ref={wrapRef}
            className={`pdf-annotator-page-wrap${tool !== 'select' ? ' is-tool-active' : ''}`}
            style={{ width: cssSize.width }}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerCancel}
            onPointerLeave={() => {
              if (isPlaceTool && !placeGestureRef.current) {
                setPlacing(null)
              }
            }}
          >
            <canvas ref={canvasRef} />
            <div className="pdf-annotator-layer">
              {pageAnnotations.map(ann => {
                const r = normalizedToCanvasRect(ann, cssSize.width, cssSize.height)
                const selected = selectedId === ann.id
                return (
                  <div
                    key={ann.id}
                    className={`pdf-annotator-item${selected ? ' is-selected' : ''}${
                      dragRef.current?.id === ann.id ? ' is-dragging' : ''
                    }`}
                    style={{
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                    }}
                    onPointerDown={e => startItemDrag(e, ann.id)}
                  >
                    {ann.type === 'signature' ? (
                      ann.path && ann.path.strokes.length > 0 ? (
                        <SignaturePathPreview path={ann.path} width={r.width} height={r.height} />
                      ) : ann.imageDataUrl ? (
                        <img
                          src={ensureDataUrl(ann.imageDataUrl)}
                          alt="Signature"
                          draggable={false}
                        />
                      ) : null
                    ) : ann.type === 'checkmark' || ann.type === 'cross' ? (
                      <MarkPreview
                        kind={ann.type}
                        color={ann.color ?? (ann.type === 'checkmark' ? '#0f766e' : '#b91c1c')}
                        width={r.width}
                        height={r.height}
                      />
                    ) : ann.type === 'text' ? (
                      <div
                        className="pdf-annotator-item-text"
                        style={{
                          fontSize: `${Math.max(8, (ann.fontSizeRatio ?? 0.025) * cssSize.height)}px`,
                          color: ann.color ?? '#0f172a',
                        }}
                      >
                        {ann.text}
                      </div>
                    ) : null}
                  </div>
                )
              })}
              {placing &&
                (tool === 'signature' ||
                  tool === 'text' ||
                  tool === 'checkmark' ||
                  tool === 'cross') && (
                  <div className="pdf-annotator-ghost" style={ghostStyle()}>
                    {placing.type === 'signature' && sigDataUrl ? (
                      <img src={sigDataUrl} alt="" draggable={false} />
                    ) : placing.type === 'checkmark' || placing.type === 'cross' ? (
                      <MarkPreview
                        kind={placing.type}
                        color={placing.type === 'checkmark' ? '#0f766e' : '#b91c1c'}
                        width={defaultMarkSize.width * cssSize.width}
                        height={defaultMarkSize.height * cssSize.height}
                      />
                    ) : (
                      <div className="pdf-annotator-item-text">{textDraft}</div>
                    )}
                  </div>
                )}
            </div>
          </div>
        </div>

        <aside className="pdf-annotator-side">
          <h4>Draw signature</h4>
          <SignatureStrokePad onChange={setSigDraft} disabled={disabled} />
          {sigDraft && (
            <p className="pdf-annotator-hint">
              Path: {sigDraft.rawPoints} pts → {sigDraft.simplifiedPoints} after RDP ε=
              {SIGNATURE_RDP_EPSILON_PX} (
              {sigDraft.rawPoints > 0
                ? Math.round((1 - sigDraft.simplifiedPoints / sigDraft.rawPoints) * 100)
                : 0}
              % fewer)
            </p>
          )}
          {sigDataUrl && sigPath && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={disabled || !canAddSignature(annotations)}
              onClick={() => {
                if (!canAddSignature(annotations)) {
                  setPlaceError(
                    `Signature limit reached (${MAX_SIGNATURE_ANNOTATIONS} per agreement / credit).`,
                  )
                  return
                }
                setPlaceError(null)
                setTool('signature')
              }}
            >
              <PenLine size={14} strokeWidth={2.25} aria-hidden />
              Click page to place
            </button>
          )}

          <h4>
            Text stamp ({counts.texts}/{MAX_TEXT_ANNOTATIONS})
          </h4>
          <textarea
            className="pdf-annotator-text-input"
            value={textDraft}
            onChange={e => setTextDraft(e.target.value)}
            placeholder="e.g. Agreed — Jane Doe"
            disabled={disabled || !canAddText(annotations)}
            rows={2}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || !textDraft.trim() || !canAddText(annotations)}
            onClick={() => {
              if (!canAddText(annotations)) {
                setPlaceError(
                  `Text stamp limit reached (${MAX_TEXT_ANNOTATIONS} per agreement / credit).`,
                )
                return
              }
              setPlaceError(null)
              setTool('text')
            }}
          >
            <Type size={14} strokeWidth={2.25} aria-hidden />
            Click page to place text
          </button>

          {placeError && (
            <p className="pdf-annotator-hint" role="alert" style={{ color: '#b91c1c' }}>
              {placeError}
            </p>
          )}

          <h4>
            Annotations ({counts.signatures} sig · {counts.texts} text · {counts.marks} marks)
          </h4>
          <p className="pdf-annotator-hint">
            Per credit (1 seal): up to {MAX_SIGNATURE_ANNOTATIONS} signatures,{' '}
            {MAX_TEXT_ANNOTATIONS} text, {MAX_MARK_ANNOTATIONS} check/X marks.
          </p>
          {annotations.length === 0 ? (
            <p className="pdf-annotator-hint">None yet — place a signature or text on a page.</p>
          ) : (
            <ul className="pdf-annotator-list">
              {annotations.map(a => (
                <li key={a.id} className={selectedId === a.id ? 'is-selected' : ''}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={() => {
                      setSelectedId(a.id)
                      setPageNumber(a.pageIndex + 1)
                      setTool('select')
                    }}
                  >
                    p{a.pageIndex + 1} · {a.type}
                    {a.type === 'text'
                      ? `: ${a.text.slice(0, 24)}`
                      : a.type === 'signature' && a.path
                        ? ` · ${countPathPoints(a.path)} pts`
                        : ''}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label="Remove annotation"
                    disabled={disabled}
                    onClick={() => removeAnnotation(a.id)}
                  >
                    <Trash2 size={14} strokeWidth={2.25} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {annotations.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={disabled}
              onClick={() => {
                onChange([])
                setSelectedId(null)
                setPlaceError(null)
              }}
            >
              <Eraser size={14} strokeWidth={2.25} aria-hidden />
              Clear all
            </button>
          )}
          <p className="pdf-annotator-hint">
            Document stays on this device. Hash + annotation paths/text go to the server — never the
            file bytes.
          </p>
        </aside>
      </div>
    </div>
  )
}

/** Lightweight canvas preview of a unit-square path inside the annotation box. */
function SignaturePathPreview({
  path,
  width,
  height,
}: {
  path: SignaturePathData
  width: number
  height: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    paintSignaturePath(ctx, path, { left: 0, top: 0, width, height })
  }, [path, width, height])
  return <canvas ref={ref} aria-hidden style={{ display: 'block', width, height }} />
}

function MarkPreview({
  kind,
  color,
  width,
  height,
}: {
  kind: 'checkmark' | 'cross'
  color: string
  width: number
  height: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    paintMark(ctx, kind, { left: 0, top: 0, width, height }, color)
  }, [kind, color, width, height])
  return <canvas ref={ref} aria-hidden style={{ display: 'block', width, height }} />
}
