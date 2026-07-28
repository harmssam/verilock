/**
 * Shared empty/checked check & X field rendering (placement editor + signer view).
 */
import { useEffect, useRef } from 'react'
import { paintMark, paintMarkBox } from './annotations'

export function MarkFieldCanvas({
  kind,
  checked,
  color,
  width,
  height,
  className,
}: {
  kind: 'checkmark' | 'cross'
  /** False = empty square only; true = square + check/X. */
  checked: boolean
  color: string
  width: number
  height: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    c.width = Math.max(1, Math.round(width * dpr))
    c.height = Math.max(1, Math.round(height * dpr))
    c.style.width = `${width}px`
    c.style.height = `${height}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const rect = { left: 0, top: 0, width, height }
    paintMarkBox(ctx, rect, color)
    if (checked) {
      paintMark(ctx, kind, rect, color)
    }
  }, [kind, checked, color, width, height])

  return (
    <canvas
      ref={ref}
      className={[className, checked ? 'is-checked' : 'is-empty'].filter(Boolean).join(' ')}
      aria-hidden
    />
  )
}
