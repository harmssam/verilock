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
      status: 'Sign documents free - multi-party, wallet-backed.',
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
    title: 'Create & sign',
    detail: 'Start free: invite co-signers, lock on blockchain if needed',
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
  /** Path stage preview — Create & sign default; hover/focus swaps the still. */
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
              </span>
            </h1>
            <ul className="lr-hero-points">
              <li>Co-sign with your Nimiq wallet at no cost</li>
              <li>Your document stays on your device</li>
              <li>Print when everyone has signed</li>
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
                Create &amp; sign free
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
            Pick a path. Create and sign free, open an invite, or verify a locked proof.
          </p>
        </div>

        {/*
          One stage, three stills. Hover/focus the list at the bottom to crossfade
          the image; click navigates. Create & sign is the default still.
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
