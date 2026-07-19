/**
 * How VeriLock works — shell home accordion (light production SPA).
 * Stages/copy match the product flow; quieter motion for the landing surface.
 * Beat animations start when each step scrolls into view and play once (no loop).
 */
import {
  FileText,
  Fingerprint,
  HelpCircle,
  Link2,
  Lock,
  PenLine,
  Search,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import type { JourneyStage, JourneyStepId, PathRole } from '../journey/types'
import { CREATOR_STAGES, stagesForRole } from '../journey/types'

interface LandingHowItWorksProps {
  role: PathRole | null
  open: boolean
  onToggle: () => void
}

const STEP_ICONS: Record<JourneyStepId, LucideIcon> = {
  welcome: HelpCircle,
  connect: Wallet,
  fingerprint: Fingerprint,
  share: Link2,
  sign: PenLine,
  seal: Lock,
  verify: Search,
  done: ShieldCheck,
}

function roleSubtitle(role: PathRole | null): string {
  if (role === 'signer') return 'Match the shared PDF and sign with your wallet'
  if (role === 'verifier') return 'Check a sealed proof anytime. No wallet needed'
  return 'Sign together on your device, then lock a permanent proof'
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function BeatVisual({ stageId, active }: { stageId: JourneyStepId; active: boolean }) {
  const play = active ? ' lr-how-visual--play' : ''
  switch (stageId) {
    case 'connect':
      /* Identity handshake: you ↔ Nimiq, then wallet settles + address resolves */
      return (
        <div className={`lr-how-visual lr-how-visual--connect${play}`} aria-hidden>
          <div className="lr-conn">
            <span className="lr-conn-node lr-conn-node--you">
              <span className="lr-conn-avatar" />
            </span>

            <span className="lr-conn-bridge">
              <span className="lr-conn-rail" />
              <span className="lr-conn-fill" />
              <span className="lr-conn-packet" />
            </span>

            <span className="lr-conn-node lr-conn-node--chain">
              <NimiqHexagonIcon size={22} className="lr-conn-hex" />
            </span>
          </div>

          <div className="lr-conn-footer">
            <Wallet className="lr-conn-wallet" size={13} strokeWidth={2.4} />
            <span className="lr-conn-address" aria-hidden>
              <span className="lr-conn-addr-fixed">NQ</span>
              <span className="lr-conn-addr-bits">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
          </div>
        </div>
      )
    case 'fingerprint':
      /* PDF → fingerprint: file icon, arrow, fingerprint (icons alone, no boxes) */
      return (
        <div className={`lr-how-visual lr-how-visual--fingerprint${play}`} aria-hidden>
          <div className="lr-fp">
            <span className="lr-fp-file">
              <FileText size={26} strokeWidth={1.9} />
            </span>
            <svg
              className="lr-fp-arrow"
              viewBox="0 0 28 16"
              fill="none"
              aria-hidden
            >
              <path
                className="lr-fp-arrow-line"
                pathLength={100}
                d="M2 8 H20"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                className="lr-fp-arrow-head"
                d="M17 3.5 L22.5 8 L17 12.5"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="lr-fp-print">
              <Fingerprint size={26} strokeWidth={1.9} />
            </span>
          </div>
        </div>
      )
    case 'share':
      /*
       * One PDF fans out to three co-signers.
       * Paths + person dots share one SVG viewBox so endpoints stay aligned.
       * Doc is the FileText icon itself (no surrounding box).
       */
      return (
        <div className={`lr-how-visual lr-how-visual--share${play}`} aria-hidden>
          <div className="lr-share">
            <span className="lr-share-doc">
              <FileText size={24} strokeWidth={1.9} />
            </span>

            <svg
              className="lr-share-diagram"
              viewBox="0 0 48 56"
              fill="none"
              aria-hidden
            >
              <path
                className="lr-share-path lr-share-path--1"
                pathLength={100}
                d="M8 28 C20 28 24 12 38 12"
              />
              <path
                className="lr-share-path lr-share-path--2"
                pathLength={100}
                d="M8 28 H38"
              />
              <path
                className="lr-share-path lr-share-path--3"
                pathLength={100}
                d="M8 28 C20 28 24 44 38 44"
              />
              <circle className="lr-share-person lr-share-person--1" cx={42} cy={12} r={3.4} />
              <circle className="lr-share-person lr-share-person--2" cx={42} cy={28} r={3.4} />
              <circle className="lr-share-person lr-share-person--3" cx={42} cy={44} r={3.4} />
            </svg>
          </div>
        </div>
      )
    case 'sign':
      return (
        <div className={`lr-how-visual lr-how-visual--sign${play}`} aria-hidden>
          <span className="lr-how-sig lr-how-sig--a" />
          <span className="lr-how-sig lr-how-sig--b" />
          <span className="lr-how-check" />
          <PenLine className="lr-how-main-icon lr-how-main-icon--bl" size={18} strokeWidth={2.25} />
        </div>
      )
    case 'seal':
      /*
       * Regular flat-top hex + padlock. Shackle behind opaque body.
       * Left leg is shorter so raised = open padlock; drop = locked.
       * Plays once on scroll-in.
       */
      return (
        <div className={`lr-how-visual lr-how-visual--seal${play}`} aria-hidden>
          <span className="lr-how-chain">
            <span />
            <span />
            <span />
          </span>
          <span className="lr-how-lock-wrap">
            <svg
              className="lr-how-seal-svg"
              viewBox="0 0 48 48"
              fill="none"
              aria-hidden
            >
              {/*
                Regular flat-top hexagon (center 24,24, R=18).
                Vertices at 0°/60°/… so top & bottom edges are horizontal,
                width:height = 2 : √3.
              */}
              <path
                className="lr-how-seal-hex"
                d="M42 24 L33 39.59 L15 39.59 L6 24 L15 8.41 L33 8.41 Z"
              />
              <g className="lr-how-padlock">
                {/*
                  Shackle first (under body). Right leg long (hinge in body);
                  left leg short so when raised it clears the body = unlocked.
                */}
                <g className="lr-how-pad-shackle-g">
                  <path
                    className="lr-how-pad-shackle"
                    d="M19.25 23.4 V16.4 A4.75 4.75 0 0 1 28.75 16.4 V28.2"
                    strokeWidth="2.5"
                    strokeLinecap="butt"
                    strokeLinejoin="round"
                  />
                </g>
                {/* Opaque body covers shackle feet when locked */}
                <rect
                  className="lr-how-pad-body"
                  x="16.5"
                  y="22"
                  width="15"
                  height="13"
                  rx="2.4"
                />
                <circle className="lr-how-pad-keyhole" cx="24" cy="27.2" r="1.4" />
                <path
                  className="lr-how-pad-keyslot"
                  d="M24 28.3 V31.4"
                  strokeWidth="1.55"
                  strokeLinecap="round"
                />
              </g>
            </svg>
          </span>
        </div>
      )
    case 'verify':
    case 'done':
      /* Real magnifying-glass shape (lens + handle) drifts over the document */
      return (
        <div className={`lr-how-visual lr-how-visual--verify${play}`} aria-hidden>
          <div className="lr-how-inspect">
            <span className="lr-how-inspect-doc">
              <span className="lr-how-inspect-lines" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
            </span>
            <svg
              className="lr-how-inspect-glass"
              viewBox="0 0 40 40"
              fill="none"
              aria-hidden
            >
              {/* Lens rim */}
              <circle
                className="lr-how-inspect-rim"
                cx="16"
                cy="16"
                r="10.5"
                strokeWidth="2.4"
              />
              {/* Slight glass fill */}
              <circle className="lr-how-inspect-lens" cx="16" cy="16" r="8.2" />
              {/* Handle */}
              <path
                className="lr-how-inspect-handle"
                d="M24.2 24.2 L34 34"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>
      )
    default:
      return (
        <div className={`lr-how-visual${play}`} aria-hidden>
          <HelpCircle size={20} strokeWidth={2.25} />
        </div>
      )
  }
}

function StoryBeat({
  stage,
  index,
  total,
  open,
}: {
  stage: JourneyStage
  index: number
  total: number
  open: boolean
}) {
  const Icon = STEP_ICONS[stage.id] ?? HelpCircle
  const beatRef = useRef<HTMLLIElement>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    if (!open) {
      setRevealed(false)
      return
    }

    if (prefersReducedMotion()) {
      setRevealed(true)
      return
    }

    const el = beatRef.current
    if (!el) return

    /**
     * Play each beat’s visual only when it enters the viewport while scrolling.
     * rootMargin bottom pulls the trigger slightly earlier so the draw finishes
     * while the card is still comfortably on screen.
     */
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          setRevealed(true)
          io.disconnect()
          return
        }
      },
      {
        threshold: 0.45,
        rootMargin: '0px 0px -12% 0px',
      },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [open, stage.id])

  return (
    <li
      ref={beatRef}
      className={`lr-how-beat${revealed ? ' lr-how-beat--in' : ''}`}
      style={{ ['--lr-how-i' as string]: index }}
    >
      <div className="lr-how-rail" aria-hidden>
        <span className="lr-how-dot">
          <Icon size={12} strokeWidth={2.5} />
        </span>
        {index < total - 1 && <span className="lr-how-line" />}
      </div>

      <div className="lr-how-body">
        <BeatVisual stageId={stage.id} active={revealed} />
        <div className="lr-how-copy">
          <span className="lr-how-step">Step {index + 1}</span>
          <strong className="lr-how-title">{stage.label}</strong>
          <p className="lr-how-verb">{stage.verb}</p>
          <p className="lr-how-blurb">{stage.blurb}</p>
          <p className="lr-how-privacy">{stage.privacyNote}</p>
        </div>
      </div>
    </li>
  )
}

export function LandingHowItWorks({ role, open, onToggle }: LandingHowItWorksProps) {
  const stages = role ? stagesForRole(role) : CREATOR_STAGES

  return (
    <section className={`lr-how${open ? ' lr-how--open' : ''}`}>
      <button
        type="button"
        className="lr-how-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <HelpCircle size={18} strokeWidth={2.25} aria-hidden />
        <span className="lr-how-toggle-text">
          <strong>How VeriLock works</strong>
          <span className="lr-how-toggle-sub">{roleSubtitle(role)}</span>
        </span>
        <span className={`lr-how-chevron${open ? ' lr-how-chevron--open' : ''}`} aria-hidden />
      </button>

      {open && (
        <div className="lr-how-story">
          <p className="lr-how-lead">
            Your file never leaves this device. Only its SHA-256 fingerprint is written to the Nimiq
            blockchain when you seal.
          </p>
          <ol className="lr-how-list">
            {stages.map((stage, i) => (
              <StoryBeat
                key={stage.id}
                stage={stage}
                index={i}
                total={stages.length}
                open={open}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
