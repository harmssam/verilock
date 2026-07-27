/**
 * Full-screen ink capture for phones — shared by QR /m/sign and in-app field signing.
 * Landscape-gated pad + floating primary so both paths feel the same.
 */
import { Smartphone, X } from 'lucide-react'
import { useIsLandscape } from '../useViewport'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './SignatureStrokePad'
import './InkCaptureSheet.css'

export type InkCaptureFieldKind = 'signature' | 'initial'

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
  const isInitial = fieldKind === 'initial'
  const needsLandscape = !isLandscape
  const canDraw = isLandscape && !disabled
  const title = isInitial ? 'Draw your initials' : 'Draw your signature'
  const aspect =
    padAspect != null && Number.isFinite(padAspect) && padAspect > 0.05
      ? padAspect
      : isInitial
        ? 1.4
        : 2.8

  return (
    <div
      className={[
        'ink-capture-sheet',
        `ink-capture-sheet--${variant}`,
        needsLandscape ? 'is-rotate' : 'is-draw',
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
          <div className="ink-capture-rotate-visual" aria-hidden>
            <Smartphone className="ink-capture-rotate-phone" size={40} strokeWidth={1.75} />
            <span className="ink-capture-rotate-hint">↻</span>
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
  )
}
