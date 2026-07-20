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
        <strong>1 credit = 1 document verified and locked</strong> on{' '}
        <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
          Nimiq
        </a>
        . Permanent fingerprint; re-checkable without VeriLock.
      </p>

      {creditsEnabled ? (
        <div className="price-page-model" aria-labelledby="price-model-heading">
          <div className="price-page-model-row">
            <span className="price-page-model-label" id="price-model-heading">
              How to pay
            </span>
            <p className="muted price-page-model-explain">
              Credit card or NIM. Same credit either way.
            </p>
          </div>

          <div className="price-page-model-row">
            <span className="price-page-model-label">
              <CreditCard size={12} strokeWidth={2.5} aria-hidden />
              Credit card
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
              {halfPrice ? `${stripeMarkup}× live NIM rate` : 'Live NIM rate'} via{' '}
              <a href={FASTSPOT_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
                Fastspot
              </a>
              .
              {unitBelowStripeMin && (
                <>
                  {' '}
                  Min charge {formatFiatAmount(stripeMinUsd, 'USD')}
                  {creditsInfo?.minPackStripeUsd != null
                    ? `: ${minPack}-credit pack (${formatFiatAmount(creditsInfo.minPackStripeUsd, 'USD')})`
                    : ` from a ${minPack}-credit pack`}
                  .
                </>
              )}
            </p>
          </div>

          <div className="price-page-model-or" role="separator" aria-label="or">
            <span className="price-page-model-or-text">or</span>
          </div>

          <div className="price-page-model-row">
            <span className="price-page-model-label">
              <NimiqHexagonIcon size={12} />
              NIM
            </span>
            <div className="price-page-model-value">
              <SealFeeAmount
                feeNim={pricing.feeNim}
                baseFeeNim={pricing.baseFeeNim}
                showWas={pricing.promoActive}
                showFiatPicker
              />
              {halfPrice && (
                <span className="price-page-model-half-badge" title="NIM is 1/2 price vs credit card">
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
            {!pricing.promoActive && (
              <p className="muted price-page-model-hint">
                {pricing.feeNim} NIM per document.
              </p>
            )}
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
              Packs of{' '}
              {creditsInfo?.packs && creditsInfo.packs.length >= 2
                ? `${creditsInfo.packs[0]}–${creditsInfo.packs[creditsInfo.packs.length - 1]}`
                : '10–100'}
              .
            </p>
          </div>

          {!signedIn && onConnect && (
            <PriceCreditsLogin
              connectMode={connectMode}
              connecting={connecting}
              onConnect={onConnect}
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
              Why Nimiq?
            </h3>
            <p className="price-page-why-lead muted">
              Browser-first Layer&nbsp;1. The record lives on the chain, not our servers.{' '}
              <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
                nimiq.com
                <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
              </a>
            </p>
          </div>
        </header>
        <ul className="price-page-why-list">
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Look it up yourself</strong>
            <span className="price-page-why-item-body muted">
              A normal Nimiq transaction. No broker or escrow between you and the record.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Built for the browser</strong>
            <span className="price-page-why-item-body muted">
              Fast confirms, light clients. No full node to lock a document.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">File never leaves your device</strong>
            <span className="price-page-why-item-body muted">
              Only a short integrity fingerprint goes on-chain.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Proof outlives VeriLock</strong>
            <span className="price-page-why-item-body muted">
              Once on Nimiq, the fingerprint stays checkable even if our app is gone.
            </span>
          </li>
        </ul>
      </section>
    </div>
  )
}

function PriceCreditsLogin({
  connectMode,
  connecting,
  onConnect,
}: {
  connectMode: JourneyConnectMode
  connecting: boolean
  onConnect: (options?: JourneyConnectRequest) => void
}) {
  const [loginOpen, setLoginOpen] = useState(false)
  const entry = journeyLoginEntryLabels()
  const needsSheet = journeyLoginNeedsSheet(connectMode)

  return (
    <div className="price-page-credits-connect">
      {!needsSheet || !loginOpen ? (
        <>
          <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>
            Log in with your Nimiq wallet to buy packs.
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
