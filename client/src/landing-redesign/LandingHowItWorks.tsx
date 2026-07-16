/**
 * How VeriLock works — landing redesign only.
 * Same stages/copy as production; quieter motion + registry styling.
 * Does not edit experiment/HowVeriLockWorks.tsx.
 */
import {
  FileText,
  Fingerprint,
  HelpCircle,
  Link2,
  Lock,
  PenLine,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import type { JourneyStage, JourneyStepId, PathRole } from '../experiment/types'
import { CREATOR_STAGES, stagesForRole } from '../experiment/types'

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
  verify: ShieldCheck,
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
      return (
        <div className={`lr-how-visual lr-how-visual--fingerprint${play}`} aria-hidden>
          <span className="lr-how-doc">
            <FileText size={20} strokeWidth={2} />
            <span className="lr-how-scan" />
          </span>
          <span className="lr-how-hash">
            <span />
            <span />
            <span />
            <span />
          </span>
          <Fingerprint className="lr-how-main-icon lr-how-main-icon--corner" size={18} strokeWidth={2.25} />
        </div>
      )
    case 'share':
      /* One PDF fans out to three co-signers (three paths → three people) */
      return (
        <div className={`lr-how-visual lr-how-visual--share${play}`} aria-hidden>
          <div className="lr-share">
            <span className="lr-share-doc">
              <FileText size={15} strokeWidth={2.25} />
            </span>

            <svg className="lr-share-paths" viewBox="0 0 48 56" fill="none" aria-hidden>
              {/* pathLength=100 → stroke-dasharray/offset 100 for reliable draw */}
              <path
                className="lr-share-path lr-share-path--1"
                pathLength={100}
                d="M6 28 C18 28 22 10 40 10"
              />
              <path
                className="lr-share-path lr-share-path--2"
                pathLength={100}
                d="M6 28 H40"
              />
              <path
                className="lr-share-path lr-share-path--3"
                pathLength={100}
                d="M6 28 C18 28 22 46 40 46"
              />
            </svg>

            <div className="lr-share-people">
              <span className="lr-share-person lr-share-person--1" />
              <span className="lr-share-person lr-share-person--2" />
              <span className="lr-share-person lr-share-person--3" />
            </div>
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
      return (
        <div className={`lr-how-visual lr-how-visual--seal${play}`} aria-hidden>
          <span className="lr-how-chain">
            <span />
            <span />
            <span />
          </span>
          <span className="lr-how-lock-wrap">
            <img
              className="lr-how-lock"
              src="/verilock-mark.png"
              alt=""
              width={40}
              height={40}
            />
          </span>
        </div>
      )
    case 'verify':
    case 'done':
      return (
        <div className={`lr-how-visual lr-how-visual--verify${play}`} aria-hidden>
          <span className="lr-how-doc lr-how-doc--sm">
            <FileText size={16} strokeWidth={2} />
          </span>
          <span className="lr-how-match">
            <ShieldCheck size={20} strokeWidth={2.25} />
          </span>
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
  revealed,
}: {
  stage: JourneyStage
  index: number
  total: number
  revealed: boolean
}) {
  const Icon = STEP_ICONS[stage.id] ?? HelpCircle

  return (
    <li
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
  /** Bitmask / set of revealed indices — sequential when accordion opens */
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set())

  const stageCount = stages.length

  useEffect(() => {
    if (!open) {
      setRevealed(new Set())
      return
    }

    if (prefersReducedMotion()) {
      setRevealed(new Set(Array.from({ length: stageCount }, (_, i) => i)))
      return
    }

    const timers: number[] = []
    // Lead-in, then one beat every ~110ms (calm stagger)
    for (let i = 0; i < stageCount; i++) {
      const id = window.setTimeout(() => {
        setRevealed(prev => {
          const next = new Set(prev)
          next.add(i)
          return next
        })
      }, 80 + i * 110)
      timers.push(id)
    }

    return () => {
      for (const id of timers) window.clearTimeout(id)
    }
  }, [open, stageCount])

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
            Your PDF never leaves this device. Only its SHA-256 fingerprint is written to the Nimiq
            blockchain when you seal.
          </p>
          <ol className="lr-how-list">
            {stages.map((stage, i) => (
              <StoryBeat
                key={stage.id}
                stage={stage}
                index={i}
                total={stages.length}
                revealed={revealed.has(i)}
              />
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
