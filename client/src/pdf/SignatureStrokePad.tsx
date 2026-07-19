import { Eraser } from 'lucide-react'
import { useEffect, useRef, type CSSProperties } from 'react'
import {
  normalizeInk,
  simplifyInk,
  type SignatureInk,
  type StrokePoint,
} from './signatureCodec'
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
}

const LINE_WIDTH = 2.25

/**
 * Draw pad that records strokes, applies RDP, emits path + PNG preview.
 * Used by PDF annotator (not the wallet-sign SignaturePad).
 */
export function SignatureStrokePad({
  onChange,
  disabled = false,
  epsilon = SIGNATURE_RDP_EPSILON_PX,
  productMode = false,
  label = 'Draw your signature',
  padAspect,
  className,
}: SignatureStrokePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const currentStroke = useRef<StrokePoint[]>([])
  const inkRef = useRef<SignatureInk | null>(null)
  const hasInk = useRef(false)
  const aspect =
    padAspect != null && Number.isFinite(padAspect) && padAspect > 0.05 && padAspect < 20
      ? padAspect
      : null

  const padSize = () => {
    const canvas = canvasRef.current
    if (!canvas) return { w: 1, h: 1 }
    const rect = canvas.getBoundingClientRect()
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) }
  }

  const ensureInk = (): SignatureInk => {
    if (inkRef.current) return inkRef.current
    const { w, h } = padSize()
    inkRef.current = { width: w, height: h, lineWidth: LINE_WIDTH, strokes: [] }
    return inkRef.current
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const prev = hasInk.current ? canvas.toDataURL() : null
      canvas.width = Math.max(1, Math.floor(rect.width * 2))
      canvas.height = Math.max(1, Math.floor(rect.height * 2))
      ctx.setTransform(2, 0, 0, 2, 0, 0)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = LINE_WIDTH
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (prev && hasInk.current) {
        const img = new Image()
        img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height)
        img.src = prev
      }
      // Keep logical pad size in sync for new strokes
      if (inkRef.current) {
        inkRef.current = {
          ...inkRef.current,
          width: rect.width,
          height: rect.height,
        }
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const emit = () => {
    const ink = inkRef.current
    const canvas = canvasRef.current
    if (!ink || !canvas || !hasInk.current || ink.strokes.length === 0) {
      onChange(null)
      return
    }
    const rawPoints = ink.strokes.reduce((n, s) => n + s.points.length, 0)
    const simplified = simplifyInk(ink, epsilon)
    const simplifiedPoints = simplified.strokes.reduce((n, s) => n + s.points.length, 0)
    const unit = normalizeInk(simplified)
    const minSide = Math.min(ink.width, ink.height)
    const captureAspect = ink.width / Math.max(1, ink.height)
    const path: SignaturePathData = {
      epsilon,
      lineWidthRatio: LINE_WIDTH / Math.max(1, minSide),
      captureAspect,
      strokes: unit.strokes.map(s => ({
        points: s.points.map(p => ({ x: p.x, y: p.y })),
      })),
    }
    const imageDataUrl = canvas.toDataURL('image/png')
    onChange({ imageDataUrl, path, rawPoints, simplifiedPoints, epsilon })
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    drawing.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    const ink = ensureInk()
    const p = point(e)
    currentStroke.current = [p]
    const ctx = canvasRef.current?.getContext('2d')
    ctx?.beginPath()
    ctx?.moveTo(p.x, p.y)
    void ink
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    const p = point(e)
    currentStroke.current.push(p)
    const ctx = canvasRef.current?.getContext('2d')
    ctx?.lineTo(p.x, p.y)
    ctx?.stroke()
    ctx?.beginPath()
    ctx?.moveTo(p.x, p.y)
    hasInk.current = true
  }

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (currentStroke.current.length > 0) {
      const ink = ensureInk()
      ink.strokes.push({ points: currentStroke.current.slice() })
      currentStroke.current = []
      emit()
    }
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    inkRef.current = null
    hasInk.current = false
    currentStroke.current = []
    onChange(null)
  }

  return (
    <div
      className={[
        'sig-pad',
        disabled ? 'sig-pad--disabled' : '',
        productMode ? 'sig-pad--product' : '',
        aspect != null ? 'sig-pad--aspect' : '',
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
      <div className="sig-pad-label-row">
        <span className="field-label">{label}</span>
        <button type="button" className="btn btn-ghost sig-pad-clear" onClick={clear} disabled={disabled}>
          <Eraser size={14} strokeWidth={2.25} aria-hidden />
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="sig-pad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {productMode ? (
        <p className="sig-pad-hint muted">Draw with your finger or mouse. Clear to start over.</p>
      ) : (
        <p className="sig-pad-hint muted">
          Vector ink with RDP ε={epsilon}px (lab default). PNG is preview only — path is what we keep.
        </p>
      )}
    </div>
  )
}
