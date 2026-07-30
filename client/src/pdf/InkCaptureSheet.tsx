/**
 * Full-screen ink capture for phones — shared by QR /m/sign and in-app field signing.
 *
 * - Phone / Nimiq Pay: always the same landscape layout box (long × short edges).
 *   Portrait OS: CSS rotate(90deg) so the box fills the screen; tip phone to match.
 *   Landscape OS: same box, no rotate — pad size stays identical across orientation.
 * - Desktop portrait (rare): blocking rotate gate if this sheet is shown.
 * - Desktop landscape: normal full-viewport pad (no force frame).
 */
import { X } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import {
  useForceLandscapeInkHost,
  useIsLandscape,
  useIsRealPortrait,
} from '../useViewport'
import { paintSignaturePath, type SignaturePathData } from './annotations'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './SignatureStrokePad'
import './InkCaptureSheet.css'

/** Turn (1.4s) + short hold (~0.25s), then fade (~0.3s). Play once per pad open. */
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

type ForceFrameState = {
  style: CSSProperties
  /** True when CSS rotate(90deg) is active (pointer mapping needs data-ink-force-landscape). */
  rotated: boolean
}

/**
 * Stable landscape frame for phone / Nimiq Pay ink hosts.
 *
 * Layout box is always longEdge × shortEdge (device edges), so the pad stage
 * keeps the same CSS size when the user tips the phone. In portrait we rotate
 * that box 90°; in landscape we leave transform none. No intermediate “OS
 * landscape sheet” path — that used different padding and looked like a resize.
 */
function useForcedLandscapeFrame(enabled: boolean): ForceFrameState | undefined {
  const [frame, setFrame] = useState<ForceFrameState | undefined>(undefined)

  useLayoutEffect(() => {
    if (!enabled) {
      setFrame(undefined)
      return
    }

    const apply = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      if (vw < 1 || vh < 1) return

      const long = Math.max(vw, vh)
      const short = Math.min(vw, vh)
      const portrait = vw < vh
      // Same logical landscape box in both orientations.
      const frameW = long
      const frameH = short
      const top = (vh - frameH) / 2
      const left = (vw - frameW) / 2

      setFrame(prev => {
        if (
          prev &&
          prev.rotated === portrait &&
          prev.style.width === frameW &&
          prev.style.height === frameH &&
          prev.style.top === top &&
          prev.style.left === left
        ) {
          return prev
        }
        return {
          rotated: portrait,
          style: {
            position: 'fixed',
            zIndex: 230,
            width: frameW,
            height: frameH,
            top,
            left,
            right: 'auto',
            bottom: 'auto',
            margin: 0,
            transform: portrait ? 'rotate(90deg)' : 'none',
            transformOrigin: 'center center',
            // Avoid CSS interpolating rotate ↔ none across orientation flips.
            transition: 'none',
            boxSizing: 'border-box',
            ['--ink-force-short' as string]: `${frameH}px`,
            ['--ink-force-long' as string]: `${frameW}px`,
          },
        }
      })
    }

    let orientTimers: number[] = []
    const onOrientation = () => {
      // iOS often fires orientationchange before innerWidth/Height settle.
      apply()
      for (const ms of [50, 150, 300]) {
        orientTimers.push(window.setTimeout(apply, ms))
      }
    }

    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', onOrientation)
    const vv = window.visualViewport
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', onOrientation)
      for (const t of orientTimers) window.clearTimeout(t)
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
    }
  }, [enabled])

  return frame
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
  const forceInkHost = useForceLandscapeInkHost()
  const isInitial = fieldKind === 'initial'
  // Desktop only: block until OS landscape. Phones/Pay always get the force frame.
  const needsLandscape = !isLandscape
  // Same chrome + long×short box for the whole session (portrait and OS landscape).
  const isForceHost = forceInkHost && !needsLandscape
  const forceFrame = useForcedLandscapeFrame(isForceHost)
  const forceRotated = Boolean(forceFrame?.rotated)
  const canDraw = isLandscape && !disabled
  const title = isInitial ? 'Draw your initials' : 'Draw your signature'
  const aspect =
    padAspect != null && Number.isFinite(padAspect) && padAspect > 0.05
      ? padAspect
      : isInitial
        ? 1.4
        : 2.8

  /**
   * One-shot guide when the pad first opens in portrait — never re-run on
   * orientation flips (that felt like a re-render / animation after rotate).
   */
  const [portraitGuide, setPortraitGuide] = useState<'off' | 'play' | 'fade'>('off')
  const guidePlayedForPadRef = useRef<string | number | null>(null)
  useEffect(() => {
    if (!isForceHost || !isRealPortrait) {
      setPortraitGuide('off')
      return
    }
    if (guidePlayedForPadRef.current === padKey) {
      setPortraitGuide('off')
      return
    }
    guidePlayedForPadRef.current = padKey
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
  }, [isForceHost, isRealPortrait, padKey])

  useEffect(() => {
    if (needsLandscape) return
    if (variant !== 'overlay' && !isForceHost) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isForceHost, variant, needsLandscape])

  return (
    <>
      {isForceHost && (
        <div className="ink-capture-force-backdrop" aria-hidden />
      )}
      <div
        className={[
          'ink-capture-sheet',
          `ink-capture-sheet--${variant}`,
          needsLandscape ? 'is-rotate' : 'is-draw',
          // Portrait-host chrome applies for the whole force-ink session (both orientations).
          isForceHost ? 'is-portrait-host' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={forceFrame?.style}
        // Marks the rotate(90deg) root for correct pointer → canvas mapping.
        {...(forceRotated ? { 'data-ink-force-landscape': '' } : {})}
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
              <X size={isForceHost ? 22 : 20} strokeWidth={2.35} aria-hidden />
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
