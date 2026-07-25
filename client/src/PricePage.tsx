import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import {
  Check,
  Coins,
  CreditCard,
  Database,
  ExternalLink,
  LoaderCircle,
  Lock,
  PenLine,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
import { formatFiatAmount } from './fiatPricing'
import { NimiqHexagonIcon } from './NimiqHexagonIcon'
import { SealPricingDisplay } from './SealPricingDisplay'
import { getSealPricing } from './sealPricing'
import { CreditsPanel } from './journey/CreditsPanel'
import {
  journeyLoginNeedsSheet,
  type JourneyConnectMode,
  type JourneyConnectRequest,
} from './journey/journeyConnectUi'
import { LoginSheet } from './journey/LoginSheet'
import './PricePage.css'

const NIMIQ_URL = 'https://www.nimiq.com'

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
  /** Quote fetch settled (success or fail) - avoids infinite "Live USD quote…". */
  quoteReady: boolean
  quoteError: boolean
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
  const [quoteRefreshKey, setQuoteRefreshKey] = useState(0)
  const [buyLoginOpen, setBuyLoginOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // One pack catalog is enough (includes unit USD + pack totals). Avoid a second
        // /quote?credits=1 that used to wait on a cold Fastspot path.
        const [cfg, packCatalog] = await Promise.all([
          api.creditsConfig(),
          api.creditsPackQuotes(),
        ])
        if (cancelled) return
        const packs = cfg.packs?.length
          ? cfg.packs
          : (packCatalog.packs.map(p => p.pack) ?? [10, 25, 50, 100])
        const minPack = packs[0] ?? 10
        const minPackQuote = packCatalog.packs.find(p => p.pack === minPack) ?? null
        // Unit rate from pack row when present; else total/pack (may include Stripe floor).
        let creditStripeUsd: number | null = null
        if (minPackQuote) {
          const row = minPackQuote as {
            creditStripeUsd?: number
            creditStripeUsdTotal: number
          }
          if (row.creditStripeUsd != null && Number.isFinite(row.creditStripeUsd)) {
            creditStripeUsd = row.creditStripeUsd
          } else if (minPack > 0 && Number.isFinite(row.creditStripeUsdTotal)) {
            creditStripeUsd = row.creditStripeUsdTotal / minPack
          }
        }
        const minPackStripeUsd =
          minPackQuote != null && Number.isFinite(minPackQuote.creditStripeUsdTotal)
            ? minPackQuote.creditStripeUsdTotal
            : null
        setCreditsInfo({
          enabled: cfg.enabled,
          stripeEnabled: cfg.stripeEnabled,
          stripeMarkup: packCatalog.stripeMarkup ?? cfg.stripeMarkup,
          stripeMinChargeCents: packCatalog.stripeMinChargeCents ?? cfg.stripeMinChargeCents,
          packs,
          creditStripeUsd,
          minPack,
          minPackStripeUsd,
          quoteReady: true,
          quoteError: creditStripeUsd == null && minPackStripeUsd == null,
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
            quoteReady: true,
            quoteError: true,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [quoteRefreshKey])

  const signedIn = Boolean(token && address)
  const creditsEnabled = creditsInfo?.enabled !== false
  const stripeMinUsd = (creditsInfo?.stripeMinChargeCents ?? 50) / 100
  const minPack = creditsInfo?.minPack ?? 10
  const unitUsd = creditsInfo?.creditStripeUsd ?? null
  const minPackUsd = creditsInfo?.minPackStripeUsd ?? null
  const quoteReady = creditsInfo?.quoteReady === true
  const unitBelowStripeMin = unitUsd != null && unitUsd < stripeMinUsd
  /** Card checkout is pack-based when unit rate is under Stripe's floor. */
  const showPackAsPrimary =
    quoteReady &&
    unitBelowStripeMin &&
    minPackUsd != null &&
    Number.isFinite(minPackUsd)

  useEffect(() => {
    if (signedIn) setBuyLoginOpen(false)
  }, [signedIn])

  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        Multi-party PDF signing is <strong>100% free</strong>. Upgrade when you want a permanent
        proof: <strong>1 credit = 1 fingerprint lock</strong> on{' '}
        <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
          Nimiq
        </a>
        . Optional on-chain backup stores signatures and field data so VeriLock servers are not
        required to recall them later.
      </p>

      <section className="price-page-tiers" aria-labelledby="price-tiers-heading">
        <h3 id="price-tiers-heading" className="price-page-tiers-title">
          What you get
        </h3>
        <div className="price-page-tier-grid">
          <article className="price-page-tier price-page-tier--free">
            <header className="price-page-tier-head">
              <PenLine size={18} strokeWidth={2.25} aria-hidden />
              <div>
                <h4 className="price-page-tier-name">Sign free</h4>
                <p className="price-page-tier-price">$0</p>
              </div>
            </header>
            <ul className="price-page-tier-list">
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Create, invite, and co-sign with wallets
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Print when everyone has signed
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Saved in My agreements (metadata only)
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Document never uploaded
              </li>
            </ul>
            <p className="muted price-page-tier-note">
              Free signing stores the agreement record on VeriLock. It is not a permanent public
              proof until you lock.
            </p>
          </article>
          <article className="price-page-tier price-page-tier--lock">
            <header className="price-page-tier-head">
              <Lock size={18} strokeWidth={2.25} aria-hidden />
              <div>
                <h4 className="price-page-tier-name">Lock on blockchain</h4>
                <p className="price-page-tier-price">1 credit</p>
              </div>
            </header>
            <ul className="price-page-tier-list">
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Everything in Sign free
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Fingerprint anchored on Nimiq forever
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Anyone can re-check the file later
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Proof outlives this app
              </li>
            </ul>
          </article>
          <article className="price-page-tier price-page-tier--data">
            <header className="price-page-tier-head">
              <Database size={18} strokeWidth={2.25} aria-hidden />
              <div>
                <h4 className="price-page-tier-name">On-chain data backup</h4>
                <p className="price-page-tier-price">Typically 5–10 credits</p>
              </div>
            </header>
            <ul className="price-page-tier-list">
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                After fingerprint lock
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Signatures &amp; field data on-chain
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Recall without relying on our servers
              </li>
            </ul>
            <p className="muted price-page-tier-note">
              Cost depends on how many signatures and field entries are on the document. Most
              agreements fall between about 5 and 10 credits; you see the exact amount before you
              confirm.
            </p>
          </article>
        </div>
      </section>

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
              {!quoteReady ? (
                <span
                  className="price-page-model-card-price price-page-model-card-price--pending"
                  role="status"
                >
                  <LoaderCircle
                    className="btn-spinner"
                    size={16}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                  Loading…
                </span>
              ) : showPackAsPrimary ? (
                <span className="price-page-model-card-price">
                  {formatFiatAmount(minPackUsd!, 'USD')}
                  <span className="price-page-model-per">for {minPack} credits</span>
                </span>
              ) : unitUsd != null ? (
                <span className="price-page-model-card-price">
                  {formatFiatAmount(unitUsd, 'USD')}
                  <span className="price-page-model-per">per credit</span>
                </span>
              ) : minPackUsd != null ? (
                <span className="price-page-model-card-price">
                  {formatFiatAmount(minPackUsd, 'USD')}
                  <span className="price-page-model-per">for {minPack} credits</span>
                </span>
              ) : (
                <span className="price-page-model-card-price price-page-model-card-price--pending">
                  Unavailable
                  <button
                    type="button"
                    className="btn btn-ghost price-page-quote-retry"
                    onClick={() => {
                      setCreditsInfo(prev =>
                        prev
                          ? { ...prev, quoteReady: false, quoteError: false }
                          : prev,
                      )
                      setQuoteRefreshKey(k => k + 1)
                    }}
                  >
                    Retry
                  </button>
                </span>
              )}
            </div>
          </div>

          <div className="price-page-model-or" role="separator" aria-label="or">
            <span className="price-page-model-or-text">or</span>
          </div>

          <div className="price-page-model-row">
            <span className="price-page-model-label">
              <NimiqHexagonIcon size={12} />
              NIM
            </span>
            <div className="price-page-model-value price-page-model-value--card">
              <span className="price-page-model-card-price">
                {pricing.feeNim} NIM
                <span className="price-page-model-per">per lock</span>
              </span>
            </div>
            {pricing.promoActive ? (
              <p className="muted price-page-model-hint">
                Limited promo through July
                {pricing.baseFeeNim > pricing.feeNim
                  ? ` (regularly ${pricing.baseFeeNim} NIM)`
                  : ''}
                .
              </p>
            ) : null}
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
                ? `${creditsInfo.packs[0]}-${creditsInfo.packs[creditsInfo.packs.length - 1]}`
                : '10-100'}
              . Wallet only when you purchase.
            </p>
          </div>

          <CreditsPanel
            token={token}
            address={address}
            nimiq={nimiq}
            setNimiq={setNimiq}
            preferCardPrice
            onRequestLogin={
              onConnect
                ? () => {
                    if (!journeyLoginNeedsSheet(connectMode)) {
                      onConnect()
                      return
                    }
                    setBuyLoginOpen(true)
                  }
                : undefined
            }
            onBalanceChange={() => {
              onCreditsPurchased?.()
            }}
          />

          {!signedIn && onConnect && buyLoginOpen && journeyLoginNeedsSheet(connectMode) && (
            <div className="price-page-credits-connect">
              <LoginSheet
                open
                connectMode={connectMode}
                connecting={connecting}
                onClose={() => setBuyLoginOpen(false)}
                onProceed={onConnect}
                placement="inline"
              />
            </div>
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


