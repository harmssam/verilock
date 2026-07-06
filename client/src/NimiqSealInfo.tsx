import { Coins, Shield, Wallet } from 'lucide-react'
import { formatSealFeeNim, getSealPricing } from './sealPricing'
import './NimiqSealInfo.css'

export function NimiqSealInfo() {
  const pricing = getSealPricing()

  return (
    <div className="card nimiq-info-card">
      <h2 className="nimiq-info-title">
        <Shield className="nimiq-info-title-icon" size={18} strokeWidth={2.25} aria-hidden />
        Sealing with Nimiq
      </h2>
      <p className="muted nimiq-info-lead">
        VeriLock uses the Nimiq blockchain to permanently record your document&apos;s fingerprint. Your
        PDF never leaves your computer — only a SHA-256 hash is written on-chain.
      </p>

      <div className="nimiq-info-grid">
        <section className="nimiq-info-section">
          <h3>How it works</h3>
          <ol className="nimiq-info-steps">
            <li>Fingerprint your PDF locally in the browser.</li>
            <li>Each party signs with their Nimiq wallet to prove identity.</li>
            <li>
              When all signatures are in, approve one Nimiq transaction that embeds the document hash in
              the transaction data.
            </li>
            <li>Anyone can verify later by fingerprinting their copy of the PDF — no wallet needed.</li>
          </ol>
        </section>

        <section className="nimiq-info-section">
          <h3>
            <Wallet className="nimiq-info-section-icon" size={15} strokeWidth={2.25} aria-hidden />
            Requirements
          </h3>
          <ul className="nimiq-info-list">
            <li>
              <strong>Nimiq wallet</strong> — Nimiq Pay on mobile, or Nimiq Hub on desktop.
            </li>
            <li>
              <strong>NIM balance</strong> — seal fee below plus a small network fee (~0.01 NIM).
            </li>
            <li>
              <strong>PDF on your device</strong> — the same file every signer uses.
            </li>
            <li>
              <strong>All required signatures</strong> — sealing starts once everyone has signed.
            </li>
          </ul>
        </section>
      </div>

      <div className="nimiq-info-pricing">
        <div className="nimiq-info-pricing-head">
          <Coins className="nimiq-info-pricing-icon" size={18} strokeWidth={2.25} aria-hidden />
          <div>
            <span className="nimiq-info-pricing-label">Seal fee</span>
            <div className="nimiq-info-pricing-amounts">
              <span className="nimiq-info-pricing-current">{formatSealFeeNim(pricing.feeNim)}</span>
              {pricing.promoActive && (
                <span className="nimiq-info-pricing-was">{formatSealFeeNim(pricing.baseFeeNim)}</span>
              )}
              <span className="nimiq-info-pricing-per">per document</span>
            </div>
          </div>
        </div>
        {pricing.promoActive && (
          <div className="nimiq-info-promo">
            <span className="nimiq-info-promo-badge">{pricing.promoLabel}</span>
            <span className="muted nimiq-info-promo-note">{pricing.promoEndsLabel}</span>
          </div>
        )}
        <p className="muted nimiq-info-pricing-note">
          Signing and verifying are free. You only pay when the agreement is sealed on-chain.
        </p>
      </div>
    </div>
  )
}