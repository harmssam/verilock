import { Check } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  allSigned,
  CREATOR_STAGES,
  signedCount,
  type DemoDoc,
  type JourneyStepId,
} from './types'

interface StageRailProps {
  step: JourneyStepId
  account: boolean
  doc: DemoDoc | null
  sharedAck: boolean
}

function isStepDone(
  stageId: JourneyStepId,
  step: JourneyStepId,
  account: boolean,
  doc: DemoDoc | null,
  sharedAck: boolean,
): boolean {
  if (step === 'done') return true
  if (!account && stageId === 'connect') return false
  if (account && stageId === 'connect') return step !== 'connect'
  if (doc && (stageId === 'connect' || stageId === 'fingerprint')) return true
  if (doc && stageId === 'share' && (sharedAck || signedCount(doc) > 0 || doc.directSeal))
    return true
  if (doc && stageId === 'sign' && allSigned(doc)) return true
  if (doc?.sealed && stageId === 'seal') return true
  return false
}

export function StageRail({ step, account, doc, sharedAck }: StageRailProps) {
  const railRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [pill, setPill] = useState({ left: 0, width: 0, ready: false })

  const currentIndex = (() => {
    if (step === 'done') return CREATOR_STAGES.length - 1
    const i = CREATOR_STAGES.findIndex(s => s.id === step)
    return i >= 0 ? i : 0
  })()

  const measure = useCallback(() => {
    const rail = railRef.current
    const item = itemRefs.current[currentIndex]
    if (!rail || !item) return

    // Position relative to padding box + scroll
    const left = item.offsetLeft
    const width = item.offsetWidth
    setPill(prev => {
      if (prev.left === left && prev.width === width && prev.ready) return prev
      return { left, width, ready: true }
    })

    // Keep current step visible on narrow screens
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
  }, [measure, step, account, doc, sharedAck])

  return (
    <nav ref={railRef} className="stage-rail" aria-label="Agreement journey">
      <span
        className={`stage-rail-pill${pill.ready ? ' stage-rail-pill--ready' : ''}`}
        style={{
          transform: `translateX(${pill.left}px)`,
          width: pill.width || undefined,
        }}
        aria-hidden
      />
      {CREATOR_STAGES.map((s, i) => {
        const current = i === currentIndex
        const done = isStepDone(s.id, step, account, doc, sharedAck) && !current
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
