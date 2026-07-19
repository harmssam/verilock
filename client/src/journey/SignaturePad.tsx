import { Eraser, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface SignaturePadProps {
  /** Called with PNG blob when ink changes; null when cleared. */
  onChange: (blob: Blob | null) => void
  disabled?: boolean
  /** Larger canvas + thicker stroke for mobile capture. */
  large?: boolean
  /** Optional label override. */
  label?: string
  /** Hide the privacy hint line. */
  hideHint?: boolean
}

type Point = { x: number; y: number }
type Stroke = Point[]

/** Draw-to-sign pad — image stays local until submit. Supports undo last stroke. */
export function SignaturePad({
  onChange,
  disabled,
  large = false,
  label = 'Draw your signature',
  hideHint = false,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const strokes = useRef<Stroke[]>([])
  const current = useRef<Stroke>([])

  const redraw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    ctx.setTransform(2, 0, 0, 2, 0, 0)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = large ? 3 : 2.25
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const all = [...strokes.current, ...(current.current.length ? [current.current] : [])]
    for (const stroke of all) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      ctx.moveTo(stroke[0]!.x, stroke[0]!.y)
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i]!.x, stroke[i]!.y)
      }
      ctx.stroke()
    }
    void rect
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.max(1, Math.floor(rect.width * 2))
      canvas.height = Math.max(1, Math.floor(rect.height * 2))
      redraw()
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw reads refs
  }, [large])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const emitBlob = () => {
    const canvas = canvasRef.current
    if (!canvas || strokes.current.length === 0) {
      onChange(null)
      return
    }
    canvas.toBlob(blob => onChange(blob), 'image/png')
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    e.preventDefault()
    drawing.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    current.current = [point(e)]
    redraw()
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    e.preventDefault()
    current.current.push(point(e))
    redraw()
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
    if (current.current.length > 0) {
      strokes.current.push(current.current)
    }
    current.current = []
    redraw()
    emitBlob()
  }

  const clear = () => {
    strokes.current = []
    current.current = []
    redraw()
    onChange(null)
  }

  const undo = () => {
    if (strokes.current.length === 0) return
    strokes.current.pop()
    redraw()
    emitBlob()
  }

  return (
    <div className={`sig-pad${disabled ? ' sig-pad--disabled' : ''}${large ? ' sig-pad--large' : ''}`}>
      <div className="sig-pad-label-row">
        <span className="field-label">{label}</span>
        <span className="sig-pad-actions">
          <button
            type="button"
            className="btn btn-ghost sig-pad-clear"
            onClick={undo}
            disabled={disabled}
            aria-label="Undo last stroke"
          >
            <Undo2 size={14} strokeWidth={2.25} aria-hidden />
            Undo
          </button>
          <button
            type="button"
            className="btn btn-ghost sig-pad-clear"
            onClick={clear}
            disabled={disabled}
          >
            <Eraser size={14} strokeWidth={2.25} aria-hidden />
            Clear
          </button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        className="sig-pad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {!hideHint && (
        <p className="sig-pad-hint muted">
          Draw with mouse or finger. Image stays on this device until you sign.
        </p>
      )}
    </div>
  )
}
