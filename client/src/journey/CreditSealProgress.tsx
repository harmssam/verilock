import {
  Check,
  Coins,
  Link2,
  LoaderCircle,
  Lock,
  Server,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

export type CreditSealPhase = 'hold' | 'broadcast' | 'confirm' | 'done'

const PHASE_ORDER: CreditSealPhase[] = ['hold', 'broadcast', 'confirm', 'done']

const PHASE_META: Record<
  CreditSealPhase,
  { label: string; detail: string; Icon: typeof Lock }
> = {
  hold: {
    label: 'Reserve credit',
    detail: '1 credit held for this seal',
    Icon: Coins,
  },
  broadcast: {
    label: 'Post on-chain proof',
    detail: 'VeriLock servers write the fingerprint to Nimiq',
    Icon: Server,
  },
  confirm: {
    label: 'Confirm on Nimiq',
    detail: 'Waiting for block inclusion',
    Icon: Link2,
  },
  done: {
    label: 'Sealed forever',
    detail: 'Proof is permanent on the chain',
    Icon: Lock,
  },
}

const WAIT_TIPS = [
  'Your file never leaves this device — only the fingerprint is locked on the blockchain.',
  'Closing this tab is fine. The server keeps working until the lock confirms.',
  'Come back anytime: open this agreement to see when it is locked.',
  'One credit = one permanent on-chain lock. No NIM wallet prompt needed.',
]

function phaseFromMessage(message: string | null): CreditSealPhase {
  if (!message) return 'hold'
  const m = message.toLowerCase()
  if (
    m.includes('locked') ||
    m.includes('sealed forever') ||
    m.includes('confirmed!') ||
    m.includes('confirmed on nimiq')
  ) {
    return 'done'
  }
  if (
    m.includes('confirm') ||
    m.includes('waiting for block') ||
    m.includes('waiting for nimiq') ||
    m.includes('safe to close')
  ) {
    return 'confirm'
  }
  if (
    m.includes('post') ||
    m.includes('broadcast') ||
    m.includes('proof submitted') ||
    m.includes('anchoring') ||
    m.includes('network')
  ) {
    return 'broadcast'
  }
  return 'hold'
}

function phaseIndex(phase: CreditSealPhase): number {
  return PHASE_ORDER.indexOf(phase)
}

/** Prefer the later of message-derived phase and time-based optimistic phase. */
function maxPhase(a: CreditSealPhase, b: CreditSealPhase): CreditSealPhase {
  return phaseIndex(a) >= phaseIndex(b) ? a : b
}

function optimisticPhase(elapsedSec: number): CreditSealPhase {
  // Single long HTTP request: advance the story while the server works.
  if (elapsedSec >= 28) return 'confirm'
  if (elapsedSec >= 6) return 'broadcast'
  return 'hold'
}

interface CreditSealProgressProps {
  message: string | null
  title?: string
  fingerprintPreview?: string
}

/**
 * Full-panel wait UI while a credit seal runs on the server.
 * Emphasizes that the browser is not required once the request has started.
 */
export function CreditSealProgress({
  message,
  title,
  fingerprintPreview,
}: CreditSealProgressProps) {
  const [tipIndex, setTipIndex] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)

  const phase = useMemo(() => {
    const fromMsg = phaseFromMessage(message)
    if (fromMsg === 'done') return 'done'
    return maxPhase(fromMsg, optimisticPhase(elapsedSec))
  }, [message, elapsedSec])

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
    if (phase === 'done') return 'Locked on Nimiq.'
    if (phase === 'confirm') return 'Confirming on Nimiq — safe to close this tab…'
    if (phase === 'broadcast') return 'Posting on-chain proof from VeriLock servers…'
    return 'Reserving 1 credit — you can leave this page anytime…'
  }, [message, phase])

  return (
    <div className="credit-seal-progress" role="status" aria-live="polite" aria-busy={phase !== 'done'}>
      <div className="credit-seal-progress-visual" aria-hidden>
        <div className="credit-seal-progress-glow" />
        <div className="credit-seal-progress-orbit credit-seal-progress-orbit--a" />
        <div className="credit-seal-progress-orbit credit-seal-progress-orbit--b" />
        <div className={`credit-seal-progress-core${phase === 'done' ? ' credit-seal-progress-core--done' : ''}`}>
          {phase === 'done' ? (
            <Lock size={28} strokeWidth={2.25} />
          ) : (
            <LoaderCircle className="credit-seal-progress-spinner" size={28} strokeWidth={2.25} />
          )}
        </div>
      </div>

      <div className="credit-seal-progress-copy">
        <p className="credit-seal-progress-kicker">
          <Sparkles size={14} strokeWidth={2.25} aria-hidden />
          Locking with 1 credit
        </p>
        <h3 className="credit-seal-progress-title">
          {phase === 'done' ? 'Locked on the Nimiq blockchain' : 'Anchoring your document on-chain'}
        </h3>
        {title && <p className="credit-seal-progress-doc muted">{title}</p>}
        {fingerprintPreview && (
          <p className="credit-seal-progress-fp muted">
            Fingerprint <code className="mono">{fingerprintPreview}</code>
          </p>
        )}
        <p className="credit-seal-progress-status">{statusLine}</p>
        <p className="credit-seal-progress-elapsed muted">
          {phase === 'done' ? 'Done' : `${elapsedSec}s · usually under a minute`}
        </p>
      </div>

      <ol className="credit-seal-progress-steps">
        {PHASE_ORDER.filter(p => p !== 'done').map((p, i) => {
          const meta = PHASE_META[p]
          const Icon = meta.Icon
          const done = active > i || phase === 'done'
          const current = active === i && phase !== 'done'
          return (
            <li
              key={p}
              className={[
                'credit-seal-progress-step',
                done ? 'credit-seal-progress-step--done' : '',
                current ? 'credit-seal-progress-step--current' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="credit-seal-progress-step-icon" aria-hidden>
                {done ? (
                  <Check size={16} strokeWidth={2.5} />
                ) : current ? (
                  <LoaderCircle className="credit-seal-progress-step-spin" size={16} strokeWidth={2.25} />
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
            <strong>You can leave this page</strong>
            <p className="muted">
              Locking runs on VeriLock’s servers — closing the tab or switching apps does not cancel
              it. Reopen this agreement anytime to see the locked status.
            </p>
          </div>
        </div>
      )}

      {phase !== 'done' && (
        <p className="credit-seal-progress-tip" key={tipIndex}>
          {WAIT_TIPS[tipIndex]}
        </p>
      )}
    </div>
  )
}
