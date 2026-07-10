import { Coins, CreditCard, ExternalLink, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { SealPricingDisplay } from './SealPricingDisplay'
import { formatSealFeeNim, getSealPricing } from './sealPricing'
import './PricePage.css'

const NIMIQ_URL = 'https://www.nimiq.com'

interface CreditsPublicInfo {
  enabled: boolean
  stripeEnabled: boolean
  stripeMarkup: number
  feeNim: number
  creditNimCost: number
  creditStripeUsd: number | null
  promoActive: boolean
}

export function PricePage() {
  const basePricing = getSealPricing()
  const [creditsInfo, setCreditsInfo] = useState<CreditsPublicInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [cfg, quote] = await Promise.all([
          api.creditsConfig(),
          api.creditsQuote(1).catch(() => null),
        ])
        if (cancelled) return
        setCreditsInfo({
          enabled: cfg.enabled,
          stripeEnabled: cfg.stripeEnabled && Boolean(quote?.stripeEnabled),
          stripeMarkup: cfg.stripeMarkup,
          feeNim: quote?.feeNim ?? basePricing.feeNim,
          creditNimCost: quote?.creditNimCost ?? basePricing.feeNim,
          creditStripeUsd: quote?.creditStripeUsd ?? null,
          promoActive: quote?.promoActive ?? basePricing.promoActive,
        })
      } catch {
        if (!cancelled) {
          setCreditsInfo({
            enabled: true,
            stripeEnabled: false,
            stripeMarkup: 2,
            feeNim: basePricing.feeNim,
            creditNimCost: basePricing.feeNim,
            creditStripeUsd: null,
            promoActive: basePricing.promoActive,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [basePricing.feeNim, basePricing.promoActive])

  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        One flat fee seals your document on the Nimiq blockchain. Your PDF stays on your device - only
        its fingerprint is written on-chain. You can pay with NIM at seal time, or buy prepaid{' '}
        <strong>seal credits</strong> (including with a card).
      </p>
      <SealPricingDisplay showAllCurrencies />

      {creditsInfo?.enabled !== false && (
        <section className="price-page-credits" aria-labelledby="price-credits-heading">
          <h3 id="price-credits-heading" className="price-page-credits-title">
            <Coins size={18} strokeWidth={2.25} aria-hidden />
            Seal credits
          </h3>
          <p className="muted price-page-credits-lead">
            <strong>1 credit = 1 seal</strong>, anytime — including after the July promo ends. Credits
            never convert back to NIM or cash.
          </p>
          <ul className="price-page-credits-list">
            <li>
              <Wallet size={16} strokeWidth={2.25} aria-hidden />
              <div>
                <strong>Buy with NIM</strong>
                <span className="muted">
                  {formatSealFeeNim(creditsInfo?.creditNimCost ?? basePricing.feeNim)} NIM per credit
                  (same as the current seal fee
                  {creditsInfo?.promoActive ? ' — promo rate' : ''}). Best rate.
                </span>
              </div>
            </li>
            <li>
              <CreditCard size={16} strokeWidth={2.25} aria-hidden />
              <div>
                <strong>Buy with card</strong>
                <span className="muted">
                  {creditsInfo?.stripeEnabled && creditsInfo.creditStripeUsd != null
                    ? `About $${creditsInfo.creditStripeUsd.toFixed(2)} USD per credit (${creditsInfo.stripeMarkup}× live NIM market).`
                    : `${creditsInfo?.stripeMarkup ?? 2}× live NIM market in USD — convenience premium so NIM stays cheaper.`}{' '}
                  No NIM required to purchase; sealing with a credit uses VeriLock’s on-chain proof
                  wallet.
                </span>
              </div>
            </li>
          </ul>
          <p className="muted price-page-credits-how">
            <strong>Where to buy:</strong> connect your Nimiq wallet, open an agreement, and go to the{' '}
            <em>Seal</em> step. The credits panel appears there after you sign in — balance, Buy with
            NIM, and Buy with card.
          </p>
        </section>
      )}

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
