import { Eraser } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'
import { simplifyStroke, type StrokePoint } from './signatureCodec'
import { SIGNATURE_RDP_EPSILON_PX } from './annotationLimits'
import type { SignaturePathData } from './annotations'

export interface SignatureStrokeResult {
  /** PNG preview for drag ghost / fallback */
  imageDataUrl: string
  /** RDP-simplified path in unit square (primary ink) */
  path: SignaturePathData
  /** Point counts for UI */
  rawPoints: number
  simplifiedPoints: number
  epsilon: number
}

interface SignatureStrokePadProps {
  onChange: (result: SignatureStrokeResult | null) => void
  disabled?: boolean
  /** Override lab default (1.5). */
  epsilon?: number
  /** Hide RDP / lab instrumentation copy (product signing UI). */
  productMode?: boolean
  /** Optional label override (default: Draw your signature). */
  label?: string
  /**
   * Pad width ÷ height (e.g. PDF field aspect). When set, the canvas matches
   * that shape so capture matches placement and ink is not stretched later.
   */
  padAspect?: number
  className?: string
  /** Compact chrome for full-screen mobile capture. */
  compact?: boolean
}

/** CSS-pixel stroke weight at a 160px reference min-side (stable across resize). */
const LINE_WIDTH_CSS = 2.25
const LINE_WIDTH_REF_MIN = 160

type UnitStroke = { points: Array<{ x: number; y: number }> }

/**
 * Draw pad that records strokes in unit coords (0–1), so rotate/resize never
 * changes relative thickness or warps earlier strokes.
 */
export function SignatureStrokePad({
  onChange,
  disabled = false,
  epsilon = SIGNATURE_RDP_EPSILON_PX,
  productMode = false,
  label = 'Draw your signature',
  padAspect,
  className,
  compact = false,
}: SignatureStrokePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const currentStroke = useRef<StrokePoint[]>([])
  /** Completed strokes in unit coords (stable across orientation changes). */
  const unitStrokesRef = useRef<UnitStroke[]>([])
  const rawPointCountRef = useRef(0)
  /** Locked on first stroke so thickness is independent of later resize. */
  const lineWidthRatioRef = useRef<number | null>(null)
  const captureAspectRef = useRef<number | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const aspect =
    padAspect != null && Number.isFinite(padAspect) && padAspect > 0.05 && padAspect < 20
      ? padAspect
      : null

  const padCssSize = () => {
    const canvas = canvasRef.current
    if (!canvas) return { w: 1, h: 1 }
    const rect = canvas.getBoundingClientRect()
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) }
  }

  const lockMetricsIfNeeded = () => {
    const { w, h } = padCssSize()
    if (lineWidthRatioRef.current == null) {
      // Thickness relative to a fixed reference so rotate doesn't change weight.
      lineWidthRatioRef.current = LINE_WIDTH_CSS / LINE_WIDTH_REF_MIN
    }
    if (captureAspectRef.current == null) {
      captureAspectRef.current = w / h
    }
  }

  const cssLineWidth = () => {
    const { w, h } = padCssSize()
    const ratio = lineWidthRatioRef.current ?? LINE_WIDTH_CSS / LINE_WIDTH_REF_MIN
    // Cap so small pads stay usable; floor so thin screens aren't hairlines.
    return Math.max(1.5, Math.min(4.5, ratio * Math.min(w, h)))
  }

  const paintAll = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { w, h } = padCssSize()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const bw = Math.max(1, Math.floor(w * dpr))
    const bh = Math.max(1, Math.floor(h * dpr))
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw
      canvas.height = bh
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = cssLineWidth()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const drawStroke = (pts: Array<{ x: number; y: number }>) => {
      if (pts.length === 0) return
      ctx.beginPath()
      ctx.moveTo(pts[0]!.x * w, pts[0]!.y * h)
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i]!.x * w, pts[i]!.y * h)
      }
      ctx.stroke()
    }

    for (const s of unitStrokesRef.current) drawStroke(s.points)

    // Live stroke still in CSS px
    if (currentStroke.current.length > 0) {
      const live = currentStroke.current
      ctx.beginPath()
      ctx.moveTo(live[0]!.x, live[0]!.y)
      for (let i = 1; i < live.length; i++) {
        ctx.lineTo(live[i]!.x, live[i]!.y)
      }
      ctx.stroke()
    }
  }

  const emit = () => {
    const canvas = canvasRef.current
    if (!canvas || unitStrokesRef.current.length === 0) {
      onChangeRef.current(null)
      return
    }
    const simplified = unitStrokesRef.current.map(s => ({
      points: simplifyStroke(
        s.points.map(p => ({ x: p.x, y: p.y })),
        // Epsilon is in unit space: map pad px epsilon into [0,1]
        epsilon / Math.max(1, Math.min(padCssSize().w, padCssSize().h)),
      ).map(p => ({ x: p.x, y: p.y })),
    }))
    const simplifiedPoints = simplified.reduce((n, s) => n + s.points.length, 0)
    const path: SignaturePathData = {
      epsilon,
      lineWidthRatio: lineWidthRatioRef.current ?? LINE_WIDTH_CSS / LINE_WIDTH_REF_MIN,
      captureAspect: captureAspectRef.current ?? padCssSize().w / padCssSize().h,
      strokes: simplified.filter(s => s.points.length > 0),
    }
    // Snapshot after paint
    paintAll()
    const imageDataUrl = canvas.toDataURL('image/png')
    onChangeRef.current({
      imageDataUrl,
      path,
      rawPoints: rawPointCountRef.current,
      simplifiedPoints,
      epsilon,
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      paintAll()
      // Re-emit so parent PNG preview matches new orientation without changing path.
      if (unitStrokesRef.current.length > 0) emit()
    }

    resize()
    const ro = new ResizeObserver(() => {
      // rAF: layout may still be settling after orientation change
      requestAnimationFrame(resize)
    })
    ro.observe(canvas)
    window.addEventListener('orientationchange', resize)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', resize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paint/emit use refs
  }, [])

  const pointCss = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const toUnit = (p: StrokePoint) => {
    const { w, h } = padCssSize()
    return {
      x: Math.min(1, Math.max(0, p.x / w)),
      y: Math.min(1, Math.max(0, p.y / h)),
    }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    // Prevent page pan/scroll while drawing (critical on mobile landscape + scrollable modals).
    e.preventDefault()
    drawing.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    lockMetricsIfNeeded()
    const p = pointCss(e)
    currentStroke.current = [p]
    paintAll()
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    e.preventDefault()
    const p = pointCss(e)
    currentStroke.current.push(p)
    // Incremental draw for responsiveness
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx && currentStroke.current.length >= 2) {
      const prev = currentStroke.current[currentStroke.current.length - 2]!
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = cssLineWidth()
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(prev.x, prev.y)
      ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }
  }

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    drawing.current = false
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (currentStroke.current.length > 0) {
      lockMetricsIfNeeded()
      const unitPts = currentStroke.current.map(toUnit)
      rawPointCountRef.current += unitPts.length
      unitStrokesRef.current.push({ points: unitPts })
      currentStroke.current = []
      paintAll()
      emit()
    }
  }

  const clear = () => {
    unitStrokesRef.current = []
    currentStroke.current = []
    rawPointCountRef.current = 0
    lineWidthRatioRef.current = null
    captureAspectRef.current = aspect
    paintAll()
    onChangeRef.current(null)
  }

  return (
    <div
      className={[
        'sig-pad',
        disabled ? 'sig-pad--disabled' : '',
        productMode ? 'sig-pad--product' : '',
        aspect != null ? 'sig-pad--aspect' : '',
        compact ? 'sig-pad--compact' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={
        aspect != null
          ? ({ ['--sig-pad-aspect']: String(aspect) } as CSSProperties)
          : undefined
      }
    >
      {!compact && (
        <div className="sig-pad-label-row">
          <span className="field-label">{label}</span>
          <button
            type="button"
            className="btn btn-ghost sig-pad-clear"
            onClick={clear}
            disabled={disabled}
          >
            <Eraser size={14} strokeWidth={2.25} aria-hidden />
            Clear
          </button>
        </div>
      )}
      {compact && (
        <button
          type="button"
          className="btn btn-ghost sig-pad-clear sig-pad-clear--float"
          onClick={clear}
          disabled={disabled}
          aria-label="Clear signature"
        >
          <Eraser size={16} strokeWidth={2.25} aria-hidden />
          Clear
        </button>
      )}
      <canvas
        ref={canvasRef}
        className="sig-pad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        // React 17+ registers passive listeners for touch; pointer + touch-action:none
        // is the supported path. Keep the canvas non-passive via CSS touch-action.
        style={{ touchAction: 'none' }}
      />
      {!compact &&
        (productMode ? (
          <p className="sig-pad-hint muted">Draw with your finger or mouse. Clear to start over.</p>
        ) : (
          <p className="sig-pad-hint muted">
            Vector ink with RDP ε={epsilon}px (lab default). PNG is preview only — path is what we
            keep.
          </p>
        ))}
    </div>
  )
}
