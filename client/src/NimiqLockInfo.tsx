import { ChevronDown, Shield, Wallet } from 'lucide-react'
import { SealPricingDisplay } from './SealPricingDisplay'
import { TextLink } from './TextLink'
import './NimiqLockInfo.css'

interface NimiqLockInfoProps {
  onOpenPricing?: () => void
}

export function NimiqLockInfo({ onOpenPricing }: NimiqLockInfoProps) {
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

      <details className="nimiq-info-details">
        <summary className="nimiq-info-summary">
          How it works
          <ChevronDown className="nimiq-info-summary-icon" size={15} strokeWidth={2.5} aria-hidden />
        </summary>

        <div className="nimiq-info-details-body">
          <div className="nimiq-info-grid">
            <section className="nimiq-info-section">
              <ol className="nimiq-info-steps">
                <li>Fingerprint your PDF locally in the browser.</li>
                <li>Each party signs with their Nimiq wallet to prove identity.</li>
                <li>
                  When all signatures are in, approve one Nimiq transaction that embeds the document hash
                  in the transaction data.
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
                  <strong>NIM balance</strong> — for the seal fee below.
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

          <SealPricingDisplay />
          {onOpenPricing && (
            <p className="muted nimiq-info-pricing-link">
              <TextLink onClick={onOpenPricing}>Full pricing page</TextLink>
            </p>
          )}
        </div>
      </details>
    </div>
  )
}