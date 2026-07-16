import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { Coins, ExternalLink, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from './api'
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
  stripeMarkup: number
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
        const cfg = await api.creditsConfig()
        if (cancelled) return
        setCreditsInfo({
          enabled: cfg.enabled,
          stripeMarkup: cfg.stripeMarkup,
        })
      } catch {
        if (!cancelled) {
          setCreditsInfo({ enabled: true, stripeMarkup: 2 })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const signedIn = Boolean(token && address)
  const creditsEnabled = creditsInfo?.enabled !== false

  return (
    <div className="card price-page">
      <h2>Pricing</h2>
      <p className="muted price-page-lead">
        Signing and verifying are free. Sealing costs <strong>1 credit</strong> and permanently records
        your document&apos;s fingerprint on the{' '}
        <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
          Nimiq
        </a>{' '}
        network blockchain. Buy packs ahead of time, or pay the current credit value in NIM when you
        seal.
      </p>

      {creditsEnabled ? (
        <div className="price-page-model" aria-labelledby="price-model-heading">
          <div className="price-page-model-row">
            <span className="price-page-model-label" id="price-model-heading">
              Seal cost
            </span>
            <div className="price-page-model-primary">
              <span className="price-page-model-credits">1 credit</span>
              <span className="price-page-model-per">per document</span>
            </div>
            <p className="muted price-page-model-explain">
              One credit pays for a permanent on-chain seal: the document fingerprint is written to the
              Nimiq network blockchain and can be verified forever, independently of VeriLock.
            </p>
          </div>

          <div className="price-page-model-row">
            <span className="price-page-model-label">1 credit is currently worth</span>
            <div className="price-page-model-value">
              <SealFeeAmount
                feeNim={pricing.feeNim}
                baseFeeNim={pricing.baseFeeNim}
                showWas={pricing.promoActive}
                showFiatPicker
              />
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
              Same amount whether you spend a credit or pay with NIM at seal time. Fiat estimates from{' '}
              <a href={FASTSPOT_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
                Fastspot
              </a>
              .
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
              Prepaid packs (10–100). Pay with NIM or card
              {creditsInfo?.stripeMarkup != null && creditsInfo.stripeMarkup > 1
                ? ` (card ≈${creditsInfo.stripeMarkup}× in USD)`
                : ''}
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
              Why the Nimiq network?
            </h3>
            <p className="price-page-why-lead muted">
              VeriLock seals documents on{' '}
              <a href={NIMIQ_URL} target="_blank" rel="noreferrer" className="price-page-nimiq-link">
                Nimiq
                <ExternalLink size={12} strokeWidth={2.25} aria-hidden />
              </a>
              , a browser-first Layer&nbsp;1. Your wallet signs; the fingerprint goes on the network.
              VeriLock never takes custody of the proof.
            </p>
          </div>
        </header>
        <ul className="price-page-why-list">
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Direct to the chain</strong>
            <span className="price-page-why-item-body muted">
              No attestation broker, escrow, or opaque API sits between you and the record. The seal is
              a normal Nimiq transaction anyone can look up independently of VeriLock.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Fast and lightweight</strong>
            <span className="price-page-why-item-body muted">
              Built for the web: quick confirmations, lightweight clients, no full node for signers.
              Sealing stays practical in the browser or Nimiq Pay.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Cheap permanent proof</strong>
            <span className="price-page-why-item-body muted">
              Network costs stay low, so one credit can anchor a document fingerprint without
              enterprise blockchain pricing.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">PDF stays on your device</strong>
            <span className="price-page-why-item-body muted">
              Only a short integrity fingerprint is written on-chain. The file itself never uploads.
            </span>
          </li>
          <li className="price-page-why-item">
            <strong className="price-page-why-item-title">Self-custodial identity</strong>
            <span className="price-page-why-item-body muted">
              Each party signs with their own wallet. VeriLock never holds your keys, and the proof
              outlives our servers.
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
            Login with your Nimiq wallet to choose a pack.
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
