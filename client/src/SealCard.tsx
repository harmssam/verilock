import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { NimiqPayOpenPanel } from './NimiqPayOpenPanel'
import { formatSealFeeSummary, getSealPricing } from './sealPricing'
import type { SealDocument } from './types'
import './SealCard.css'

interface SealCardProps {
  document: SealDocument
  appUrl: string
  busy: boolean
  lockMessage: string | null
  lockError?: string | null
  inNimiqPay: boolean
  hasNimiqProvider: boolean
  showOpenInPay: boolean
  onSeal: () => void
  onSealPopup?: () => void
}

function priorSealFailed(document: SealDocument): boolean {
  return document.attestation?.status === 'failed' && document.status !== 'locked'
}

export function SealCard({
  document,
  appUrl,
  busy,
  lockMessage,
  lockError,
  inNimiqPay,
  hasNimiqProvider,
  showOpenInPay,
  onSeal,
  onSealPopup,
}: SealCardProps) {
  const pricing = getSealPricing()
  const failedPrior = priorSealFailed(document)
  const interrupted = (document.status === 'locking' && !busy) || failedPrior
  const title = busy
    ? 'Sealing on-chain…'
    : failedPrior
      ? 'Retry seal'
      : interrupted
        ? 'Seal interrupted'
        : 'Ready to seal'

  return (
    <div className={`card seal-card${busy ? ' seal-card--active' : ''}`}>
      <div className="seal-card-header">
        <div className={`seal-card-icon${busy ? ' seal-card-icon--spin' : ''}`}>
          {busy ? (
            <LoaderCircle size={22} strokeWidth={2.25} aria-hidden />
          ) : (
            <ShieldCheck size={22} strokeWidth={2.25} aria-hidden />
          )}
        </div>
        <div>
          <h2>{title}</h2>
          <p className="muted seal-card-subtitle">
            {document.signingProgress.signed}/{document.signingProgress.required} signed —{' '}
            {busy
              ? 'approve the wallet prompt to finish.'
              : failedPrior
                ? 'your signatures are safe — the last transaction never reached the blockchain.'
                : interrupted
                  ? 'the last seal attempt did not finish. Try again.'
                  : `approve one Nimiq transaction (${formatSealFeeSummary(pricing)}) to permanently record this document's fingerprint on-chain. Your PDF stays on your computer.`}
          </p>
          {!busy && !failedPrior && !interrupted && pricing.promoActive && (
            <p className="seal-card-promo">
              <span className="seal-card-promo-badge">{pricing.promoLabel}</span>
            </p>
          )}
        </div>
      </div>

      {failedPrior && !busy && !lockError && (
        <p className="seal-card-notice" role="status">
          Previous seal did not confirm on-chain. Tap below to sign a new transaction in Hub.
        </p>
      )}

      {lockError && (
        <p className="seal-card-error" role="alert">
          {lockError}
        </p>
      )}

      {lockMessage && (
        <p className="seal-card-status" role="status" aria-live="polite">
          {lockMessage}
        </p>
      )}

      <div className="seal-card-progress" aria-hidden={!busy}>
        <span className={`seal-card-step${busy ? ' seal-card-step--current' : ''}`}>Prepare</span>
        <span className="seal-card-step-line" />
        <span className={`seal-card-step${busy ? ' seal-card-step--current' : ''}`}>Wallet</span>
        <span className="seal-card-step-line" />
        <span className={`seal-card-step${busy ? ' seal-card-step--current' : ''}`}>Confirm</span>
      </div>

      <div className="row seal-card-actions">
        <button
          type="button"
          className={`btn btn-primary seal-card-btn${busy ? ' seal-card-btn--busy' : ''}`}
          disabled={busy}
          onClick={onSeal}
        >
          {busy ? (
            <>
              <LoaderCircle className="seal-card-btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
              Sealing…
            </>
          ) : interrupted ? (
            'Retry seal'
          ) : inNimiqPay || hasNimiqProvider ? (
            'Seal agreement'
          ) : (
            'Seal via Hub'
          )}
        </button>
        {!inNimiqPay && !hasNimiqProvider && onSealPopup && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={onSealPopup}
          >
            Try popup
          </button>
        )}
      </div>

      {!inNimiqPay && !hasNimiqProvider && (
        <p className="muted seal-card-hint">
          On desktop, sealing opens Nimiq Hub in this tab (most reliable). If you prefer a popup,
          use Try popup — keep this tab open until the transaction is approved.
        </p>
      )}

      {showOpenInPay && !inNimiqPay && !hasNimiqProvider && (
        <div style={{ marginTop: '0.75rem' }}>
          <NimiqPayOpenPanel appUrl={appUrl} compact />
        </div>
      )}
    </div>
  )
}