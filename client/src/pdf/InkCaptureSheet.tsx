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
  useState,
  type CSSProperties,
} from 'react'
import { useIsLandscape, useIsRealPortrait } from '../useViewport'
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
 * Pixel-perfect forced landscape frame for portrait-locked hosts (Nimiq Pay).
 *
 * Layout box is landscape-sized (long = physical height, short = physical width),
 * centered, then rotated 90° so it fills the portrait viewport. Hold phone on its side.
 *
 * Also computes pad pixel size to fill the long edge while keeping field aspect
 * (so the draw band is full-width when viewed landscape, not a narrow strip).
 */
function useForcedLandscapeFrame(
  enabled: boolean,
  fieldAspect: number,
): CSSProperties | undefined {
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
      const aspect =
        Number.isFinite(fieldAspect) && fieldAspect > 0.05 && fieldAspect < 20
          ? fieldAspect
          : 2.5

      // Room for head + Apply dock + gaps (logical landscape coords)
      const padX = 20
      const padTop = 52
      const padBottom = 58
      const availW = Math.max(120, frameW - padX * 2)
      const availH = Math.max(80, frameH - padTop - padBottom)

      // Fit field aspect inside avail box — prefer using full long edge (width)
      let padW = availW
      let padH = padW / aspect
      if (padH > availH) {
        padH = availH
        padW = padH * aspect
      }

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
        ['--ink-pad-w' as string]: `${Math.round(padW)}px`,
        ['--ink-pad-h' as string]: `${Math.round(padH)}px`,
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
  }, [enabled, fieldAspect])

  return style
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
  const forceFrame = useForcedLandscapeFrame(isPortraitHost, aspect)

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
