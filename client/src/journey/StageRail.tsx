import { Check } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  allSigned,
  stagesForRole,
  signedCount,
  type JourneyDoc,
  type JourneyStepId,
  type PathRole,
} from './types'

interface StageRailProps {
  role: PathRole
  step: JourneyStepId
  account: boolean
  doc: JourneyDoc | null
  sharedAck: boolean
}

function isStepDone(
  role: PathRole,
  stageId: JourneyStepId,
  step: JourneyStepId,
  _account: boolean,
  doc: JourneyDoc | null,
): boolean {
  if (step === 'done') return true

  if (role === 'signer') {
    // When step is 'done', early return above marks all stages complete
    if (stageId === 'sign') return Boolean(doc && (allSigned(doc) || doc.sealed))
    if (stageId === 'done') return Boolean(doc?.sealed)
    return false
  }

  if (role === 'verifier') {
    return false
  }

  // Creator path: Fingerprint → Sign → Share → Seal → Verify (login is not a stage)
  if (doc && stageId === 'fingerprint') return true
  // Sign is done once the creator has signed (or direct seal / everyone done)
  if (doc && stageId === 'sign' && (signedCount(doc) > 0 || doc.directSeal || allSigned(doc)))
    return true
  // Share is done once everyone signed (moved on to seal) or direct seal
  if (doc && stageId === 'share' && (allSigned(doc) || doc.directSeal)) return true
  if (doc?.sealed && stageId === 'seal') return true
  return false
}

export function StageRail({ role, step, account, doc, sharedAck: _sharedAck }: StageRailProps) {
  const stages = stagesForRole(role)
  const railRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false })

  const currentIndex = (() => {
    if (role === 'signer' && (step === 'done' || doc?.sealed)) {
      return Math.max(0, stages.findIndex(s => s.id === 'done'))
    }
    if (role === 'creator' && step === 'done') return stages.length - 1
    const i = stages.findIndex(s => s.id === step)
    return i >= 0 ? i : 0
  })()

  const measure = useCallback(() => {
    const rail = railRef.current
    const item = itemRefs.current[currentIndex]
    if (!rail || !item) return

    const left = item.offsetLeft
    const width = item.offsetWidth
    setPill(prev => {
      if (prev.left === left && prev.width === width && prev.ready) return prev
      return { left, width, ready: true }
    })

    const itemRight = item.offsetLeft + item.offsetWidth
    const viewLeft = rail.scrollLeft
    const viewRight = viewLeft + rail.clientWidth
    if (item.offsetLeft < viewLeft) {
      rail.scrollTo({ left: item.offsetLeft - 8, behavior: 'smooth' })
    } else if (itemRight > viewRight) {
      rail.scrollTo({ left: itemRight - rail.clientWidth + 8, behavior: 'smooth' })
    }
  }, [currentIndex])

  useLayoutEffect(() => {
    measure()
    const rail = railRef.current
    if (!rail) return

    const ro = new ResizeObserver(() => measure())
    ro.observe(rail)
    itemRefs.current.forEach(el => {
      if (el) ro.observe(el)
    })
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, step, account, doc, role, stages.length])

  const ariaLabel =
    role === 'signer'
      ? 'Signing journey'
      : role === 'verifier'
        ? 'Verify journey'
        : 'Agreement journey'

  return (
    <nav ref={railRef} className="stage-rail" aria-label={ariaLabel}>
      <span
        className={`stage-rail-pill${pill.ready ? ' stage-rail-pill--ready' : ''}`}
        style={{
          transform: `translateX(${pill.left}px)`,
          width: pill.width || undefined,
        }}
        aria-hidden
      />
      {stages.map((s, i) => {
        const current = i === currentIndex
        const done = isStepDone(role, s.id, step, account, doc) && !current
        return (
          <div
            key={s.id}
            ref={el => {
              itemRefs.current[i] = el
            }}
            className={[
              'stage-rail-item',
              current ? 'stage-rail-item--current' : '',
              done ? 'stage-rail-item--done' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="stage-rail-dot">
              {done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
            </span>
            <span className="stage-rail-label">{s.label}</span>
          </div>
        )
      })}
    </nav>
  )
}
