import { SealPricingDisplay } from './SealPricingDisplay'
import './PricePage.css'

export function PricePage() {
  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        One flat fee seals your document on the Nimiq blockchain. Your PDF stays on your device — only
        its fingerprint is written on-chain.
      </p>
      <SealPricingDisplay showAllCurrencies />
    </div>
  )
}