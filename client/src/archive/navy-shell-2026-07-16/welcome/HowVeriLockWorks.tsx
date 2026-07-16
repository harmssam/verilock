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
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import type { JourneyStage, JourneyStepId, PathRole } from './types'
import { CREATOR_STAGES, stagesForRole } from './types'

interface HowVeriLockWorksProps {
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
  if (role === 'verifier') return 'Check a sealed fingerprint anytime — no wallet needed'
  return 'Fingerprint locally, sign together, seal permanently on Nimiq'
}

function BeatVisual({ stageId, active }: { stageId: JourneyStepId; active: boolean }) {
  switch (stageId) {
    case 'connect':
      return (
        <div className={`how-visual how-visual--connect${active ? ' how-visual--play' : ''}`} aria-hidden>
          <span className="how-visual-ring" />
          <span className="how-visual-ring how-visual-ring--delay" />
          <NimiqHexagonIcon size={28} className="how-visual-hex" />
          <Wallet className="how-visual-main-icon" size={22} strokeWidth={2.25} />
        </div>
      )
    case 'fingerprint':
      return (
        <div className={`how-visual how-visual--fingerprint${active ? ' how-visual--play' : ''}`} aria-hidden>
          <span className="how-visual-doc">
            <FileText size={22} strokeWidth={2} />
            <span className="how-visual-scan" />
          </span>
          <span className="how-visual-hash">
            <span />
            <span />
            <span />
            <span />
          </span>
          <Fingerprint className="how-visual-main-icon" size={20} strokeWidth={2.25} />
        </div>
      )
    case 'share':
      return (
        <div className={`how-visual how-visual--share${active ? ' how-visual--play' : ''}`} aria-hidden>
          <span className="how-visual-doc how-visual-doc--sm">
            <FileText size={18} strokeWidth={2} />
          </span>
          <span className="how-visual-trail" />
          <span className="how-visual-people">
            <span />
            <span />
            <span />
          </span>
          <Link2 className="how-visual-main-icon" size={18} strokeWidth={2.25} />
        </div>
      )
    case 'sign':
      return (
        <div className={`how-visual how-visual--sign${active ? ' how-visual--play' : ''}`} aria-hidden>
          <span className="how-visual-sig how-visual-sig--a" />
          <span className="how-visual-sig how-visual-sig--b" />
          <span className="how-visual-check" />
          <PenLine className="how-visual-main-icon" size={20} strokeWidth={2.25} />
        </div>
      )
    case 'seal':
      return (
        <div className={`how-visual how-visual--seal${active ? ' how-visual--play' : ''}`} aria-hidden>
          <span className="how-visual-chain">
            <span />
            <span />
            <span />
          </span>
          <span className="how-visual-lock-wrap">
            <img className="how-visual-lock" src="/verilock-mark.png" alt="" width={44} height={44} />
          </span>
          <span className="how-visual-seal-glow" />
        </div>
      )
    case 'verify':
    case 'done':
      return (
        <div className={`how-visual how-visual--verify${active ? ' how-visual--play' : ''}`} aria-hidden>
          <span className="how-visual-doc how-visual-doc--sm">
            <FileText size={18} strokeWidth={2} />
          </span>
          <span className="how-visual-match">
            <ShieldCheck size={22} strokeWidth={2.25} />
          </span>
          <span className="how-visual-spark how-visual-spark--1" />
          <span className="how-visual-spark how-visual-spark--2" />
          <span className="how-visual-spark how-visual-spark--3" />
        </div>
      )
    default:
      return (
        <div className={`how-visual${active ? ' how-visual--play' : ''}`} aria-hidden>
          <HelpCircle size={22} strokeWidth={2.25} />
        </div>
      )
  }
}

function StoryBeat({
  stage,
  index,
  total,
}: {
  stage: JourneyStage
  index: number
  total: number
}) {
  const ref = useRef<HTMLLIElement>(null)
  const [visible, setVisible] = useState(false)
  const Icon = STEP_ICONS[stage.id] ?? HelpCircle

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setVisible(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.35, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <li
      ref={ref}
      className={`how-beat${visible ? ' how-beat--visible' : ''}`}
      style={{ '--how-i': index } as CSSProperties}
    >
      <div className="how-beat-rail" aria-hidden>
        <span className="how-beat-dot">
          <Icon size={13} strokeWidth={2.5} />
        </span>
        {index < total - 1 && <span className="how-beat-line" />}
      </div>

      <div className="how-beat-body">
        <BeatVisual stageId={stage.id} active={visible} />
        <div className="how-beat-copy">
          <span className="how-beat-step">Step {index + 1}</span>
          <strong className="how-beat-title">{stage.label}</strong>
          <p className="how-beat-verb">{stage.verb}</p>
          <p className="how-beat-blurb">{stage.blurb}</p>
          <p className="how-beat-privacy muted">{stage.privacyNote}</p>
        </div>
      </div>
    </li>
  )
}

export function HowVeriLockWorks({ role, open, onToggle }: HowVeriLockWorksProps) {
  const stages = role ? stagesForRole(role) : CREATOR_STAGES

  return (
    <section className={`how-block${open ? ' how-block--open' : ''}`}>
      <button
        type="button"
        className="how-toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <HelpCircle size={18} strokeWidth={2.25} aria-hidden />
        <span>
          <strong>How VeriLock works</strong>
          <span className="muted"> {roleSubtitle(role)}</span>
        </span>
        <span className={`trust-chevron${open ? ' trust-chevron--open' : ''}`} />
      </button>

      {open && (
        <div className="how-story">
          <p className="how-story-lead muted">
            Your PDF never leaves this device. Only its SHA-256 fingerprint is written to the Nimiq
            blockchain when you seal.
          </p>
          <ol className="how-story-list">
            {stages.map((stage, i) => (
              <StoryBeat key={stage.id} stage={stage} index={i} total={stages.length} />
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}
