/**
 * Full-screen ink capture for phones — shared by QR /m/sign and in-app field signing.
 * Landscape-gated pad + floating primary so both paths feel the same.
 * Nimiq Pay mini app skips the landscape gate (host is portrait-locked) and shows
 * a one-shot iPhone rotate guide over the horizontal pad.
 */
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useIsLandscape, useIsRealPortrait } from '../useViewport'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './SignatureStrokePad'
import './InkCaptureSheet.css'

/** Rotate animation (2s) + brief hold before fade (~0.55s) + fade duration (~0.45s). */
const PORTRAIT_GUIDE_VISIBLE_MS = 2550
const PORTRAIT_GUIDE_FADE_MS = 450

export type InkCaptureFieldKind = 'signature' | 'initial'

/** Simple iPhone outline used for the rotate nudge (no bordered card). */
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
      {/* Device body */}
      <rect
        x="3.5"
        y="1.5"
        width="41"
        height="77"
        rx="9"
        stroke="currentColor"
        strokeWidth="2.25"
      />
      {/* Dynamic Island / notch */}
      <rect x="16" y="5.5" width="16" height="4" rx="2" fill="currentColor" />
      {/* Screen area hint */}
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
      {/* Home indicator */}
      <rect x="17" y="69" width="14" height="3" rx="1.5" fill="currentColor" opacity="0.55" />
    </svg>
  )
}

export interface InkCaptureSheetProps {
  fieldKind: InkCaptureFieldKind
  /** Field width÷height so the pad matches the PDF box. */
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
  // Pay is portrait-locked: skip rotate *gate*, but force a real landscape layout
  // (rotated 90°) so the pad is not a tall portrait stack.
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

  /**
   * One-shot guide: iPhone SVG turns upright → landscape (2s), holds, fades.
   * Shown on forced-landscape portrait hosts (Nimiq Pay) so users tip the phone.
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

  // Lock body scroll while the forced-landscape sheet covers the viewport.
  useEffect(() => {
    if (!isPortraitHost) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [isPortraitHost])

  return (
    <>
      {/* Unrotated fill so the portrait webview never flashes empty under the sheet. */}
      {isPortraitHost && (
        <div className="ink-capture-force-backdrop" aria-hidden />
      )}
    <div
      className={[
        'ink-capture-sheet',
        `ink-capture-sheet--${variant}`,
        needsLandscape ? 'is-rotate' : 'is-draw',
        // Forced landscape UI inside portrait-locked host (Nimiq Pay).
        isPortraitHost ? 'is-portrait-host' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role={variant === 'overlay' ? 'dialog' : undefined}
      aria-modal={variant === 'overlay' ? true : undefined}
      aria-labelledby={titleId}
    >
      {needsLandscape && (
        <div className="ink-capture-rotate" role="status" aria-live="polite">
          <div className="ink-capture-rotate-phone-wrap" aria-hidden>
            <IPhoneOutlineIcon className="ink-capture-rotate-phone" />
          </div>
          <h1 id={titleId} className="ink-capture-rotate-title">
            Rotate your phone
          </h1>
          <p className="ink-capture-rotate-copy">
            Turn the phone sideways to{' '}
            {isInitial ? 'draw your initials' : 'draw your signature'} so the pad
            matches the box on your document. This message leaves when you do.
          </p>
          <p className="ink-capture-rotate-note muted">
            If nothing changes, unlock portrait lock in Control Center or Quick
            Settings, then rotate.
          </p>
          {onClose && (
            <button
              type="button"
              className="btn btn-secondary ink-capture-rotate-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {portraitGuide !== 'off' && (
        <div
          className={`ink-capture-portrait-guide${
            portraitGuide === 'fade' ? ' is-fade' : ''
          }`}
          role="status"
          aria-live="polite"
          aria-label="Sign sideways on this pad — the layout matches landscape"
        >
          <div className="ink-capture-portrait-guide-phone" aria-hidden>
            <IPhoneOutlineIcon className="ink-capture-portrait-guide-svg" />
          </div>
        </div>
      )}

      {/*
        Keep pad mounted under the rotate gate so strokes + session survive
        orientation changes (pad resizes on landscape).
      */}
      <header
        className="ink-capture-head"
        hidden={needsLandscape}
      >
        <div className="ink-capture-head-text">
          {kicker ? <p className="ink-capture-kicker">{kicker}</p> : null}
          <h1 id={needsLandscape ? undefined : titleId} className="ink-capture-title">
            {title}
          </h1>
        </div>
        {onClose && (
          <button
            type="button"
            className="ink-capture-close"
            aria-label="Close"
            onClick={onClose}
            tabIndex={needsLandscape ? -1 : undefined}
          >
            <X size={18} strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </header>

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
