import { useState } from 'react'
import {
  type FiatCurrency,
  FIAT_CURRENCIES,
  formatFiatAmount,
  nimToFiat,
  readStoredFiatCurrency,
  storeFiatCurrency,
} from './fiatPricing'
import { formatSealFeeNim } from './sealPricing'
import { useNimPrices } from './useNimPrices'
import './SealFeeAmount.css'

interface SealFeeAmountProps {
  feeNim: number
  baseFeeNim?: number
  showWas?: boolean
  showFiatPicker?: boolean
  className?: string
}

export function SealFeeAmount({
  feeNim,
  baseFeeNim,
  showWas = false,
  showFiatPicker = true,
  className,
}: SealFeeAmountProps) {
  const { prices } = useNimPrices()
  const [currency, setCurrency] = useState<FiatCurrency>(readStoredFiatCurrency)

  const fiatAmount = prices ? nimToFiat(feeNim, currency, prices) : null
  const baseFiatAmount =
    showWas && baseFeeNim != null && prices ? nimToFiat(baseFeeNim, currency, prices) : null

  const onCurrencyChange = (next: FiatCurrency) => {
    setCurrency(next)
    storeFiatCurrency(next)
  }

  return (
    <span className={['seal-fee-amount', className].filter(Boolean).join(' ')}>
      <span className="seal-fee-amount-nim">{formatSealFeeNim(feeNim)}</span>
      {showFiatPicker && fiatAmount != null && (
        <span className="seal-fee-amount-fiat">
          <span className="seal-fee-amount-fiat-value">
            ≈ {formatFiatAmount(fiatAmount, currency)} (est.)
          </span>
          <select
            className="seal-fee-amount-currency"
            value={currency}
            onChange={event => onCurrencyChange(event.target.value as FiatCurrency)}
            aria-label="Display currency"
          >
            {FIAT_CURRENCIES.map(code => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </span>
      )}
      {showFiatPicker && showWas && baseFeeNim != null && (
        <span className="seal-fee-amount-was">
          <span className="seal-fee-amount-was-nim">{formatSealFeeNim(baseFeeNim)}</span>
          {baseFiatAmount != null && (
            <span className="seal-fee-amount-was-fiat">
              ≈ {formatFiatAmount(baseFiatAmount, currency)} (est.)
            </span>
          )}
        </span>
      )}
    </span>
  )
}