import {
  ArrowRight,
  ChevronRight,
  Fingerprint,
  Lock,
  ScanSearch,
  Shield,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatSealFeeNim, getSealPricing } from '../sealPricing'
import type { PathRole } from '../journey/types'
import { LandingHowItWorks } from './LandingHowItWorks'
import {
  formatObjectPosition,
  HERO_PLACEMENT,
  HERO_STILL,
  PATH_PLACEMENTS,
  PATH_STILLS,
  placementImageStyle,
} from './pathMedia'

interface LandingHomeProps {
  onPickRole: (role: PathRole) => void
}

/** Hero status line under CTAs (rotating trust / fee beats). */
interface HeroClaim {
  icon: LucideIcon
  status: string
}

function buildHeroClaims(): HeroClaim[] {
  const pricing = getSealPricing()
  const feeNim = formatSealFeeNim(pricing.feeNim)

  return [
    {
      icon: ShieldCheck,
      status: 'Your document stays on this device. Always.',
    },
    {
      icon: Users,
      status: 'Co-sign with wallets. No file upload.',
    },
    {
      icon: Lock,
      status: pricing.promoActive
        ? `Permanent seal for ${feeNim} (July promo)`
        : `Permanent seal for a flat ${feeNim} fee`,
    },
    {
      icon: Fingerprint,
      status: 'Anyone can re-check the sealed proof later',
    },
  ]
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
    detail: 'Start an agreement, invite co-signers, lock a permanent proof',
    icon: Fingerprint,
    imageAlt: '',
  },
  {
    role: 'signer',
    title: 'I was invited',
    detail: 'Drop the shared file (or open your invite link), then sign',
    icon: Users,
    imageAlt: '',
  },
  {
    role: 'verifier',
    title: 'Verify a file',
    detail: 'Drop a file to check it still matches a sealed proof',
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

export function LandingHome({ onPickRole }: LandingHomeProps) {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  const { claim, visible: claimVisible } = useHeroClaims()
  const ClaimIcon = claim.icon

  return (
    <div className="lr-home">
      {/* Task-first hero: plain promise first, then three paths */}
      <section className="lr-hero-band" aria-labelledby="lr-hero-headline">
        <div className="lr-hero-copy">
          <h1 id="lr-hero-headline" className="lr-hero-headline">
            Sign a document together.{' '}
            <span className="lr-hero-headline-em">Prove it never changed.</span>
          </h1>
          <p className="lr-hero-sub">
            Co-sign agreements with your Nimiq account. Your document stays on your device. Lock a permanent
            proof anyone can check later. No account needed to verify locked documents.
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
            src={HERO_STILL}
            alt=""
            width={1280}
            height={720}
            decoding="async"
            style={{ objectPosition: formatObjectPosition(HERO_PLACEMENT) }}
          />
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
            <strong>Your file never leaves this device.</strong>
            <span className="lr-trust-sub">
              We store a short integrity proof, not your document.
            </span>
          </span>
          <span className={`lr-chevron${privacyOpen ? ' lr-chevron--open' : ''}`} aria-hidden />
        </button>
        {privacyOpen && (
          <div className="lr-trust-detail">
            <ul>
              <li>The math that identifies your file runs in the browser. The file stays local.</li>
              <li>Servers keep agreement metadata and that short proof string, never the file bytes.</li>
              <li>A permanent seal records only the proof on the Nimiq blockchain.</li>
              <li>Verification re-checks a local copy. No wallet required to verify.</li>
            </ul>
          </div>
        )}
      </section>

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
            Pick a path. Create, sign an invite, or verify a sealed document.
          </p>
        </div>

        <div className="lr-paths" role="list">
          {PATHS.map(path => {
            const Icon = path.icon
            const place = PATH_PLACEMENTS.card[path.role]
            return (
              <div key={path.role} className="lr-path-wrap" role="listitem">
                <button
                  type="button"
                  className={`lr-path lr-path--${path.role}`}
                  onClick={() => onPickRole(path.role)}
                >
                  <span className="lr-path-thumb" aria-hidden>
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
              </div>
            )
          })}
        </div>
      </section>

      <div className="lr-how-wrap">
        <LandingHowItWorks role={null} open={howOpen} onToggle={() => setHowOpen(v => !v)} />
      </div>

    </div>
  )
}
