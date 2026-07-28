/**
 * Full-screen ink capture for phones — shared by QR /m/sign and in-app field signing.
 *
 * - Real OS landscape: normal landscape pad sizing.
 * - Phone portrait (mobile browser **or** Nimiq Pay): skip the rotate gate; **force
 *   landscape frame** via JS pixel geometry + rotate(90deg). Pay is a portrait-locked
 *   browser shell — same pad UX works in Safari/Chrome without requiring OS rotate.
 * - Desktop portrait (rare): blocking rotate gate if this sheet is shown.
 */
import { X } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useIsLandscape, useIsRealPortrait } from '../useViewport'
import { paintSignaturePath, type SignaturePathData } from './annotations'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './SignatureStrokePad'
import './InkCaptureSheet.css'

/** Turn (1.4s) + short hold (~0.25s), then fade (~0.3s). */
const PORTRAIT_GUIDE_VISIBLE_MS = 1650
const PORTRAIT_GUIDE_FADE_MS = 300

export type InkCaptureFieldKind = 'signature' | 'initial'

/** Simple iPhone outline used for the rotate nudge / one-shot guide. */
function IPhoneOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={52}
      height={88}
      viewBox="0 0 48 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="3.5"
        y="1.5"
        width="41"
        height="77"
        rx="9"
        stroke="currentColor"
        strokeWidth="2.25"
      />
      <rect x="16" y="5.5" width="16" height="4" rx="2" fill="currentColor" />
      <rect
        x="8"
        y="14"
        width="32"
        height="50"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.35"
      />
      <rect x="17" y="69" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

/**
 * Forced landscape frame for portrait-locked hosts (Nimiq Pay / mobile browsers).
 *
 * Layout box is landscape-sized (long = physical height, short = physical width),
 * centered, then rotated 90° so it fills the portrait viewport. Hold phone on its side.
 *
 * Pad size is NOT computed here — head + pad stage + Done dock are in-flow flex
 * children; the stage uses container queries so the canvas fills remaining space
 * at the field aspect without overlapping the green button.
 */
function useForcedLandscapeFrame(enabled: boolean): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined)

  useLayoutEffect(() => {
    if (!enabled) {
      setStyle(undefined)
      return
    }

    const apply = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (vw < 1 || vh < 1) return
      // Landscape logical size: width = long edge, height = short edge
      const frameW = vh
      const frameH = vw

      setStyle({
        position: 'fixed',
        zIndex: 230,
        width: frameW,
        height: frameH,
        top: (vh - frameH) / 2,
        left: (vw - frameW) / 2,
        right: 'auto',
        bottom: 'auto',
        margin: 0,
        transform: 'rotate(90deg)',
        transformOrigin: 'center center',
        boxSizing: 'border-box',
        ['--ink-force-short' as string]: `${frameH}px`,
        ['--ink-force-long' as string]: `${frameW}px`,
      })
    }

    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    const vv = window.visualViewport
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
    }
  }, [enabled])

  return style
}

export interface InkCaptureExistingInk {
  imageDataUrl?: string
  path?: SignaturePathData | null
}

export interface InkCaptureSheetProps {
  fieldKind: InkCaptureFieldKind
  /** Field width÷height so the pad matches the PDF box (when layout allows). */
  padAspect?: number
  padKey?: number | string
  onChange: (result: SignatureStrokeResult | null) => void
  /** True when strokes exist (parent tracks ink state). */
  hasInk: boolean
  primaryLabel: string
  onPrimary: () => void
  primaryDisabled?: boolean
  disabled?: boolean
  /** Optional top kicker (e.g. “VeriLock” on the guest page). */
  kicker?: string | null
  /** Close control (overlay / in-app). Guest page usually omits this. */
  onClose?: () => void
  /**
   * `page` — in-flow full viewport (guest /m/sign).
   * `overlay` — fixed full viewport over the app (in-app field tap).
   */
  variant?: 'page' | 'overlay'
  className?: string
  titleId?: string
  /**
   * Prior signature/initials for this person. Shown under the pad with
   * “Use existing” so the user can re-apply without redrawing.
   */
  existingInk?: InkCaptureExistingInk | null
  onUseExisting?: () => void
}

function ExistingInkThumb({
  ink,
  isInitial,
}: {
  ink: InkCaptureExistingInk
  isInitial: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const w = isInitial ? 88 : 140
  const h = isInitial ? 44 : 48

  useEffect(() => {
    if (ink.imageDataUrl || !ink.path?.strokes?.length || !canvasRef.current) return
    const c = canvasRef.current
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    paintSignaturePath(ctx, ink.path, { left: 4, top: 4, width: w - 8, height: h - 8 })
  }, [ink.imageDataUrl, ink.path, w, h])

  if (ink.imageDataUrl) {
    return (
      <img
        className="ink-capture-existing-img"
        src={ink.imageDataUrl}
        alt=""
        width={w}
        height={h}
      />
    )
  }
  if (ink.path?.strokes?.length) {
    return <canvas ref={canvasRef} className="ink-capture-existing-img" aria-hidden />
  }
  return null
}

export function InkCaptureSheet({
  fieldKind,
  padAspect,
  padKey = 0,
  onChange,
  hasInk,
  primaryLabel,
  onPrimary,
  primaryDisabled = false,
  disabled = false,
  kicker = null,
  onClose,
  variant = 'page',
  className,
  titleId = 'ink-capture-title',
  existingInk = null,
  onUseExisting,
}: InkCaptureSheetProps) {
  const isLandscape = useIsLandscape()
  const isRealPortrait = useIsRealPortrait()
  const isInitial = fieldKind === 'initial'
  // Phone / Pay: isLandscape true while still real-portrait → force landscape frame
  // (no “turn sideways” gate). OS landscape: normal draw layout.
  const needsLandscape = !isLandscape
  const isPortraitHost = !needsLandscape && isRealPortrait
  const canDraw = isLandscape && !disabled
  const title = isInitial ? 'Draw your initials' : 'Draw your signature'
  const aspect =
    padAspect != null && Number.isFinite(padAspect) && padAspect > 0.05
      ? padAspect
      : isInitial
        ? 1.4
        : 2.8
  const forceFrame = useForcedLandscapeFrame(isPortraitHost)

  /**
   * One-shot guide: iPhone SVG turns 2s, holds, fades — tip the phone to match the frame.
   */
  const [portraitGuide, setPortraitGuide] = useState<'off' | 'play' | 'fade'>('off')
  useEffect(() => {
    if (!isPortraitHost) {
      setPortraitGuide('off')
      return
    }
    setPortraitGuide('play')
    const fadeTimer = window.setTimeout(() => setPortraitGuide('fade'), PORTRAIT_GUIDE_VISIBLE_MS)
    const offTimer = window.setTimeout(
      () => setPortraitGuide('off'),
      PORTRAIT_GUIDE_VISIBLE_MS + PORTRAIT_GUIDE_FADE_MS,
    )
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(offTimer)
    }
  }, [isPortraitHost, padKey])

  useEffect(() => {
    if (needsLandscape) return
    if (variant !== 'overlay' && !isPortraitHost) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isPortraitHost, variant, needsLandscape])

  return (
    <>
      {isPortraitHost && (
        <div className="ink-capture-force-backdrop" aria-hidden />
      )}
      <div
        className={[
          'ink-capture-sheet',
          `ink-capture-sheet--${variant}`,
          needsLandscape ? 'is-rotate' : 'is-draw',
          isPortraitHost ? 'is-portrait-host' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={forceFrame}
        // Marks the rotate(90deg) root for correct pointer → canvas mapping.
        {...(isPortraitHost ? { 'data-ink-force-landscape': '' } : {})}
        role={variant === 'overlay' ? 'dialog' : undefined}
        aria-modal={variant === 'overlay' ? true : undefined}
        aria-labelledby={titleId}
      >
        {/*
          Always-visible chrome: brand + title (draw) / title only on rotate,
          and abort X whenever parent provides onClose (rotate + draw).
        */}
        <header
          className={[
            'ink-capture-head',
            needsLandscape ? 'ink-capture-head--rotate' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div className="ink-capture-head-text">
            {kicker ? (
              <p className="ink-capture-kicker" aria-hidden={needsLandscape || undefined}>
                {kicker}
              </p>
            ) : null}
            <h1
              id={titleId}
              className={
                needsLandscape ? 'ink-capture-title ink-capture-title--sr' : 'ink-capture-title'
              }
            >
              {needsLandscape
                ? isInitial
                  ? 'Rotate to draw initials'
                  : 'Rotate to draw signature'
                : title}
            </h1>
          </div>
          {onClose && (
            <button
              type="button"
              className="ink-capture-close"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={isPortraitHost ? 22 : 20} strokeWidth={2.35} aria-hidden />
            </button>
          )}
        </header>

        {needsLandscape && (
          <div className="ink-capture-rotate" role="status" aria-live="polite">
            <div className="ink-capture-rotate-phone-wrap" aria-hidden>
              <IPhoneOutlineIcon className="ink-capture-rotate-phone" />
            </div>
            <p className="ink-capture-rotate-title">Rotate your phone</p>
            <p className="ink-capture-rotate-copy">
              Turn the phone sideways to{' '}
              {isInitial ? 'draw your initials' : 'draw your signature'}.
            </p>
            <p className="ink-capture-rotate-note muted">
              If nothing changes, unlock portrait lock in Control Center or Quick
              Settings, then rotate.
            </p>
          </div>
        )}

        {portraitGuide !== 'off' && (
          <div
            className={`ink-capture-portrait-guide${
              portraitGuide === 'fade' ? ' is-fade' : ''
            }`}
            role="status"
            aria-live="polite"
            aria-label="Tip the phone on its side to sign"
          >
            <div className="ink-capture-portrait-guide-phone" aria-hidden>
              <IPhoneOutlineIcon className="ink-capture-portrait-guide-svg" />
            </div>
          </div>
        )}

        <div
          className="ink-capture-pad-stage"
          hidden={needsLandscape}
          aria-hidden={needsLandscape || undefined}
        >
          <SignatureStrokePad
            key={padKey}
            productMode
            compact
            disabled={!canDraw}
            label={isInitial ? 'Initials' : 'Signature'}
            padAspect={aspect}
            onChange={onChange}
          />
        </div>

        {existingInk &&
          onUseExisting &&
          (existingInk.imageDataUrl || existingInk.path?.strokes?.length) &&
          !needsLandscape && (
            <div className="ink-capture-existing" role="group" aria-label="Saved ink">
              <div className="ink-capture-existing-preview">
                <ExistingInkThumb ink={existingInk} isInitial={isInitial} />
              </div>
              <button
                type="button"
                className="btn btn-secondary ink-capture-existing-btn"
                disabled={disabled || primaryDisabled || !canDraw}
                onClick={onUseExisting}
              >
                Use existing
              </button>
            </div>
          )}

        <div
          className="ink-capture-float-dock"
          hidden={needsLandscape}
          aria-hidden={needsLandscape || undefined}
        >
          <button
            type="button"
            className={`btn btn-primary btn-lg ink-capture-primary${
              !hasInk || primaryDisabled || !canDraw ? ' is-disabled' : ''
            }`}
            disabled={!hasInk || primaryDisabled || !canDraw}
            onClick={onPrimary}
            tabIndex={needsLandscape ? -1 : undefined}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </>
  )
}
