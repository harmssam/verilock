/**
 * Signature encoding lab — draw once, compare raster vs path simplification.
 * Route: /pdf/lab
 */
import { Eraser, PenLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FRAME_HEADER_BYTES,
  FRAME_PAYLOAD_BYTES,
  NIMIQ_PAYLOAD_BYTES,
  cloneInk,
  countPoints,
  measurePngVariants,
  measureVectorRows,
  paintInkOnCanvas,
  renderInkToCanvas,
  simplifyInk,
  type EncodingRow,
  type SignatureInk,
  type StrokePoint,
} from '../pdf/signatureCodec'
import './SignatureLab.css'

const PAD_CSS_W = 560
const PAD_CSS_H = 200
const LINE_WIDTH = 2.25

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function SignatureLab() {
  const padRef = useRef<HTMLCanvasElement>(null)
  const rawPrevRef = useRef<HTMLCanvasElement>(null)
  const simpPrevRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const currentStroke = useRef<StrokePoint[]>([])
  const inkRef = useRef<SignatureInk>({
    width: PAD_CSS_W,
    height: PAD_CSS_H,
    lineWidth: LINE_WIDTH,
    strokes: [],
  })

  const [ink, setInk] = useState<SignatureInk>(inkRef.current)
  const [epsilon, setEpsilon] = useState(1.5)
  const [rows, setRows] = useState<EncodingRow[]>([])
  const [measuring, setMeasuring] = useState(false)

  const simplified = useMemo(() => simplifyInk(ink, epsilon), [ink, epsilon])
  const rawPts = countPoints(ink)
  const simpPts = countPoints(simplified)
  const reduction =
    rawPts > 0 ? Math.round((1 - simpPts / rawPts) * 100) : 0

  const redrawPad = useCallback((source: SignatureInk) => {
    const canvas = padRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(PAD_CSS_W * dpr)
    canvas.height = Math.floor(PAD_CSS_H * dpr)
    canvas.style.width = `${PAD_CSS_W}px`
    canvas.style.height = `${PAD_CSS_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#fafdfc'
    ctx.fillRect(0, 0, PAD_CSS_W, PAD_CSS_H)
    // guide line
    ctx.strokeStyle = 'rgba(15,23,42,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(16, PAD_CSS_H * 0.72)
    ctx.lineTo(PAD_CSS_W - 16, PAD_CSS_H * 0.72)
    ctx.stroke()
    paintInkOnCanvas(ctx, source, PAD_CSS_W, PAD_CSS_H)
  }, [])

  const redrawPreviews = useCallback((raw: SignatureInk, simp: SignatureInk) => {
    const paint = (el: HTMLCanvasElement | null, source: SignatureInk) => {
      if (!el) return
      const rendered = renderInkToCanvas(source, PAD_CSS_W, PAD_CSS_H)
      el.width = rendered.width
      el.height = rendered.height
      el.style.width = '100%'
      el.style.height = 'auto'
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.drawImage(rendered, 0, 0)
    }
    paint(rawPrevRef.current, raw)
    paint(simpPrevRef.current, simp)
  }, [])

  useEffect(() => {
    redrawPad(ink)
  }, [ink, redrawPad])

  useEffect(() => {
    redrawPreviews(ink, simplified)
  }, [ink, simplified, redrawPreviews])

  useEffect(() => {
    let cancelled = false
    if (rawPts === 0) {
      setRows([])
      return
    }
    setMeasuring(true)
    void (async () => {
      try {
        const png = await measurePngVariants(ink)
        const vec = measureVectorRows(ink, simplified, epsilon)
        if (!cancelled) setRows([...vec, ...png])
      } finally {
        if (!cancelled) setMeasuring(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ink, simplified, epsilon, rawPts])

  const localPoint = (e: React.PointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = padRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * PAD_CSS_W
    const y = ((e.clientY - rect.top) / rect.height) * PAD_CSS_H
    return { x, y }
  }

  const commitInk = (next: SignatureInk) => {
    inkRef.current = next
    setInk(cloneInk(next))
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = true
    padRef.current?.setPointerCapture(e.pointerId)
    currentStroke.current = [localPoint(e)]
    const ctx = padRef.current?.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = LINE_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const p = currentStroke.current[0]!
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const p = localPoint(e)
    currentStroke.current.push(p)
    const ctx = padRef.current?.getContext('2d')
    if (!ctx) return
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    try {
      padRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (currentStroke.current.length > 0) {
      const next: SignatureInk = {
        ...inkRef.current,
        strokes: [...inkRef.current.strokes, { points: currentStroke.current.slice() }],
      }
      currentStroke.current = []
      commitInk(next)
    }
  }

  const clear = () => {
    commitInk({
      width: PAD_CSS_W,
      height: PAD_CSS_H,
      lineWidth: LINE_WIDTH,
      strokes: [],
    })
  }

  const bestVector = useMemo(() => {
    const vectors = rows.filter(r => r.id.startsWith('path-') || r.id.startsWith('svg-'))
    if (vectors.length === 0) return null
    return vectors.reduce((a, b) => (a.bytes <= b.bytes ? a : b))
  }, [rows])

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.bytes - b.bytes),
    [rows],
  )

  return (
    <div className="sig-lab">
      <p className="sig-lab-links">
        <a href="/pdf">← PDF annotate experiment</a>
      </p>
      <h1>
        <PenLine size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
        Signature encoding lab
      </h1>
      <p className="sig-lab-lead">
        Draw a signature once, then compare <strong>raster PNG</strong> vs{' '}
        <strong>vector path</strong> (raw points vs Ramer–Douglas–Peucker simplification). Sizes are
        measured live; “Nimiq frames” assumes {NIMIQ_PAYLOAD_BYTES}&nbsp;B total /{' '}
        {FRAME_HEADER_BYTES}&nbsp;B header → <code>{FRAME_PAYLOAD_BYTES}&nbsp;B</code> payload per
        basic tx (fees ~0, so frame count is about latency/indexing, not cost).
      </p>

      <div className="sig-lab-card" style={{ marginBottom: '1rem' }}>
        <h2>Draw</h2>
        <p className="sig-lab-card-meta">
          Strokes are recorded as points (not only pixels). Pad {PAD_CSS_W}×{PAD_CSS_H} CSS px.
        </p>
        <div className="sig-lab-pad-wrap">
          <canvas
            ref={padRef}
            width={PAD_CSS_W}
            height={PAD_CSS_H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
        <div className="sig-lab-actions">
          <button type="button" className="btn btn-ghost" onClick={clear}>
            <Eraser size={14} strokeWidth={2.25} aria-hidden />
            Clear
          </button>
        </div>
      </div>

      <div className="sig-lab-controls">
        <label>
          <span>
            RDP epsilon · <span className="sig-lab-val">{epsilon.toFixed(1)} px</span>
          </span>
          <input
            type="range"
            min={0}
            max={8}
            step={0.1}
            value={epsilon}
            onChange={e => setEpsilon(Number(e.target.value))}
            disabled={rawPts === 0}
          />
        </label>
        <div style={{ fontSize: '0.82rem', color: '#334155' }}>
          Points: <strong>{rawPts}</strong> raw → <strong>{simpPts}</strong> simplified
          {rawPts > 0 ? ` (${reduction}% fewer)` : ''}
          {measuring ? ' · measuring…' : ''}
        </div>
      </div>

      <div className="sig-lab-grid">
        <div className="sig-lab-card">
          <h2>Raw strokes</h2>
          <p className="sig-lab-card-meta">{rawPts} points · all samples</p>
          <div className="sig-lab-preview">
            <canvas ref={rawPrevRef} />
          </div>
        </div>
        <div className="sig-lab-card">
          <h2>Simplified (RDP)</h2>
          <p className="sig-lab-card-meta">
            {simpPts} points · ε = {epsilon.toFixed(1)}px
          </p>
          <div className="sig-lab-preview">
            <canvas ref={simpPrevRef} />
          </div>
        </div>
      </div>

      <div className="sig-lab-card" style={{ marginTop: '1rem' }}>
        <h2>Size comparison</h2>
        <p className="sig-lab-card-meta">
          Sorted smallest first. Binary path sizes are structured estimates (delta + fixed-bit
          coords), not a final wire codec — good enough to rank methods.
        </p>
        {rawPts === 0 ? (
          <p className="sig-lab-card-meta">Draw a signature to populate the table.</p>
        ) : (
          <div className="sig-lab-table-wrap">
            <table className="sig-lab-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Detail</th>
                  <th>Size</th>
                  <th>Points</th>
                  <th>~Frames</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => (
                  <tr
                    key={row.id}
                    className={bestVector && row.id === bestVector.id ? 'is-best' : undefined}
                  >
                    <td>
                      {row.label}
                      {bestVector && row.id === bestVector.id ? (
                        <div className="muted">smallest vector-ish row</div>
                      ) : null}
                    </td>
                    <td className="muted">{row.detail}</td>
                    <td className="num">{formatBytes(row.bytes)}</td>
                    <td className="num">{row.points ?? '—'}</td>
                    <td className="num">{row.frames}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="sig-lab-note">
          Rule of thumb: if simplified path is a few hundred bytes (~10 frames) and still looks
          like your hand, that’s the encoding to take on-chain. PNG rows show why raster is a poor
          default even when fees are free (hundreds of frames + blur when tiny).
        </p>
      </div>
    </div>
  )
}

export default SignatureLab
