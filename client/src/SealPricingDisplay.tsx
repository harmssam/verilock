import { Coins } from 'lucide-react'
import {
  FIAT_CURRENCIES,
  formatFiatAmount,
  nimToFiat,
  type FiatCurrency,
} from './fiatPricing'
import { SealFeeAmount } from './SealFeeAmount'
import { getSealPricing } from './sealPricing'
import { useNimPrices } from './useNimPrices'
import './SealPricingDisplay.css'

interface SealPricingDisplayProps {
  className?: string
  showAllCurrencies?: boolean
}

export function SealPricingDisplay({ className, showAllCurrencies = false }: SealPricingDisplayProps) {
  const pricing = getSealPricing()
  const { prices, loading, error } = useNimPrices()

  return (
    <div
      className={[
        'seal-pricing-display',
        showAllCurrencies ? 'seal-pricing-display--full' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="seal-pricing-display-head">
        <Coins className="seal-pricing-display-icon" size={18} strokeWidth={2.25} aria-hidden />
        <div>
          <span className="seal-pricing-display-label">Seal fee</span>
          <div className="seal-pricing-display-amounts">
            <SealFeeAmount
              feeNim={pricing.feeNim}
              baseFeeNim={pricing.baseFeeNim}
              showWas={pricing.promoActive && !showAllCurrencies}
              showFiatPicker={!showAllCurrencies}
            />
            <span className="seal-pricing-display-per">per document</span>
          </div>
          {showAllCurrencies && (
            <div className="seal-pricing-fiat-panel" aria-live="polite">
              {loading && <p className="muted seal-pricing-fiat-status">Loading exchange rates…</p>}
              {error && !loading && (
                <p className="muted seal-pricing-fiat-status">
                  Fiat estimates unavailable ({error}).
                </p>
              )}
              {prices && (
                <ul className="seal-pricing-fiat-list">
                  {FIAT_CURRENCIES.map((currency: FiatCurrency) => (
                    <li key={currency} className="seal-pricing-fiat-row">
                      <span className="seal-pricing-fiat-code">{currency}</span>
                      <span className="seal-pricing-fiat-value">
                        ≈ {formatFiatAmount(nimToFiat(pricing.feeNim, currency, prices), currency)}
                      </span>
                    </li>
                  ))}
                  {pricing.promoActive && (
                    <li className="seal-pricing-fiat-row seal-pricing-fiat-row--was">
                      <span className="seal-pricing-fiat-code">Was</span>
                      <span className="seal-pricing-fiat-was">
                        {FIAT_CURRENCIES.map((currency: FiatCurrency, index) => (
                          <span key={currency}>
                            {index > 0 ? ' · ' : ''}
                            {formatFiatAmount(
                              nimToFiat(pricing.baseFeeNim, currency, prices),
                              currency,
                            )}
                          </span>
                        ))}
                      </span>
                    </li>
                  )}
                </ul>
              )}
              {prices && (
                <p className="muted seal-pricing-fiat-source">Exchange rates are estimates from Fastspot.</p>
              )}
            </div>
          )}
        </div>
      </div>
      {pricing.promoActive && (
        <div className="seal-pricing-display-promo">
          <span className="seal-pricing-display-promo-badge">{pricing.promoLabel}</span>
          <span className="muted seal-pricing-display-promo-note">{pricing.promoEndsLabel}</span>
        </div>
      )}
      <p className="muted seal-pricing-display-note">
        Signing and verifying are free. You only pay the seal fee when the agreement is locked on-chain.
      </p>
    </div>
  )
}