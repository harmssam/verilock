import { Eraser } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface SignaturePadProps {
  /** Called with PNG blob when ink changes; null when cleared. */
  onChange: (blob: Blob | null) => void
  disabled?: boolean
}

/** Draw-to-sign pad - image stays local until submit. */
export function SignaturePad({ onChange, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const prev = canvas.toDataURL()
      canvas.width = Math.max(1, Math.floor(rect.width * 2))
      canvas.height = Math.max(1, Math.floor(rect.height * 2))
      ctx.setTransform(2, 0, 0, 2, 0, 0)
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2.25
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      // restore is lossy after resize; clear is fine for demo
      if (hasInk.current) {
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height)
        }
        img.src = prev
      }
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    drawing.current = true
    canvasRef.current?.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current?.getContext('2d')
    const p = point(e)
    ctx?.beginPath()
    ctx?.moveTo(p.x, p.y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    const p = point(e)
    ctx?.lineTo(p.x, p.y)
    ctx?.stroke()
    if (!hasInk.current) {
      hasInk.current = true
    }
  }

  const emitBlob = () => {
    const canvas = canvasRef.current
    if (!canvas || !hasInk.current) {
      onChange(null)
      return
    }
    canvas.toBlob(blob => onChange(blob), 'image/png')
  }

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    emitBlob()
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    hasInk.current = false
    onChange(null)
  }

  return (
    <div className={`sig-pad${disabled ? ' sig-pad--disabled' : ''}`}>
      <div className="sig-pad-label-row">
        <span className="field-label">Draw your signature</span>
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
      <p className="sig-pad-hint muted">
        Draw with mouse or finger. Image stays on this device until you sign.
      </p>
    </div>
  )
}
