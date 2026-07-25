/**
 * Wait UI while multi-tx data archive runs on the server.
 * Prefer real TX counts from SSE progress events (e.g. TX 12 of 80); fall back
 * to poll snapshots or a soft timer only when no counts are available yet.
 */
import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'

export type DataArchivePhase = 'charge' | 'write' | 'confirm' | 'done'

const PHASE_ORDER: DataArchivePhase[] = ['charge', 'write', 'confirm', 'done']

const PHASE_META: Record<DataArchivePhase, { label: string; detail: string }> = {
  charge: {
    label: 'Reserve credits',
    detail: 'Held for permanent storage',
  },
  write: {
    label: 'Write to Nimiq',
    detail: 'Posting each transaction',
  },
  confirm: {
    label: 'Confirm on chain',
    detail: 'Checking visibility',
  },
  done: {
    label: 'Stored forever',
    detail: 'Permanent on Nimiq',
  },
}

function phaseIndex(phase: DataArchivePhase): number {
  return PHASE_ORDER.indexOf(phase)
}

function maxPhase(a: DataArchivePhase, b: DataArchivePhase): DataArchivePhase {
  return phaseIndex(a) >= phaseIndex(b) ? a : b
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
  if (
    m.includes('confirm') ||
    m.includes('visible') ||
    m.includes('sample') ||
    m.includes('re-check')
  ) {
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
  /** Total multi-tx frames to write (from quote). */
  frameCount?: number
  /**
   * Frames already broadcast (tx hashes recorded). Real progress.
   * When set with frameCount, UI shows "TX n of total".
   */
  framesDone?: number | null
  /**
   * Optional server phase hint: processing write vs post-broadcast confirm.
   * 'write' | 'confirm' | 'done' | 'failed' | null
   */
  jobPhase?: 'write' | 'confirm' | 'done' | 'failed' | null
  message?: string | null
  /** Force done state (API returned success). */
  done?: boolean
  notifyEmail?: string | null
}

export function DataArchiveProgress({
  title,
  credits,
  frameCount = 0,
  framesDone = null,
  jobPhase = null,
  message = null,
  done = false,
  notifyEmail = null,
}: DataArchiveProgressProps) {
  const [elapsedSec, setElapsedSec] = useState(0)

  const total = Math.max(0, Math.floor(frameCount))
  const doneCount =
    framesDone != null && Number.isFinite(framesDone)
      ? Math.max(0, Math.min(total || Math.floor(framesDone), Math.floor(framesDone)))
      : null
  const hasRealProgress = total > 0 && doneCount != null

  const phase = useMemo((): DataArchivePhase => {
    if (done || jobPhase === 'done') return 'done'
    if (jobPhase === 'confirm') return 'confirm'
    if (jobPhase === 'write') return 'write'
    if (jobPhase === 'failed') return 'confirm'

    const fromMsg = phaseFromMessage(message)
    if (fromMsg === 'done') return 'done'

    // Real counts: all txs submitted → confirming samples
    if (hasRealProgress && doneCount! >= total && total > 0) {
      return 'confirm'
    }
    if (hasRealProgress && doneCount! > 0) {
      return 'write'
    }
    if (hasRealProgress && doneCount === 0) {
      return elapsedSec < 2 ? 'charge' : 'write'
    }

    // Soft fallback when poll has not reported counts yet
    if (elapsedSec < 3) return 'charge'
    if (elapsedSec < 8) return 'write'
    return fromMsg ? maxPhase(fromMsg, 'write') : 'write'
  }, [done, jobPhase, message, hasRealProgress, doneCount, total, elapsedSec])

  const percent = useMemo(() => {
    if (phase === 'done') return 100
    if (hasRealProgress && total > 0) {
      // Write phase: 0–90% from submitted txs; confirm phase: 90–99% until done
      if (doneCount! >= total) {
        const confirmBoost = Math.min(9, Math.floor(elapsedSec / 3))
        return Math.min(99, 90 + confirmBoost)
      }
      return Math.min(90, Math.round((doneCount! / total) * 90))
    }
    // Soft timer only when we lack server counts
    const raw = 1 - Math.exp(-elapsedSec / 40)
    return Math.min(88, Math.max(3, Math.round(raw * 88)))
  }, [phase, hasRealProgress, doneCount, total, elapsedSec])

  const active = phaseIndex(phase)

  useEffect(() => {
    setElapsedSec(0)
    const id = window.setInterval(() => setElapsedSec(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  /** One status line — no duplicate TX captions below. */
  const statusLine = useMemo(() => {
    if (phase === 'done') {
      return message?.trim() || 'Stored forever on Nimiq.'
    }
    if (phase === 'confirm') {
      if (hasRealProgress) {
        return `All ${total} transactions submitted — confirming…`
      }
      return 'Confirming on Nimiq…'
    }
    if (phase === 'write' && hasRealProgress) {
      if (doneCount === 0) return 'Writing to Nimiq…'
      // Show completed count (matches the logo counter), not next-tx off-by-one.
      return `Transaction ${doneCount} of ${total}`
    }
    if (phase === 'write') return 'Writing to Nimiq…'
    return 'Getting ready…'
  }, [phase, message, hasRealProgress, doneCount, total])

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
            <NimiqHexagonIcon size={32} className="data-archive-progress-hex" />
          ) : hasRealProgress ? (
            <span className="data-archive-progress-tx" aria-hidden>
              <NimiqHexagonIcon size={18} className="data-archive-progress-hex-sm" />
              <span className="data-archive-progress-tx-num">{doneCount}</span>
              <span className="data-archive-progress-tx-of">/{total}</span>
            </span>
          ) : (
            <NimiqHexagonIcon size={28} className="data-archive-progress-hex" />
          )}
        </div>
      </div>

      <div className="credit-seal-progress-copy">
        <h3 className="credit-seal-progress-title">
          {phase === 'done' ? 'Stored on Nimiq' : 'Storing on Nimiq'}
        </h3>
        {title && <p className="credit-seal-progress-doc muted">{title}</p>}
        <p className="credit-seal-progress-status">{statusLine}</p>
        {creditLabel && phase !== 'done' && (
          <p className="credit-seal-progress-elapsed muted">{creditLabel}</p>
        )}
      </div>

      <div
        className="data-archive-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total > 0 ? total : 100}
        aria-valuenow={hasRealProgress ? (doneCount ?? 0) : percent}
        aria-label={
          hasRealProgress
            ? `Transaction ${doneCount} of ${total}`
            : 'Archive progress'
        }
      >
        <div
          className="data-archive-progress-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="credit-seal-progress-steps">
        {PHASE_ORDER.filter(p => p !== 'done').map((p, i) => {
          const meta = PHASE_META[p]
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
                  <span className="data-archive-step-dot" />
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
        <p className="credit-seal-progress-tip data-archive-progress-tip">
          Work continues on VeriLock&apos;s servers — you can close this window
          {notifyEmail ? '; we will email you when it finishes' : ''}.
        </p>
      )}

      {phase === 'done' && notifyEmail && (
        <p className="credit-seal-progress-tip">
          A confirmation email is on its way to <strong>{notifyEmail}</strong>.
        </p>
      )}
    </div>
  )
}
