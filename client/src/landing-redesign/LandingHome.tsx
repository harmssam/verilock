import {
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Fingerprint,
  Lock,
  Move,
  ScanSearch,
  Shield,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { formatBlogDate, getAllPosts } from '../blog'
import { formatSealFeeNim, getSealPricing } from '../sealPricing'
import type { SealDocument } from '../types'
import { JourneyAgreements } from '../experiment/JourneyAgreements'
import type { PathRole } from '../experiment/types'
import { LandingHowItWorks } from './LandingHowItWorks'
import {
  clampZoom,
  clonePathPlacements,
  formatObjectPosition,
  formatPathPlacementsSource,
  loadPathPlacementsFromStorage,
  normalizePlacement,
  PATH_PLACEMENTS,
  PATH_STILLS,
  PATH_ZOOM_MAX,
  PATH_ZOOM_MIN,
  PATH_ZOOM_STEP,
  placementImageStyle,
  savePathPlacementsToStorage,
  type ImagePlacement,
  type PathPlacements,
} from './pathMedia'

interface LandingHomeProps {
  token: string | null
  address: string | null
  onPickRole: (role: PathRole) => void
  onOpenAgreement: (doc: SealDocument, preferSeal?: boolean) => void
  onViewAllAgreements?: () => void
  onOpenBlogPost?: (slug: string) => void
  onOpenBlogIndex?: () => void
}

/**
 * Hero claim slides: status line + visual chip share one beat.
 * Still stays fixed on create art; copy is complementary, not identical.
 * Verify is left to CTAs / path cards so the create vignette stays coherent.
 */
interface HeroClaim {
  icon: LucideIcon
  status: string
  cardTitle: string
  cardDetail: string
}

function buildHeroClaims(): HeroClaim[] {
  const pricing = getSealPricing()
  const feeNim = formatSealFeeNim(pricing.feeNim)

  return [
    {
      icon: ShieldCheck,
      status: 'Hash on Nimiq. File stays on this device',
      cardTitle: 'Local fingerprint',
      cardDetail: 'SHA-256 stays in the browser',
    },
    {
      icon: Users,
      status: 'Co-sign with wallets. No file uploads',
      cardTitle: 'Multi-party sign',
      cardDetail: 'Wallets join. The file stays put',
    },
    {
      icon: Lock,
      status: pricing.promoActive
        ? `Seal forever for ${feeNim} (July promo)`
        : `Seal forever for a flat ${feeNim} fee`,
      cardTitle: 'One seal fee',
      cardDetail: pricing.promoActive ? `${feeNim} this July · forever after` : `Flat ${feeNim} on Nimiq`,
    },
    {
      icon: Fingerprint,
      status: 'Only the SHA-256 fingerprint is sealed on Nimiq',
      cardTitle: 'Permanent proof',
      cardDetail: 'Hash on-chain. Bytes never leave',
    },
  ]
}

/**
 * Image placement tools are designer chrome only.
 * Visible when `import.meta.env.DEV` and `?place=1` (never on default home).
 */
function usePlaceModeAllowed(): boolean {
  const [allowed, setAllowed] = useState(() => {
    if (typeof window === 'undefined') return false
    if (!import.meta.env.DEV) return false
    return new URLSearchParams(window.location.search).get('place') === '1'
  })

  useEffect(() => {
    if (!import.meta.env.DEV) {
      setAllowed(false)
      return
    }
    const sync = () => {
      setAllowed(new URLSearchParams(window.location.search).get('place') === '1')
    }
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  return allowed
}

const ROTATE_MS = 4800
const FADE_MS = 220

/** Path card icons: thin stroke, no chip chrome. ScanSearch on verify. */
const PATH_ICON_STROKE = 1.35
const PATH_ICON_SIZE = 28

const PATHS: {
  role: PathRole
  title: string
  detail: string
  icon: LucideIcon
  imageAlt: string
}[] = [
  {
    role: 'creator',
    title: 'Create & seal',
    detail: 'Fingerprint, multi-party sign, lock on Nimiq',
    icon: Fingerprint,
    imageAlt: '',
  },
  {
    role: 'signer',
    title: 'I was invited',
    detail: 'Drop the shared PDF (or open your invite link), then sign',
    icon: Users,
    imageAlt: '',
  },
  {
    role: 'verifier',
    title: 'Verify a PDF',
    detail: 'Drop a file. Look up sealed fingerprints',
    icon: ScanSearch,
    imageAlt: '',
  },
]

function useHeroClaims() {
  const claims = useMemo(() => buildHeroClaims(), [])
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return

    const id = window.setInterval(() => {
      setVisible(false)
      window.setTimeout(() => {
        setIndex(i => (i + 1) % claims.length)
        setVisible(true)
      }, FADE_MS)
    }, ROTATE_MS)
    return () => window.clearInterval(id)
  }, [claims.length])

  return { claim: claims[index] ?? claims[0], visible }
}

/** Drag sensitivity: pixels of pointer move → percent of object-position. */
const PLACE_DRAG_SCALE = 0.18

export function LandingHome({
  token,
  address,
  onPickRole,
  onOpenAgreement,
  onViewAllAgreements,
  onOpenBlogPost,
  onOpenBlogIndex,
}: LandingHomeProps) {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  const placeModeAllowed = usePlaceModeAllowed()
  const [placeMode, setPlaceMode] = useState(false)
  /** Locked defaults unless place mode is allowed (dev + ?place=1). */
  const [placements, setPlacements] = useState<PathPlacements>(() => clonePathPlacements())
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle')
  const dragRef = useRef<{
    role: PathRole
    pointerId: number
    startX: number
    startY: number
    origin: ImagePlacement
  } | null>(null)
  const latestPost = useMemo(() => getAllPosts()[0] ?? null, [])
  const { claim, visible: claimVisible } = useHeroClaims()
  const ClaimIcon = claim.icon

  // Force place mode off when the gate closes (query removed / production build).
  useEffect(() => {
    if (!placeModeAllowed) {
      setPlaceMode(false)
      setPlacements(clonePathPlacements())
      return
    }
    setPlacements(loadPathPlacementsFromStorage())
  }, [placeModeAllowed])

  useEffect(() => {
    if (!placeModeAllowed) return
    savePathPlacementsToStorage(placements)
  }, [placements, placeModeAllowed])

  const setCardPlacement = useCallback((role: PathRole, next: Partial<ImagePlacement>) => {
    setPlacements(prev => ({
      ...prev,
      card: {
        ...prev.card,
        [role]: normalizePlacement({
          x: next.x ?? prev.card[role].x,
          y: next.y ?? prev.card[role].y,
          zoom: next.zoom ?? prev.card[role].zoom,
        }),
      },
    }))
  }, [])

  const resetPlacements = useCallback(() => {
    setPlacements(clonePathPlacements(PATH_PLACEMENTS))
  }, [])

  const copyPlacements = useCallback(async () => {
    const text = formatPathPlacementsSource(placements)
    try {
      await navigator.clipboard.writeText(text)
      setCopyState('ok')
    } catch {
      setCopyState('err')
    }
    window.setTimeout(() => setCopyState('idle'), 1800)
  }, [placements])

  const onPlacePointerDown = useCallback(
    (role: PathRole, e: ReactPointerEvent<HTMLSpanElement>) => {
      if (!placeMode) return
      e.preventDefault()
      e.stopPropagation()
      const origin = placements.card[role]
      dragRef.current = {
        role,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...origin },
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [placeMode, placements.card],
  )

  const onPlacePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId) return
      e.preventDefault()
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      // Drag image content: pointer right → show more left of source (lower x%)
      setCardPlacement(drag.role, {
        x: drag.origin.x - dx * PLACE_DRAG_SCALE,
        y: drag.origin.y - dy * PLACE_DRAG_SCALE,
      })
    },
    [setCardPlacement],
  )

  const onPlacePointerUp = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  /** Scroll wheel zooms the still under the pointer (place mode only). */
  const onPlaceWheel = useCallback(
    (role: PathRole, e: ReactWheelEvent<HTMLSpanElement>) => {
      if (!placeMode) return
      e.preventDefault()
      e.stopPropagation()
      const cur = placements.card[role].zoom
      const delta = e.deltaY > 0 ? -PATH_ZOOM_STEP : PATH_ZOOM_STEP
      setCardPlacement(role, { zoom: clampZoom(cur + delta) })
    },
    [placeMode, placements.card, setCardPlacement],
  )

  return (
    <div className="lr-home">
      {/* Task-first hero: local fingerprint + on-chain hash, then three paths */}
      <section className="lr-hero-band" aria-labelledby="lr-hero-headline">
        <div className="lr-hero-copy">
          <h1 id="lr-hero-headline" className="lr-hero-headline">
            Fingerprint a PDF.{' '}
            <span className="lr-hero-headline-em">Lock the proof on Nimiq.</span>
          </h1>
          <p className="lr-hero-sub">
            Hash stays in the browser. Co-sign with wallets. Seal only the fingerprint on-chain.
            The file never uploads.
          </p>
          {/*
            One primary CTA only. Paths below cover Create / Invited / Verify.
            Secondary jumps to path picker for co-signers and verifiers.
          */}
          <div className="lr-hero-ctas">
            <button
              type="button"
              className="lr-cta lr-cta--primary"
              onClick={() => onPickRole('creator')}
            >
              Create &amp; seal
              <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
            </button>
            <a className="lr-cta lr-cta--ghost" href="#lr-paths">
              Sign or verify
            </a>
          </div>
          <p
            className={`lr-status${claimVisible ? ' lr-status--in' : ''}`}
            aria-live="polite"
          >
            <ClaimIcon size={15} strokeWidth={2.25} aria-hidden />
            <span>{claim.status}</span>
          </p>
        </div>
        <div className="lr-hero-visual" aria-hidden>
          <img
            className="lr-hero-visual-img"
            src={PATH_STILLS.creator}
            alt=""
            width={1280}
            height={720}
            decoding="async"
            style={{ objectPosition: formatObjectPosition(PATH_PLACEMENTS.track.creator) }}
          />
          <div
            className={`lr-hero-visual-card${claimVisible ? ' lr-hero-visual-card--in' : ''}`}
          >
            <ClaimIcon size={18} strokeWidth={1.5} />
            <div>
              <strong>{claim.cardTitle}</strong>
              <span>{claim.cardDetail}</span>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`lr-trust${privacyOpen ? ' lr-trust--open' : ''}`}
        aria-label="Privacy"
      >
        <button
          type="button"
          className="lr-trust-main"
          onClick={() => setPrivacyOpen(v => !v)}
          aria-expanded={privacyOpen}
        >
          <Shield className="lr-trust-icon" size={18} strokeWidth={2.25} aria-hidden />
          <span className="lr-trust-copy">
            <strong>Your PDF never leaves this device.</strong>
            <span className="lr-trust-sub">
              Only a SHA-256 fingerprint is stored / sealed on-chain.
            </span>
          </span>
          <span className={`lr-chevron${privacyOpen ? ' lr-chevron--open' : ''}`} aria-hidden />
        </button>
        {privacyOpen && (
          <div className="lr-trust-detail">
            <ul>
              <li>Fingerprinting runs in your browser. Bytes stay local.</li>
              <li>Servers keep metadata + hash, not the file.</li>
              <li>On-chain seal records the hash string only.</li>
              <li>Verification re-hashes a local copy. No wallet required.</li>
            </ul>
          </div>
        )}
      </section>

      {token && (
        <div className="lr-agreements-wrap">
          <JourneyAgreements
            token={token}
            address={address}
            onOpen={doc => onOpenAgreement(doc, false)}
            onSeal={doc => onOpenAgreement(doc, true)}
            onViewAll={onViewAllAgreements}
          />
        </div>
      )}

      <section
        id="lr-paths"
        className="lr-paths-section"
        aria-labelledby="lr-paths-title"
      >
        <div className="lr-paths-head">
          <h2 id="lr-paths-title" className="lr-paths-title">
            What are you here to do?
          </h2>
          <p className="lr-paths-lead">
            Pick a path. Create, sign an invite, or verify a sealed PDF.
          </p>
        </div>

        {placeModeAllowed && (
          <div className="lr-place-bar" role="region" aria-label="Path image placement (dev only)">
            <button
              type="button"
              className={`lr-place-toggle${placeMode ? ' lr-place-toggle--on' : ''}`}
              aria-pressed={placeMode}
              onClick={() => setPlaceMode(v => !v)}
            >
              <Move size={15} strokeWidth={2} aria-hidden />
              {placeMode ? 'Placing images' : 'Place images'}
            </button>
            {placeMode && (
              <>
                <p className="lr-place-hint">
                  Dev only (<code>?place=1</code>). Drag to pan, scroll to zoom, or use sliders.
                  Values save in this browser; copy to lock into <code>pathMedia.ts</code>.
                </p>
                <div className="lr-place-actions">
                  <button type="button" className="lr-place-btn" onClick={resetPlacements}>
                    Reset defaults
                  </button>
                  <button
                    type="button"
                    className="lr-place-btn lr-place-btn--primary"
                    onClick={() => void copyPlacements()}
                  >
                    {copyState === 'ok' ? (
                      <>
                        <Check size={14} strokeWidth={2.25} aria-hidden />
                        Copied
                      </>
                    ) : copyState === 'err' ? (
                      'Copy failed'
                    ) : (
                      <>
                        <Copy size={14} strokeWidth={2} aria-hidden />
                        Copy PATH_PLACEMENTS
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className={`lr-paths${placeMode ? ' lr-paths--place' : ''}`} role="list">
          {PATHS.map(path => {
            const Icon = path.icon
            const place = placements.card[path.role]
            return (
              <div key={path.role} className="lr-path-wrap" role="listitem">
                <button
                  type="button"
                  className={`lr-path lr-path--${path.role}${placeMode ? ' lr-path--place' : ''}`}
                  onClick={() => {
                    if (placeMode) return
                    onPickRole(path.role)
                  }}
                  tabIndex={placeMode ? -1 : undefined}
                  aria-disabled={placeMode || undefined}
                >
                  <span
                    className={`lr-path-thumb${placeMode ? ' lr-path-thumb--place' : ''}`}
                    aria-hidden={!placeMode}
                    onPointerDown={e => onPlacePointerDown(path.role, e)}
                    onPointerMove={onPlacePointerMove}
                    onPointerUp={onPlacePointerUp}
                    onPointerCancel={onPlacePointerUp}
                    onWheel={e => onPlaceWheel(path.role, e)}
                  >
                    <img
                      className="lr-path-img"
                      src={PATH_STILLS[path.role]}
                      alt={path.imageAlt}
                      width={640}
                      height={360}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                      style={placementImageStyle(place)}
                    />
                    {placeMode && (
                      <span className="lr-path-place-badge">
                        {place.x.toFixed(0)}% · {place.y.toFixed(0)}% · {place.zoom.toFixed(2)}×
                      </span>
                    )}
                  </span>
                  <span className="lr-path-main">
                    <span className="lr-path-icon" aria-hidden>
                      <Icon size={PATH_ICON_SIZE} strokeWidth={PATH_ICON_STROKE} />
                    </span>
                    <span className="lr-path-body">
                      <strong className="lr-path-title">{path.title}</strong>
                      <span className="lr-path-detail">{path.detail}</span>
                    </span>
                    <ChevronRight className="lr-path-go" size={20} strokeWidth={1.5} aria-hidden />
                  </span>
                </button>
                {placeMode && (
                  <div className="lr-path-sliders" onClick={e => e.stopPropagation()}>
                    <label className="lr-path-slider">
                      <span>X</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.5}
                        value={place.x}
                        onChange={e => setCardPlacement(path.role, { x: Number(e.target.value) })}
                      />
                      <output>{place.x.toFixed(1)}</output>
                    </label>
                    <label className="lr-path-slider">
                      <span>Y</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={0.5}
                        value={place.y}
                        onChange={e => setCardPlacement(path.role, { y: Number(e.target.value) })}
                      />
                      <output>{place.y.toFixed(1)}</output>
                    </label>
                    <label className="lr-path-slider">
                      <span>Z</span>
                      <input
                        type="range"
                        min={PATH_ZOOM_MIN}
                        max={PATH_ZOOM_MAX}
                        step={PATH_ZOOM_STEP}
                        value={place.zoom}
                        onChange={e => setCardPlacement(path.role, { zoom: Number(e.target.value) })}
                      />
                      <output>{place.zoom.toFixed(2)}×</output>
                    </label>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <div className="lr-how-wrap">
        <LandingHowItWorks role={null} open={howOpen} onToggle={() => setHowOpen(v => !v)} />
      </div>

      {latestPost && onOpenBlogPost && (
        <section className="lr-blog-latest" aria-labelledby="lr-blog-latest-title">
          <div className="lr-blog-latest-head">
            <div>
              <h2 id="lr-blog-latest-title" className="lr-blog-latest-heading">
                From the blog
              </h2>
            </div>
            {onOpenBlogIndex && (
              <button type="button" className="lr-blog-latest-all" onClick={onOpenBlogIndex}>
                All posts
                <ArrowRight size={14} strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </div>
          <button
            type="button"
            className="lr-blog-latest-card"
            onClick={() => onOpenBlogPost(latestPost.slug)}
          >
            <span className="lr-blog-latest-thumb" aria-hidden>
              <img
                src={latestPost.coverImage}
                alt=""
                width={640}
                height={360}
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="lr-blog-latest-body">
              <span className="lr-blog-latest-meta">
                <time dateTime={latestPost.date}>{formatBlogDate(latestPost.date)}</time>
                {latestPost.tags[0] && (
                  <span className="lr-blog-latest-tag">{latestPost.tags[0]}</span>
                )}
              </span>
              <strong className="lr-blog-latest-title">{latestPost.title}</strong>
              <span className="lr-blog-latest-desc">{latestPost.description}</span>
              <span className="lr-blog-latest-cta">
                Read post
                <ArrowRight size={15} strokeWidth={2.25} aria-hidden />
              </span>
            </span>
          </button>
        </section>
      )}
    </div>
  )
}
