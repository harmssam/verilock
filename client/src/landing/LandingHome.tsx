import {
  ArrowRight,
  ChevronRight,
  Fingerprint,
  Lock,
  BookSearch,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react'
import { formatBlogDate, getAllPosts } from '../blog'
import type { PathRole } from '../journey/types'
import { AppLink } from '../AppLink'
import { LandingHowItWorks } from './LandingHowItWorks'
import {
  formatObjectPosition,
  HERO_STILL,
  HERO_STILL_SIZE,
  PATH_PLACEMENTS,
  PATH_STILLS,
} from './pathMedia'

/** Path picker section - hero “Sign or verify” and `/#lr-paths` deep links. */
const PATHS_SECTION_ID = 'lr-paths'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Chrome (production) often attempts fragment scroll before React mounts the
 * target, then never retries. Brave/localhost often win on timing. Explicit
 * scrollIntoView matches Security/Pricing deep-link handling.
 */
function scrollToPathsSection(behavior?: ScrollBehavior): void {
  if (typeof window === 'undefined') return
  const el = document.getElementById(PATHS_SECTION_ID)
  if (!el) return
  const b = behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth')
  el.scrollIntoView({ behavior: b, block: 'start' })
}

/** Fade-up once the block enters the viewport (IntersectionObserver, no scroll listener). */
function useRevealInView<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setInView(true)
      return
    }
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setInView(true)
          io.disconnect()
          return
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return { ref, inView }
}

function revealClass(inView: boolean, className = '') {
  return `lr-reveal${inView ? ' lr-reveal--in' : ''}${className ? ` ${className}` : ''}`
}

interface LandingHomeProps {
  onPickRole: (role: PathRole) => void
  onOpenBlogPost?: (slug: string) => void
  onOpenBlogIndex?: () => void
}

/** Hero status line under CTAs (rotating trust / fee beats). */
interface HeroClaim {
  icon: LucideIcon
  status: string
}

function buildHeroClaims(): HeroClaim[] {
  return [
    {
      icon: ShieldCheck,
      status: 'Sign free — multi-party, wallet-backed.',
    },
    {
      icon: Users,
      status: 'Your document stays on your device. Always.',
    },
    {
      icon: Lock,
      status: 'Lock a permanent proof for 1 credit.',
    },
    {
      icon: Fingerprint,
      status: 'Anyone can re-check a locked proof later',
    },
  ]
}

/** Hold each claim; longer than the blur/swipe so it reads as calm, not a ticker. */
const ROTATE_MS = 7800
/** Exit/enter duration — keep in sync with `.lr-status` transition in App.css. */
const SWAP_MS = 580

/** Path icons: thin stroke, no chip chrome. BookSearch on verify. */
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
    title: 'Create & invite',
    detail: 'Fingerprint, invite co-signers, sign free; lock if needed',
    icon: Fingerprint,
    imageAlt: '',
  },
  {
    role: 'signer',
    title: 'I was invited',
    detail: 'Drop the shared file, then sign',
    icon: Users,
    imageAlt: '',
  },
  {
    role: 'verifier',
    title: 'Verify a file',
    detail: 'Drop a file to check it still matches a locked proof',
    icon: BookSearch,
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
      }, SWAP_MS)
    }, ROTATE_MS)
    return () => window.clearInterval(id)
  }, [claims.length])

  return { claim: claims[index] ?? claims[0], visible }
}

export function LandingHome({
  onPickRole,
  onOpenBlogPost,
  onOpenBlogIndex,
}: LandingHomeProps) {
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const [howOpen, setHowOpen] = useState(false)
  /** Path stage preview — Create & invite default; hover/focus swaps the still. */
  const [previewRole, setPreviewRole] = useState<PathRole>('creator')
  /** Featured + up to two more for a stronger home teaser. */
  const blogTeaser = useMemo(() => {
    const all = getAllPosts()
    return {
      latest: all[0] ?? null,
      more: all.slice(1, 3),
    }
  }, [])
  const latestPost = blogTeaser.latest
  const previewPath = useMemo(
    () => PATHS.find(p => p.role === previewRole) ?? PATHS[0]!,
    [previewRole],
  )
  const { claim, visible: claimVisible } = useHeroClaims()
  const ClaimIcon = claim.icon
  const heroCopyRef = useRef<HTMLDivElement>(null)
  const [heroCopyH, setHeroCopyH] = useState(0)
  const trustReveal = useRevealInView<HTMLElement>()
  const pathsReveal = useRevealInView<HTMLElement>()
  const howReveal = useRevealInView<HTMLDivElement>()
  const blogReveal = useRevealInView<HTMLElement>()

  /* Mobile image band height tracks copy; desktop image is absolute-fill of the same box. */
  useLayoutEffect(() => {
    const el = heroCopyRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => setHeroCopyH(Math.round(el.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [claim.status])

  // Honor /#lr-paths after SPA paint (native fragment scroll runs too early on cold load).
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    if (window.location.hash.replace(/^#/, '') !== PATHS_SECTION_ID) return
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth'
    scrollToPathsSection(behavior)
    // Second pass after hero image / font layout (production is slower than Vite).
    const t = window.setTimeout(() => scrollToPathsSection(behavior), 120)
    return () => window.clearTimeout(t)
  }, [])

  const onSignOrVerifyClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let modified clicks open / use native browser behavior.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    scrollToPathsSection()
    // replaceState keeps one history entry; re-click still scrolls when hash is already set.
    if (window.location.hash !== `#${PATHS_SECTION_ID}`) {
      window.history.replaceState(window.history.state, '', `#${PATHS_SECTION_ID}`)
    }
  }

  return (
    <div className="lr-home">
      {/* Hero: copy sizes the frame; still covers and may crop top/bottom */}
      <section className="lr-hero-band lr-reveal lr-reveal--in" aria-labelledby="lr-hero-headline">
        <div
          className="lr-hero-frame"
          style={
            {
              ['--lr-hero-copy-h']: heroCopyH > 0 ? `${heroCopyH}px` : undefined,
            } as CSSProperties
          }
        >
          <div className="lr-hero-copy" ref={heroCopyRef}>
            <h1 id="lr-hero-headline" className="lr-hero-headline lr-hero-headline--enter">
              <span className="lr-hero-headline-line">
                {(['Multi-party', 'document', 'signing.'] as const).map((word, i) => (
                  <span
                    key={word}
                    className="lr-hero-word"
                    style={{ ['--lr-hw-i' as string]: i }}
                  >
                    {word}
                    {i < 2 ? '\u00a0' : ''}
                  </span>
                ))}
              </span>{' '}
              <span className="lr-hero-headline-em">
                <span className="lr-hero-headline-em-text">Free.</span>
                {/*
                  Hand-drawn double underline (Cuputo / Noun Project).
                  Two filled brush paths — each stroke draws L→R via clip-path
                  (masks break under the Free. filter/transform entrance).
                */}
                <svg
                  className="lr-hero-free-underline"
                  viewBox="6 39.5 78 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                  focusable="false"
                >
                  <path
                    className="lr-hero-free-underline-stroke lr-hero-free-underline-stroke--1"
                    fill="currentColor"
                    d="M78.531,43.853c-2.199-0.224-4.183-0.188-6.265-0.193c-4.063-0.011-8.125-0.88-12.188-0.85c-9.099,0.079-18.339-0.421-27.47,0.402c-2.697,0.239-5.391,0.442-8.061,0.786c-0.256,0.031-0.51,0.063-0.767,0.099c-2.505,0.328-5.775,0.136-8.265,0.48c-2.192,0.457-3.891,1.03-5.99,0.874c-0.557-0.108-1.15-0.303-1.484-0.698c-0.729-0.848-1.068-1.624-0.715-2.271c0.115-0.213,0.313-0.432,0.527-0.629C8.27,41.487,8.77,41.2,9.042,41.175c4.692-0.5,10.015-0.594,14.255-0.683c2.093-0.042,4.254-0.099,6.896-0.208c6.104-0.156,15.729-0.256,21.839-0.406c5.339-0.135,10.692,0.609,15.979,1.162c2.01,0.209,3.276,0.209,5.078,0.266c0.301,0.004,0.641,0.015,0.99,0.025c1.781,0.057,4.989-0.224,6.025,0.317c1.037,0.547,1.761,0.604,2.667,1.609c0.048,0.991-0.317,1.449-0.78,1.615c-1.079,0.396-2.068,0.839-2.907,0.975c-0.983,0.156-1.776,0.162-1.937-0.213c-0.156-0.376-0.068-0.609,0.088-0.781c0.271-0.281,0.76-0.589,1.198-0.797L78.531,43.853z"
                  />
                  <path
                    className="lr-hero-free-underline-stroke lr-hero-free-underline-stroke--2"
                    fill="currentColor"
                    d="M35.744,48.336c1.677-0.088,3.364-0.203,5.036-0.142c2.115,0.074,3.907,0.314,6.006,0.281c0.708-0.009,5.016,0.005,5.604-0.004c1.833-0.032,3.636-0.026,5.464,0.025c1.213,0.036,2.432,0.109,3.636,0.251c2.833,0.333,5.76,0.557,8.547,1.192c0.708,0.162,1.432,0.297,2.145,0.167c0.708-0.125,1.792-0.5,1.719-1.276c-0.083-0.907-0.833-2.036-1.735-2.322c-0.276-0.084-0.911-0.475-1.192-0.533c-0.265-0.052-0.5-0.238-0.745-0.27c-0.578-0.078-1.011,0.188-1.547,0.318c-0.625,0.151-1.979-0.272-2.625-0.287c-2.281-0.057-3.609,0.525-5.891,0.505c-1.348-0.01-2.703-0.052-4.052-0.074c-1.295-0.021-2.593,0.017-3.885-0.052c-0.902-0.046-1.792-0.292-2.687-0.312c-0.767-0.016-1.543,0.125-2.297,0.276c-0.645,0.135-1.355,0.078-2.01,0.083c-0.599,0.011-1.333-0.14-1.891,0c-0.719,0.183-1.517,0.188-2.25,0.26c-1.38,0.136-2.074-0.109-3.448,0.063c-0.855,0.104-1.486,0.432-2.339,0.313c-0.437-0.063-1.557,0.219-1.994,0.172c-0.449-0.042-0.48,0.28-0.885,0.333c-0.491,0.061-0.986,0.047-1.475,0.067c-0.208,0.011-0.766-0.011-0.911,0.152c-0.204,0.224,0.203,0.687,0.509,0.818c1.121,0.489,2.74,0.098,3.922,0.057C34.895,48.383,35.318,48.362,35.744,48.336z"
                  />
                </svg>
              </span>
            </h1>
            <ul className="lr-hero-points">
              <li>Co-sign with your Nimiq wallet at no cost</li>
              <li>Your document stays on your device</li>
              <li>Lock a document on the blockchain for 1 credit when you need proof</li>
            </ul>
            {/*
              One primary CTA only. Paths below cover Create / Invited / Verify.
              Secondary jumps to path picker for co-signers and verifiers.
            */}
            <div className="lr-hero-ctas">
              <AppLink
                to="/?intent=creator"
                className="lr-cta lr-cta--primary"
                onClick={() => onPickRole('creator')}
              >
                Create &amp; invite free
                <ArrowRight size={16} strokeWidth={2.25} aria-hidden />
              </AppLink>
              <a
                className="lr-cta lr-cta--ghost"
                href={`#${PATHS_SECTION_ID}`}
                onClick={onSignOrVerifyClick}
              >
                Sign or verify
              </a>
            </div>
            <p className="lr-promo" role="note">
              <span className="lr-promo-free">Free to sign</span>
              <span className="lr-promo-sep" aria-hidden>
                ·
              </span>
              <span>Lock on chain for 1 credit</span>
            </p>
          </div>
          <div className="lr-hero-visual" aria-hidden>
            <img
              className="lr-hero-visual-img"
              src={HERO_STILL}
              alt=""
              width={HERO_STILL_SIZE.width}
              height={HERO_STILL_SIZE.height}
              decoding="async"
            />
          </div>
          {/* Centered on the full hero frame (not just the copy column width). */}
          <div className="lr-status-slot">
            <p
              className={`lr-status${claimVisible ? ' lr-status--in' : ''}`}
              aria-live="polite"
            >
              <ClaimIcon size={15} strokeWidth={2.25} aria-hidden />
              <span>{claim.status}</span>
            </p>
          </div>
        </div>
      </section>

      <section
        ref={trustReveal.ref}
        className={revealClass(
          trustReveal.inView,
          `lr-trust${privacyOpen ? ' lr-trust--open' : ''}`,
        )}
        style={{ ['--lr-reveal-delay' as string]: '40ms' }}
        aria-label="Privacy"
      >
        <button
          type="button"
          className="lr-trust-main"
          onClick={() => setPrivacyOpen(v => !v)}
          aria-expanded={privacyOpen}
        >
          <Fingerprint className="lr-trust-icon" size={18} strokeWidth={2.25} aria-hidden />
          <span className="lr-trust-copy">
            <strong>Your file never leaves your device.</strong>
            <span className="lr-trust-sub">
              We store a short integrity proof, not your document.
            </span>
          </span>
          <span className={`lr-chevron${privacyOpen ? ' lr-chevron--open' : ''}`} aria-hidden />
        </button>
        <div
          className="lr-expand"
          aria-hidden={!privacyOpen}
        >
          <div className="lr-expand-inner">
            <div className="lr-trust-detail">
              <ul>
                <li>
                  The math that identifies your file runs in the browser. The file stays local.
                </li>
                <li>
                  Servers keep agreement metadata and that short proof string, never the file
                  bytes.
                </li>
                <li>
                  A permanent on-chain lock records only the proof on the Nimiq blockchain.
                </li>
                <li>Verification re-checks a local copy. No wallet required to verify.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section
        ref={pathsReveal.ref}
        id={PATHS_SECTION_ID}
        className={revealClass(pathsReveal.inView, 'lr-paths-section')}
        style={{ ['--lr-reveal-delay' as string]: '60ms' }}
        aria-labelledby="lr-paths-title"
      >
        <div className="lr-paths-head">
          <h2 id="lr-paths-title" className="lr-paths-title">
            What are you here to do?
          </h2>
          <p className="lr-paths-lead">
            Pick a path. Create and invite free, open an invite, or verify a locked proof.
          </p>
        </div>

        {/*
          One stage, three stills. Hover/focus the list at the bottom to crossfade
          the image; click navigates. Create & invite is the default still.
        */}
        <div
          className={`lr-path-stage lr-path-stage--${previewRole}`}
          onMouseLeave={() => setPreviewRole('creator')}
        >
          <div className="lr-path-stage-media" aria-hidden>
            {PATHS.map(path => {
              const place = PATH_PLACEMENTS.track[path.role]
              const active = path.role === previewRole
              return (
                <img
                  key={path.role}
                  className={`lr-path-stage-img${active ? ' lr-path-stage-img--active' : ''}`}
                  src={PATH_STILLS[path.role]}
                  alt=""
                  width={1280}
                  height={720}
                  loading={path.role === 'creator' ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                  /* object-position only — transform is owned by CSS crossfade/zoom */
                  style={{ objectPosition: formatObjectPosition(place) }}
                />
              )
            })}
            <div className="lr-path-stage-veil" />
          </div>

          <div className="lr-path-stage-footer">
            <p className="lr-path-stage-caption" key={previewPath.role}>
              {previewPath.detail}
            </p>
            <nav className="lr-path-stage-dock" aria-label="Choose a path">
              <ul className="lr-path-stage-list">
                {PATHS.map(path => {
                  const Icon = path.icon
                  const active = path.role === previewRole
                  return (
                    <li key={path.role}>
                      <AppLink
                        to={`/?intent=${path.role}`}
                        className={[
                          'lr-path-stage-item',
                          `lr-path-stage-item--${path.role}`,
                          active ? 'lr-path-stage-item--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => onPickRole(path.role)}
                        aria-current={active ? 'true' : undefined}
                        onMouseEnter={() => setPreviewRole(path.role)}
                        onFocus={() => setPreviewRole(path.role)}
                      >
                        <span className="lr-path-stage-item-icon" aria-hidden>
                          <Icon size={PATH_ICON_SIZE} strokeWidth={PATH_ICON_STROKE} />
                        </span>
                        <span className="lr-path-stage-item-label">{path.title}</span>
                        <ChevronRight
                          className="lr-path-stage-item-go"
                          size={18}
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </AppLink>
                    </li>
                  )
                })}
              </ul>
            </nav>
          </div>
        </div>
      </section>

      <div
        ref={howReveal.ref}
        className={revealClass(howReveal.inView, 'lr-how-wrap')}
        style={{ ['--lr-reveal-delay' as string]: '80ms' }}
      >
        <LandingHowItWorks role={null} open={howOpen} onToggle={() => setHowOpen(v => !v)} />
      </div>

      {latestPost && onOpenBlogPost && (
        <section
          ref={blogReveal.ref}
          className={revealClass(blogReveal.inView, 'lr-blog-latest')}
          style={{ ['--lr-reveal-delay' as string]: '100ms' }}
          aria-labelledby="lr-blog-latest-title"
        >
          <div className="lr-blog-latest-head">
            <div className="lr-blog-latest-intro">
              <p className="lr-blog-latest-kicker">Learn</p>
              <h2 id="lr-blog-latest-title" className="lr-blog-latest-heading">
                From the blog
              </h2>
              <p className="lr-blog-latest-lead">
                Practical guides on multi-party signing, wallet identity, and permanent proof - without
                the subscription tax.
              </p>
            </div>
            {onOpenBlogIndex && (
              <AppLink to="/blog" className="lr-blog-latest-all" onClick={onOpenBlogIndex}>
                All posts
                <ArrowRight size={15} strokeWidth={2.25} aria-hidden />
              </AppLink>
            )}
          </div>
          <AppLink
            to={`/blog/${latestPost.slug}`}
            className="lr-blog-latest-card lr-blog-latest-card--featured"
            onClick={() => onOpenBlogPost(latestPost.slug)}
          >
            <span className="lr-blog-latest-thumb">
              <img
                src={latestPost.coverImage}
                alt=""
                width={640}
                height={360}
                loading="lazy"
                decoding="async"
              />
              <span className="lr-blog-latest-badge">Latest</span>
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
          </AppLink>
          {blogTeaser.more.length > 0 && (
            <div className="lr-blog-latest-more">
              {blogTeaser.more.map(post => (
                <AppLink
                  key={post.slug}
                  to={`/blog/${post.slug}`}
                  className="lr-blog-latest-mini"
                  onClick={() => onOpenBlogPost(post.slug)}
                >
                  <span className="lr-blog-latest-mini-thumb" aria-hidden>
                    <img
                      src={post.coverImage}
                      alt=""
                      width={320}
                      height={180}
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                  <span className="lr-blog-latest-mini-body">
                    <span className="lr-blog-latest-meta">
                      <time dateTime={post.date}>{formatBlogDate(post.date)}</time>
                      {post.tags[0] && (
                        <span className="lr-blog-latest-tag">{post.tags[0]}</span>
                      )}
                    </span>
                    <strong className="lr-blog-latest-mini-title">{post.title}</strong>
                    <span className="lr-blog-latest-cta">
                      Read
                      <ArrowRight size={14} strokeWidth={2.25} aria-hidden />
                    </span>
                  </span>
                </AppLink>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
