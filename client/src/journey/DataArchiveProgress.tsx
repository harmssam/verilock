/**
 * Wait UI while multi-tx data archive runs on the server (same spirit as CreditSealProgress).
 * Uses optimistic % progress — server does not stream per-frame updates yet.
 */
import {
  Check,
  Coins,
  Database,
  Link2,
  LoaderCircle,
  Server,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export type DataArchivePhase = 'charge' | 'write' | 'confirm' | 'done'

const PHASE_ORDER: DataArchivePhase[] = ['charge', 'write', 'confirm', 'done']

const PHASE_META: Record<
  DataArchivePhase,
  { label: string; detail: string; Icon: typeof Database }
> = {
  charge: {
    label: 'Reserve credits',
    detail: 'Credits held for permanent storage',
    Icon: Coins,
  },
  write: {
    label: 'Write to blockchain',
    detail: 'VeriLock posts signatures and fields on Nimiq',
    Icon: Server,
  },
  confirm: {
    label: 'Confirm on chain',
    detail: 'Waiting for the network to accept the data',
    Icon: Link2,
  },
  done: {
    label: 'Stored forever',
    detail: 'Data is permanent on the Nimiq blockchain',
    Icon: Database,
  },
}

const WAIT_TIPS = [
  'You do not need to stay on this page — work continues on VeriLock’s servers.',
  'The PDF never leaves your devices. Only signatures and form fields go on-chain.',
  'Larger agreements take longer (more data frames). A minute or two is normal.',
  'Come back anytime under My agreements to see the “Data on blockchain” badge.',
]

function phaseIndex(phase: DataArchivePhase): number {
  return PHASE_ORDER.indexOf(phase)
}

function maxPhase(a: DataArchivePhase, b: DataArchivePhase): DataArchivePhase {
  return phaseIndex(a) >= phaseIndex(b) ? a : b
}

/** Rough duration scales with frame count (multi-tx). */
function estimateDurationSec(frameCount: number): number {
  // ~0.4s per frame + overhead; clamp for tiny / huge streams
  return Math.min(180, Math.max(25, Math.round(frameCount * 0.45 + 12)))
}

function optimisticPhase(elapsedSec: number, durationSec: number): DataArchivePhase {
  const t = elapsedSec / durationSec
  if (t >= 0.82) return 'confirm'
  if (t >= 0.12) return 'write'
  return 'charge'
}

function optimisticPercent(elapsedSec: number, durationSec: number, done: boolean): number {
  if (done) return 100
  // Ease toward ~92% while waiting so we never fake 100% before success.
  const raw = 1 - Math.exp(-elapsedSec / (durationSec * 0.55))
  return Math.min(92, Math.max(3, Math.round(raw * 92)))
}

function phaseFromMessage(message: string | null): DataArchivePhase | null {
  if (!message) return null
  const m = message.toLowerCase()
  if (
    m.includes('stored forever') ||
    m.includes('data on blockchain') ||
    (m.includes('on-chain') && m.includes('complete'))
  ) {
    return 'done'
  }
  if (m.includes('confirm') || m.includes('visible') || m.includes('safe to leave')) {
    return 'confirm'
  }
  if (m.includes('write') || m.includes('broadcast') || m.includes('post')) {
    return 'write'
  }
  if (m.includes('credit') || m.includes('reserv')) {
    return 'charge'
  }
  return null
}

interface DataArchiveProgressProps {
  title?: string
  credits?: number
  frameCount?: number
  message?: string | null
  /** Force done state (API returned success). */
  done?: boolean
  notifyEmail?: string | null
}

export function DataArchiveProgress({
  title,
  credits,
  frameCount = 0,
  message = null,
  done = false,
  notifyEmail = null,
}: DataArchiveProgressProps) {
  const [tipIndex, setTipIndex] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const durationSec = useMemo(() => estimateDurationSec(frameCount), [frameCount])

  const phase = useMemo(() => {
    if (done) return 'done' as const
    const fromMsg = phaseFromMessage(message)
    if (fromMsg === 'done') return 'done'
    const optimistic = optimisticPhase(elapsedSec, durationSec)
    return fromMsg ? maxPhase(fromMsg, optimistic) : optimistic
  }, [done, message, elapsedSec, durationSec])

  const percent = useMemo(
    () => optimisticPercent(elapsedSec, durationSec, phase === 'done'),
    [elapsedSec, durationSec, phase],
  )

  const active = phaseIndex(phase)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) return
    const id = window.setInterval(() => {
      setTipIndex(i => (i + 1) % WAIT_TIPS.length)
    }, 4800)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    setElapsedSec(0)
    const id = window.setInterval(() => setElapsedSec(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const statusLine = useMemo(() => {
    if (message?.trim()) return message.trim()
    if (phase === 'done') return 'Stored forever on the Nimiq blockchain.'
    if (phase === 'confirm') return 'Confirming on the Nimiq blockchain — safe to leave…'
    if (phase === 'write') return 'Writing signatures and fields on-chain…'
    return 'Reserving credits — you can leave this page anytime…'
  }, [message, phase])

  const creditLabel =
    credits != null && credits > 0
      ? credits === 1
        ? '1 credit'
        : `${credits} credits`
      : null

  return (
    <div
      className="credit-seal-progress data-archive-progress"
      role="status"
      aria-live="polite"
      aria-busy={phase !== 'done'}
    >
      <div className="credit-seal-progress-visual" aria-hidden>
        <div className="credit-seal-progress-glow" />
        <div className="credit-seal-progress-orbit credit-seal-progress-orbit--a" />
        <div className="credit-seal-progress-orbit credit-seal-progress-orbit--b" />
        <div
          className={`credit-seal-progress-core${
            phase === 'done' ? ' credit-seal-progress-core--done' : ''
          }`}
        >
          {phase === 'done' ? (
            <Database size={28} strokeWidth={2.25} />
          ) : (
            <span className="data-archive-progress-pct">{percent}%</span>
          )}
        </div>
      </div>

      <div className="credit-seal-progress-copy">
        <p className="credit-seal-progress-kicker">
          <Sparkles size={14} strokeWidth={2.25} aria-hidden />
          {creditLabel
            ? `Storing with ${creditLabel}`
            : 'Storing on the Nimiq blockchain'}
        </p>
        <h3 className="credit-seal-progress-title">
          {phase === 'done'
            ? 'Stored on the Nimiq blockchain'
            : 'Writing your data on-chain'}
        </h3>
        {title && <p className="credit-seal-progress-doc muted">{title}</p>}
        <p className="credit-seal-progress-status">{statusLine}</p>
        <p className="credit-seal-progress-elapsed muted">
          {phase === 'done'
            ? 'Done'
            : `${percent}% · ${elapsedSec}s · often 30–90 seconds for larger agreements`}
        </p>
      </div>

      <div
        className="data-archive-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Archive progress"
      >
        <div
          className="data-archive-progress-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="credit-seal-progress-steps">
        {PHASE_ORDER.filter(p => p !== 'done').map((p, i) => {
          const meta = PHASE_META[p]
          const Icon = meta.Icon
          const stepDone = active > i || phase === 'done'
          const current = active === i && phase !== 'done'
          return (
            <li
              key={p}
              className={[
                'credit-seal-progress-step',
                stepDone ? 'credit-seal-progress-step--done' : '',
                current ? 'credit-seal-progress-step--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="credit-seal-progress-step-icon" aria-hidden>
                {stepDone ? (
                  <Check size={16} strokeWidth={2.5} />
                ) : current ? (
                  <LoaderCircle
                    className="credit-seal-progress-step-spin"
                    size={16}
                    strokeWidth={2.25}
                  />
                ) : (
                  <Icon size={16} strokeWidth={2.25} />
                )}
              </span>
              <span className="credit-seal-progress-step-text">
                <strong>{meta.label}</strong>
                <span className="muted">{meta.detail}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {phase !== 'done' && (
        <div className="credit-seal-progress-leave">
          <Server size={18} strokeWidth={2.25} aria-hidden />
          <div>
            <strong>You do not need to wait here</strong>
            <p className="muted">
              Writing runs on VeriLock&apos;s servers. Close this window or switch apps —
              reopen My agreements anytime for the status
              {notifyEmail ? ', or check your email when it finishes' : ''}.
            </p>
          </div>
        </div>
      )}

      {phase === 'done' && notifyEmail && (
        <p className="credit-seal-progress-tip">
          A confirmation email is on its way to <strong>{notifyEmail}</strong>.
        </p>
      )}

      {phase !== 'done' && (
        <p className="credit-seal-progress-tip" key={tipIndex}>
          {WAIT_TIPS[tipIndex]}
        </p>
      )}
    </div>
  )
}
