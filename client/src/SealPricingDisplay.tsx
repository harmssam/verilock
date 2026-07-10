import { Coins } from 'lucide-react'
import { SealFeeAmount } from './SealFeeAmount'
import { getSealPricing } from './sealPricing'
import { useNimPrices } from './useNimPrices'
import './SealPricingDisplay.css'

const FASTSPOT_URL = 'https://www.fastspot.io/'

interface SealPricingDisplayProps {
  className?: string
  /**
   * @deprecated Multi-currency list removed for a simpler single estimate + picker.
   * Kept so older call sites still type-check.
   */
  showAllCurrencies?: boolean
  /**
   * Free-vs-paid note under the fee. Hide on pages that already explain
   * pricing in surrounding copy (e.g. PricePage lead).
   */
  showNote?: boolean
}

function FastspotRateSource() {
  return (
    <p className="muted seal-pricing-fiat-source">
      Exchange rates are estimates from{' '}
      <a
        className="seal-pricing-fastspot-link"
        href={FASTSPOT_URL}
        target="_blank"
        rel="noreferrer"
      >
        Fastspot
      </a>
      .
    </p>
  )
}

export function SealPricingDisplay({ className, showNote = true }: SealPricingDisplayProps) {
  const pricing = getSealPricing()
  const { prices } = useNimPrices()

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
              showFiatPicker
            />
            <span className="seal-pricing-display-per">per document</span>
          </div>
          {prices && <FastspotRateSource />}
        </div>
      </div>
      {pricing.promoActive && (
        <div className="seal-pricing-display-promo">
          <span className="seal-pricing-display-promo-badge">{pricing.promoLabel}</span>
          <span className="muted seal-pricing-display-promo-note">{pricing.promoEndsLabel}</span>
        </div>
      )}
      {showNote && (
        <p className="muted seal-pricing-display-note">
          Signing and verifying are free. You only pay the seal fee when the agreement is locked
          on-chain.
        </p>
      )}
    </div>
  )
}