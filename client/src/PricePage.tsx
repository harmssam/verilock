import { ExternalLink } from 'lucide-react'
import { SealPricingDisplay } from './SealPricingDisplay'
import './PricePage.css'

const NIMIQ_URL = 'https://www.nimiq.com'

export function PricePage() {
  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        One flat fee seals your document on the Nimiq blockchain. Your PDF stays on your device - only
        its fingerprint is written on-chain.
      </p>
      <SealPricingDisplay showAllCurrencies />

      <section className="price-page-why" aria-labelledby="price-why-nimiq">
        <h3 id="price-why-nimiq" className="price-page-why-title">
          <img
            className="price-page-nimiq-mark"
            src="/nimiq-hexagon.svg"
            alt=""
            width={20}
            height={18}
            decoding="async"
          />
          Why the Nimiq network?
        </h3>
        <p className="muted">
          VeriLock seals documents on{' '}
          <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
            Nimiq
            <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
          </a>
          - a browser-first Layer&nbsp;1 built so people can use the chain from a normal web app, without
          a broker or middle service holding the truth. When you seal, your wallet signs and the
          fingerprint is written directly on the Nimiq network. VeriLock never takes custody of the proof.
        </p>
        <ul className="price-page-why-list muted">
          <li>
            <strong>Direct to the chain</strong> - No attestation broker, escrow, or opaque API sits
            between you and the record. The seal is a normal Nimiq transaction anyone can look up
            independently of VeriLock.
          </li>
          <li>
            <strong>Fast and lightweight</strong> - Nimiq is designed for the web: quick confirmations,
            lightweight clients, and no need for signers to run a full node. Sealing stays practical in
            the browser or Nimiq Pay.
          </li>
          <li>
            <strong>Cheap permanent proof</strong> - Network costs stay low, so a one-time seal fee can
            anchor a document fingerprint without enterprise blockchain pricing.
          </li>
          <li>
            <strong>Your PDF never leaves your device</strong> - Only a SHA-256 fingerprint is written
            on-chain. The file itself stays local.
          </li>
          <li>
            <strong>Self-custodial identity</strong> - Each party signs with their own wallet. VeriLock
            never holds your keys, and the proof outlives our servers.
          </li>
        </ul>
        <p className="muted price-page-why-cta">
          Learn more at{' '}
          <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
            nimiq.com
            <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
          </a>
          .
        </p>
      </section>
    </div>
  )
}
