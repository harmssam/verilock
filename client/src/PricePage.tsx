import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { Coins, CreditCard, ExternalLink, ShoppingCart, Wallet } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { SealPricingDisplay } from './SealPricingDisplay'
import { formatSealFeeNim, getSealPricing } from './sealPricing'
import { CreditsPanel } from './experiment/CreditsPanel'
import {
  journeyConnectLabels,
  type JourneyConnectMode,
} from './experiment/journeyConnectUi'
import './PricePage.css'

const NIMIQ_URL = 'https://www.nimiq.com'

interface PackRow {
  pack: number
  nimTotal: number
  usdTotal: number | null
  cardOk: boolean
}

interface CreditsPublicInfo {
  enabled: boolean
  stripeEnabled: boolean
  stripeMarkup: number
  feeNim: number
  creditNimCost: number
  promoActive: boolean
  stripeMinChargeCents: number
  packs: PackRow[]
}

export interface PricePageProps {
  token?: string | null
  address?: string | null
  nimiq?: NimiqProvider | null
  setNimiq?: (p: NimiqProvider | null) => void
  connecting?: boolean
  connectMode?: JourneyConnectMode
  onConnect?: () => void
  onCreditsPurchased?: () => void
}

export function PricePage({
  token = null,
  address = null,
  nimiq = null,
  setNimiq,
  connecting = false,
  connectMode = 'hub',
  onConnect,
  onCreditsPurchased,
}: PricePageProps = {}) {
  const basePricing = getSealPricing()
  const [creditsInfo, setCreditsInfo] = useState<CreditsPublicInfo | null>(null)
  const [creditsRefresh, setCreditsRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [cfg, catalog] = await Promise.all([
          api.creditsConfig(),
          api.creditsPackQuotes().catch(() => null),
        ])
        if (cancelled) return
        const packs: PackRow[] =
          catalog?.packs.map(p => ({
            pack: p.pack,
            nimTotal: p.creditNimCostTotal,
            usdTotal: p.creditStripeUsdTotal,
            cardOk: p.meetsStripeMinimum,
          })) ??
          (cfg.packs ?? [10, 25, 50, 100]).map(pack => ({
            pack,
            nimTotal: basePricing.feeNim * pack,
            usdTotal: null,
            cardOk: true,
          }))
        setCreditsInfo({
          enabled: cfg.enabled,
          stripeEnabled: cfg.stripeEnabled,
          stripeMarkup: cfg.stripeMarkup,
          feeNim: catalog?.feeNim ?? basePricing.feeNim,
          creditNimCost: catalog?.feeNim ?? basePricing.feeNim,
          promoActive: catalog?.promoActive ?? basePricing.promoActive,
          stripeMinChargeCents: catalog?.stripeMinChargeCents ?? cfg.stripeMinChargeCents ?? 50,
          packs,
        })
      } catch {
        if (!cancelled) {
          setCreditsInfo({
            enabled: true,
            stripeEnabled: false,
            stripeMarkup: 2,
            feeNim: basePricing.feeNim,
            creditNimCost: basePricing.feeNim,
            promoActive: basePricing.promoActive,
            stripeMinChargeCents: 50,
            packs: [10, 25, 50, 100].map(pack => ({
              pack,
              nimTotal: basePricing.feeNim * pack,
              usdTotal: null,
              cardOk: true,
            })),
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [basePricing.feeNim, basePricing.promoActive])

  const signedIn = Boolean(token && address)

  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        One flat fee seals your document on the Nimiq blockchain. Your PDF stays on your device - only
        its fingerprint is written on-chain. You can pay with NIM at seal time, or buy prepaid{' '}
        <strong>seal credits</strong> (including with a card).
      </p>
      <SealPricingDisplay />

      {creditsInfo?.enabled !== false && (
        <section className="price-page-credits" aria-labelledby="price-credits-heading">
          <h3 id="price-credits-heading" className="price-page-credits-title">
            <Coins size={18} strokeWidth={2.25} aria-hidden />
            Seal credits
          </h3>
          <p className="muted price-page-credits-lead">
            <strong>1 credit = 1 seal</strong>, anytime — including after the July promo ends. Buy fixed
            packs; card price is computed live at checkout ({creditsInfo?.stripeMarkup ?? 2}× NIM market)
            so we never need to maintain stale Stripe catalog prices. Credits never convert back to NIM.
          </p>
          <ul className="price-page-credits-list">
            <li>
              <Wallet size={16} strokeWidth={2.25} aria-hidden />
              <div>
                <strong>Buy with NIM</strong>
                <span className="muted">
                  {formatSealFeeNim(creditsInfo?.creditNimCost ?? basePricing.feeNim)} NIM per credit
                  (current seal fee{creditsInfo?.promoActive ? ' — promo rate' : ''}). Best rate.
                </span>
              </div>
            </li>
            <li>
              <CreditCard size={16} strokeWidth={2.25} aria-hidden />
              <div>
                <strong>Buy with card</strong>
                <span className="muted">
                  Same packs at {creditsInfo?.stripeMarkup ?? 2}× live NIM USD. Stripe requires at least $
                  {((creditsInfo?.stripeMinChargeCents ?? 50) / 100).toFixed(2)} per charge — small packs
                  may be NIM-only while promo pricing is low.
                </span>
              </div>
            </li>
          </ul>
          {creditsInfo?.packs && creditsInfo.packs.length > 0 && (
            <div className="price-page-packs" aria-label="Credit pack prices">
              <table className="price-page-packs-table">
                <thead>
                  <tr>
                    <th scope="col">Pack</th>
                    <th scope="col">NIM</th>
                    <th scope="col">Card (est.)</th>
                  </tr>
                </thead>
                <tbody>
                  {creditsInfo.packs.map(row => (
                    <tr key={row.pack}>
                      <td>
                        <strong>{row.pack}</strong> credits
                      </td>
                      <td>{formatSealFeeNim(row.nimTotal)}</td>
                      <td>
                        {row.usdTotal != null
                          ? row.cardOk
                            ? `≈ $${row.usdTotal.toFixed(2)}`
                            : `Under $${((creditsInfo.stripeMinChargeCents ?? 50) / 100).toFixed(2)} min`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted" style={{ margin: '0.5rem 0 0', fontSize: '0.78rem' }}>
                Estimates update with NIM markets; the amount you pay is locked when Checkout opens.
              </p>
            </div>
          )}

          <div className="price-page-credits-cta" id="buy-credits">
            <div className="price-page-credits-cta-head">
              <ShoppingCart size={18} strokeWidth={2.25} aria-hidden />
              <div>
                <strong>Buy credits now</strong>
                <p className="muted" style={{ margin: '0.15rem 0 0', fontSize: '0.84rem' }}>
                  {signedIn
                    ? 'Pick a pack below — pay with NIM or card. Your balance updates in the header.'
                    : 'Connect your Nimiq wallet to purchase a credit pack.'}
                </p>
              </div>
            </div>

            {!signedIn && onConnect && (
              <button
                type="button"
                className={`btn btn-primary btn-lg${connecting ? ' btn--busy' : ''}`}
                disabled={connecting}
                onClick={onConnect}
              >
                <Wallet size={18} strokeWidth={2.25} />
                {connecting
                  ? journeyConnectLabels(connectMode).busy
                  : journeyConnectLabels(connectMode).idle}
              </button>
            )}

            {signedIn && (
              <CreditsPanel
                token={token}
                address={address}
                nimiq={nimiq}
                setNimiq={setNimiq}
                refreshKey={creditsRefresh}
                onBalanceChange={() => {
                  setCreditsRefresh(k => k + 1)
                  onCreditsPurchased?.()
                }}
              />
            )}
          </div>
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
