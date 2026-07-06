import { Coins } from 'lucide-react'
import { SealFeeAmount } from './SealFeeAmount'
import { getSealPricing } from './sealPricing'
import './SealPricingDisplay.css'

interface SealPricingDisplayProps {
  className?: string
}

export function SealPricingDisplay({ className }: SealPricingDisplayProps) {
  const pricing = getSealPricing()

  return (
    <div className={['seal-pricing-display', className].filter(Boolean).join(' ')}>
      <div className="seal-pricing-display-head">
        <Coins className="seal-pricing-display-icon" size={18} strokeWidth={2.25} aria-hidden />
        <div>
          <span className="seal-pricing-display-label">Seal fee</span>
          <div className="seal-pricing-display-amounts">
            <SealFeeAmount
              feeNim={pricing.feeNim}
              baseFeeNim={pricing.baseFeeNim}
              showWas={pricing.promoActive}
            />
            <span className="seal-pricing-display-per">per document</span>
          </div>
        </div>
      </div>
      {pricing.promoActive && (
        <div className="seal-pricing-display-promo">
          <span className="seal-pricing-display-promo-badge">{pricing.promoLabel}</span>
          <span className="muted seal-pricing-display-promo-note">{pricing.promoEndsLabel}</span>
        </div>
      )}
      <p className="muted seal-pricing-display-note">
        Signing and verifying are free. You only pay when the agreement is sealed on-chain.
      </p>
    </div>
  )
}