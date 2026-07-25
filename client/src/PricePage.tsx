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
import {
  consumePricingBuyResume,
  shouldRestoreBuyCreditsScroll,
  scrollToBuyCredits,
} from './pricingBuyResume'
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

  // After wallet login (or refresh with ?pack= / #buy-credits), land on buy section.
  useEffect(() => {
    if (!shouldRestoreBuyCreditsScroll()) return
    let cancelled = false
    const run = () => {
      if (cancelled) return
      scrollToBuyCredits(signedIn ? 'smooth' : 'auto')
      // Clear session resume once signed in so later visits don't re-jump.
      if (signedIn) consumePricingBuyResume()
    }
    // Wait for pack chips / quotes to paint so scroll target has height.
    const t0 = window.setTimeout(run, 80)
    const t1 = window.setTimeout(run, 400)
    return () => {
      cancelled = true
      window.clearTimeout(t0)
      window.clearTimeout(t1)
    }
  }, [signedIn, quoteReady])

  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        Multi-party PDF signing is <strong>100% free</strong>. Upgrade when you want a permanent
        proof: <strong>1 credit = 1 fingerprint lock</strong> on{' '}
        <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
          Nimiq
        </a>
        . Optional on-chain backup stores signatures and field data publicly on Nimiq so
        anyone with the document hash can reconstruct the full signed agreement—not only
        through VeriLock.
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
                Signatures, initials &amp; field text on-chain
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Full signed contract reconstructible from the document hash alone
              </li>
              <li>
                <Check size={14} strokeWidth={2.5} aria-hidden />
                Anyone with the hash can recover it on Nimiq—no VeriLock required
              </li>
            </ul>
            <p className="muted price-page-tier-note">
              With only the document&apos;s fingerprint (hash), you can rebuild the agreement&apos;s
              signatures and field details from Nimiq. Cost depends on how many signatures and
              field entries are stored. Most agreements fall between about 5 and 10 credits; you
              see the exact amount before you confirm.
            </p>
          </article>
        </div>
      </section>

      {creditsEnabled ? (
        <section
          className="price-page-pay"
          id="buy-credits"
          aria-labelledby="price-pay-heading"
        >
          <header className="price-page-pay-intro">
            <h3 id="price-pay-heading" className="price-page-pay-title">
              <Coins size={18} strokeWidth={2.25} aria-hidden />
              Buy credits
            </h3>
            <p className="muted price-page-pay-lead">
              1 credit = 1 fingerprint lock. Pay with card or{' '}
              <a href="#price-why-nimiq" className="price-page-nimiq-link price-page-nim-jump">
                NIM
              </a>
              . Packs of{' '}
              {creditsInfo?.packs && creditsInfo.packs.length >= 2
                ? `${creditsInfo.packs[0]}-${creditsInfo.packs[creditsInfo.packs.length - 1]}`
                : '10-100'}
              .
            </p>
          </header>

          {/* Rates strip: card floor vs NIM per lock, then pack picker below */}
          <div className="price-page-pay-rates" aria-label="How to pay">
            <div className="price-page-model-options">
              <div className="price-page-model-row price-page-model-row--card">
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

              <div className="price-page-model-row price-page-model-row--nim">
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
          </div>

          <div className="price-page-pay-buy">
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
          </div>

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
      ) : (
        <SealPricingDisplay showNote={false} />
      )}

      <section className="price-page-why" aria-labelledby="price-why-nimiq">
        <header className="price-page-why-head">
          <NimiqHexagonIcon size={48} className="price-page-nimiq-mark" aria-hidden />
          <div className="price-page-why-head-copy">
            <h3 id="price-why-nimiq" className="price-page-why-title">
              Why Nimiq?
            </h3>
            <p className="price-page-why-lead muted">
              Nimiq is a public blockchain - a shared digital ledger anyone can check.
              Browser-first Layer&nbsp;1
              <a href="#price-why-footnote-l1" className="price-page-why-fn-ref" aria-describedby="price-why-footnote-l1">
                <sup>1</sup>
                <span className="visually-hidden"> (explained below)</span>
              </a>
              . When you lock, the proof is recorded on that ledger, not only on our servers.{' '}
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
        <footer className="price-page-why-footnotes">
          <p id="price-why-footnote-l1" className="price-page-why-footnote muted">
            <span className="price-page-why-fn-mark" aria-hidden>
              1
            </span>
            <span>
              A <strong>blockchain</strong> is a public record of transactions that many computers
              keep in sync - hard to rewrite after the fact.{' '}
              <strong>Layer&nbsp;1</strong> means Nimiq is that chain itself (not a service built on
              top of another one). <strong>Browser-first</strong> means you can use it from a normal
              web browser and wallet without installing heavy software. VeriLock uses it to record
              and check your lock online.
            </span>
          </p>
        </footer>
      </section>
    </div>
  )
}


