import {
  Fingerprint,
  Lock,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatSealFeeNim, getSealPricing } from '../sealPricing'

interface FeatureSlide {
  icon: LucideIcon
  text: string
}

function buildSlides(): FeatureSlide[] {
  const pricing = getSealPricing()
  const feeLine = pricing.promoActive
    ? `Seal forever for ${formatSealFeeNim(pricing.feeNim)} (July promo)`
    : `Seal forever for a flat ${formatSealFeeNim(pricing.feeNim)} fee`

  return [
    {
      icon: ShieldCheck,
      text: 'Your PDF never leaves this device',
    },
    {
      icon: Lock,
      text: feeLine,
    },
    {
      icon: Fingerprint,
      text: 'Verify anytime — no account required',
    },
    {
      icon: Users,
      text: 'Co-sign with wallets — no file uploads',
    },
    {
      icon: ShieldCheck,
      text: 'Only the SHA-256 fingerprint is sealed on Nimiq',
    },
  ]
}

const ROTATE_MS = 4200

export function FeatureRotator() {
  const slides = buildSlides()
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || slides.length <= 1) return

    const id = window.setInterval(() => {
      setVisible(false)
      window.setTimeout(() => {
        setIndex(i => (i + 1) % slides.length)
        setVisible(true)
      }, 220)
    }, ROTATE_MS)

    return () => window.clearInterval(id)
  }, [slides.length])

  const slide = slides[index]!
  const Icon = slide.icon

  return (
    <p className="hero-kicker hero-feature-rotator" aria-live="polite">
      <span
        className={`hero-feature-rotator-inner${visible ? ' hero-feature-rotator-inner--in' : ''}`}
      >
        <Icon size={14} strokeWidth={1.25} aria-hidden />
        <span>{slide.text}</span>
      </span>
    </p>
  )
}
