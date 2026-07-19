import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { Coins, CreditCard, ExternalLink, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { formatFiatAmount } from './fiatPricing'
import { NimiqHexagonIcon } from './NimiqHexagonIcon'
import { SealFeeAmount } from './SealFeeAmount'
import { SealPricingDisplay } from './SealPricingDisplay'
import { getSealPricing } from './sealPricing'
import { CreditsPanel } from './journey/CreditsPanel'
import {
  journeyLoginEntryLabels,
  journeyLoginNeedsSheet,
  type JourneyConnectMode,
  type JourneyConnectRequest,
} from './journey/journeyConnectUi'
import { LoginSheet } from './journey/LoginSheet'
import './PricePage.css'

const NIMIQ_URL = 'https://www.nimiq.com'
const FASTSPOT_URL = 'https://www.fastspot.io/'

interface CreditsPublicInfo {
  enabled: boolean
  stripeEnabled: boolean
  stripeMarkup: number
  stripeMinChargeCents: number
  packs: number[]
  /** Live Stripe USD for 1 credit (before pack floor), when quote succeeds. */
  creditStripeUsd: number | null
  /** Live pack totals for the smallest pack (Stripe floor may apply). */
  minPack: number | null
  minPackStripeUsd: number | null
}

export interface PricePageProps {
  token?: string | null
  address?: string | null
  nimiq?: NimiqProvider | null
  setNimiq?: (p: NimiqProvider | null) => void
  connecting?: boolean
  connectMode?: JourneyConnectMode
  onConnect?: (options?: JourneyConnectRequest) => void
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
  const pricing = getSealPricing()
  const [creditsInfo, setCreditsInfo] = useState<CreditsPublicInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [cfg, unitQuote, packCatalog] = await Promise.all([
          api.creditsConfig(),
          api.creditsQuote(1).catch(() => null),
          api.creditsPackQuotes().catch(() => null),
        ])
        if (cancelled) return
        const packs = cfg.packs?.length ? cfg.packs : packCatalog?.packs.map(p => p.pack) ?? [10, 25, 50, 100]
        const minPack = packs[0] ?? 10
        const minPackQuote = packCatalog?.packs.find(p => p.pack === minPack) ?? null
        setCreditsInfo({
          enabled: cfg.enabled,
          stripeEnabled: cfg.stripeEnabled,
          stripeMarkup: cfg.stripeMarkup,
          stripeMinChargeCents: cfg.stripeMinChargeCents,
          packs,
          creditStripeUsd: unitQuote?.creditStripeUsd ?? null,
          minPack,
          minPackStripeUsd: minPackQuote?.creditStripeUsdTotal ?? null,
        })
      } catch {
        if (!cancelled) {
          setCreditsInfo({
            enabled: true,
            stripeEnabled: true,
            stripeMarkup: 2,
            stripeMinChargeCents: 50,
            packs: [10, 25, 50, 100],
            creditStripeUsd: null,
            minPack: 10,
            minPackStripeUsd: null,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signedIn = Boolean(token && address)
  const creditsEnabled = creditsInfo?.enabled !== false
  const stripeMarkup = creditsInfo?.stripeMarkup ?? 2
  const halfPrice = stripeMarkup === 2
  const stripeMinUsd = (creditsInfo?.stripeMinChargeCents ?? 50) / 100
  const minPack = creditsInfo?.minPack ?? 10
  const unitBelowStripeMin =
    creditsInfo?.creditStripeUsd != null && creditsInfo.creditStripeUsd < stripeMinUsd

  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        Signing and file checks are free.{' '}
        <strong>1 credit = 1 document verified and locked</strong> on the{' '}
        <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
          Nimiq
        </a>{' '}
        network: a permanent fingerprint anyone can re-check.
        {halfPrice
          ? ' Pay with card, or pay with NIM at 1/2 price.'
          : ' Pay with card or NIM.'}{' '}
        You can also pay the NIM fee when you lock, instead of using a credit.
      </p>

      {creditsEnabled ? (
        <div className="price-page-model" aria-labelledby="price-model-heading">
          <div className="price-page-model-row">
            <span className="price-page-model-label" id="price-model-heading">
              What a credit covers
            </span>
            <div className="price-page-model-primary">
              <span className="price-page-model-credits">1 credit</span>
              <span className="price-page-model-per">= 1 document verified and locked</span>
            </div>
            <p className="muted price-page-model-explain">
              The fingerprint goes on Nimiq and stays checkable forever, even without VeriLock.
            </p>
          </div>

          <div className="price-page-model-row">
            <span className="price-page-model-label">
              <CreditCard size={12} strokeWidth={2.5} aria-hidden />
              Card
            </span>
            <div className="price-page-model-value price-page-model-value--card">
              {creditsInfo?.creditStripeUsd != null ? (
                <span className="price-page-model-card-price">
                  {formatFiatAmount(creditsInfo.creditStripeUsd, 'USD')}
                  <span className="price-page-model-per">per credit</span>
                </span>
              ) : (
                <span className="price-page-model-card-price price-page-model-card-price--pending">
                  Live USD quote…
                </span>
              )}
            </div>
            <p className="muted price-page-model-hint">
              {halfPrice
                ? `Card is ${stripeMarkup}× the live NIM market rate for one document`
                : `Card tracks the live NIM market rate for one document`}
              {stripeMinUsd > 0
                ? ` (Stripe minimum ${formatFiatAmount(stripeMinUsd, 'USD')} per charge)`
                : ''}
              . Quotes from{' '}
              <a href={FASTSPOT_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
                Fastspot
              </a>
              .
            </p>
            {unitBelowStripeMin && (
              <p className="muted price-page-model-hint price-page-model-hint--note">
                {pricing.promoActive ? 'During the sale, ' : ''}
                card checkout starts at a <strong>{minPack}-credit pack</strong>
                {creditsInfo?.minPackStripeUsd != null
                  ? ` (${formatFiatAmount(creditsInfo.minPackStripeUsd, 'USD')})`
                  : ''}{' '}
                so the charge meets Stripe&apos;s {formatFiatAmount(stripeMinUsd, 'USD')} minimum.
              </p>
            )}
          </div>

          <div className="price-page-model-row">
            <span className="price-page-model-label">
              <NimiqHexagonIcon size={12} />
              NIM{halfPrice ? ' · 1/2 price' : ''}
            </span>
            <div className="price-page-model-value">
              <SealFeeAmount
                feeNim={pricing.feeNim}
                baseFeeNim={pricing.baseFeeNim}
                showWas={pricing.promoActive}
                showFiatPicker
              />
              {halfPrice && (
                <span className="price-page-model-half-badge" title="NIM is 1/2 price vs card">
                  1/2 price
                </span>
              )}
            </div>
            {pricing.promoActive && (
              <div className="price-page-model-promo">
                <span className="price-page-model-promo-badge">{pricing.promoLabel}</span>
                {pricing.promoEndsLabel && (
                  <span className="muted price-page-model-promo-note">{pricing.promoEndsLabel}</span>
                )}
              </div>
            )}
            <p className="muted price-page-model-hint">
              {halfPrice
                ? 'NIM is 1/2 price, whether you buy credits or pay the NIM fee when you lock.'
                : 'Pay with NIM when buying credits or when you lock, for the current NIM fee.'}{' '}
              List price: 1000 NIM per document
              {pricing.promoActive ? ` (now ${pricing.feeNim} NIM with promo)` : ''}.
            </p>
          </div>
        </div>
      ) : (
        <SealPricingDisplay showNote={false} />
      )}

      {creditsEnabled && (
        <section className="price-page-credits" id="buy-credits" aria-labelledby="price-credits-heading">
          <div className="price-page-credits-intro">
            <h3 id="price-credits-heading" className="price-page-credits-title">
              <Coins size={18} strokeWidth={2.25} aria-hidden />
              Buy credits
            </h3>
            <p className="muted price-page-credits-lead">
              Prepaid packs (
              {creditsInfo?.packs && creditsInfo.packs.length >= 2
                ? `${creditsInfo.packs[0]}–${creditsInfo.packs[creditsInfo.packs.length - 1]}`
                : '10–100'}
              ). Card or NIM
              {halfPrice ? '; NIM is 1/2 price' : ''}
              {unitBelowStripeMin
                ? `. Card packs start at ${minPack} to meet the ${formatFiatAmount(stripeMinUsd, 'USD')} minimum`
                : ''}
              .
            </p>
          </div>

          {!signedIn && onConnect && (
            <PriceCreditsLogin
              connectMode={connectMode}
              connecting={connecting}
              onConnect={onConnect}
              halfPrice={halfPrice}
            />
          )}

          {signedIn && (
            <CreditsPanel
              token={token}
              address={address}
              nimiq={nimiq}
              setNimiq={setNimiq}
              preferCardPrice
              onBalanceChange={() => {
                onCreditsPurchased?.()
              }}
            />
          )}
        </section>
      )}

      <section className="price-page-why" aria-labelledby="price-why-nimiq">
        <header className="price-page-why-head">
          <span className="price-page-why-badge" aria-hidden>
            <NimiqHexagonIcon size={18} className="price-page-nimiq-mark" />
          </span>
          <div className="price-page-why-head-copy">
            <h3 id="price-why-nimiq" className="price-page-why-title">
              Why the Nimiq network?
            </h3>
            <p className="price-page-why-lead muted">
              Document locks land on{' '}
              <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
                Nimiq
                <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
              </a>
              , a browser-first Layer&nbsp;1. Your wallet signs; the fingerprint goes on the network.
              We never hold the proof.
            </p>
          </div>
        </header>
        <ul className="price-page-why-list">
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Direct to the chain</strong>
            <span className="price-page-why-item-body muted">
              No broker, escrow, or opaque API between you and the record. The lock is a normal Nimiq
              transaction anyone can look up without VeriLock.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Fast and light</strong>
            <span className="price-page-why-item-body muted">
              Quick confirmations, light clients, no full node for signers. Locking a document stays
              practical in the browser or Nimiq Pay.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">1/2 price in NIM</strong>
            <span className="price-page-why-item-body muted">
              Same lock either way. Pay with card for convenience, or pay with NIM at 1/2 price when
              you buy packs or lock a document. Network fees stay low, so we pass that through.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Document stays on your device</strong>
            <span className="price-page-why-item-body muted">
              Only a short integrity fingerprint goes on-chain. The file itself never uploads.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Self-custodial identity</strong>
            <span className="price-page-why-item-body muted">
              Each party signs with their own wallet. We never hold your keys, and the proof outlives
              our servers.
            </span>
          </li>
        </ul>
        <p className="muted price-page-why-cta">
          Learn more at{' '}
          <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
            nimiq.com
            <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
          </a>
        </p>
      </section>
    </div>
  )
}

function PriceCreditsLogin({
  connectMode,
  connecting,
  onConnect,
  halfPrice = true,
}: {
  connectMode: JourneyConnectMode
  connecting: boolean
  onConnect: (options?: JourneyConnectRequest) => void
  halfPrice?: boolean
}) {
  const [loginOpen, setLoginOpen] = useState(false)
  const entry = journeyLoginEntryLabels()
  const needsSheet = journeyLoginNeedsSheet(connectMode)

  return (
    <div className="price-page-credits-connect">
      {!needsSheet || !loginOpen ? (
        <>
          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            Log in with your Nimiq wallet to buy packs. Card or NIM
            {halfPrice ? ' (1/2 price)' : ''}.
          </p>
          <button
            type="button"
            data-login-trigger
            className={`btn btn-primary${connecting ? ' btn--busy' : ''}`}
            disabled={connecting}
            onClick={() => {
              if (!needsSheet) {
                onConnect()
                return
              }
              setLoginOpen(true)
            }}
          >
            {connecting ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                {entry.busy}
              </>
            ) : (
              <>
                <NimiqHexagonIcon size={16} />
                {entry.idle}
              </>
            )}
          </button>
        </>
      ) : (
        <LoginSheet
          open
          connectMode={connectMode}
          connecting={connecting}
          onClose={() => setLoginOpen(false)}
          onProceed={onConnect}
          placement="inline"
        />
      )}
    </div>
  )
}
