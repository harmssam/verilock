import { LoaderCircle, ShieldCheck } from 'lucide-react'
import { NimiqPayOpenPanel } from './NimiqPayOpenPanel'
import { insufficientSealFundsMessage, type SealFundsStatus } from './sealFunds'
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
  sealFunds: SealFundsStatus | null
  sealFundsLoading?: boolean
  sealFundsError?: string | null
  onRefreshFunds?: () => void
  onSeal: () => void
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
  sealFunds,
  sealFundsLoading = false,
  sealFundsError,
  onRefreshFunds,
  onSeal,
}: SealCardProps) {
  const pricing = getSealPricing()
  const failedPrior = priorSealFailed(document)
  const interrupted = (document.status === 'locking' && !busy) || failedPrior
  const insufficientFunds = sealFunds !== null && !sealFunds.sufficient
  const canSeal = !busy && !insufficientFunds && !sealFundsLoading
  const title = busy
    ? 'Sealing on-chain…'
    : insufficientFunds
      ? 'Add NIM to seal'
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
              : insufficientFunds
                ? 'Your wallet does not have enough NIM for the seal fee and network costs.'
                : failedPrior
                  ? 'your signatures are safe — the last transaction never reached the blockchain.'
                  : interrupted
                    ? 'the last seal attempt did not finish. Try again.'
                    : `approve one Nimiq transaction (${formatSealFeeSummary(pricing)}) to permanently record this document's fingerprint on-chain. Your PDF stays on your computer.`}
          </p>
          {!busy && !failedPrior && !interrupted && !insufficientFunds && pricing.promoActive && (
            <p className="seal-card-promo">
              <span className="seal-card-promo-badge">{pricing.promoLabel}</span>
            </p>
          )}
        </div>
      </div>

      {insufficientFunds && sealFunds && !busy && (
        <p className="seal-card-funds-warning" role="alert">
          {insufficientSealFundsMessage(sealFunds)}
        </p>
      )}

      {sealFundsError && !sealFundsLoading && !busy && (
        <p className="seal-card-notice" role="status">
          Could not verify wallet balance ({sealFundsError}).{' '}
          {onRefreshFunds && (
            <button type="button" className="text-link" onClick={onRefreshFunds}>
              Try again
            </button>
          )}
        </p>
      )}

      {failedPrior && !busy && !lockError && !insufficientFunds && (
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
          disabled={!canSeal}
          onClick={onSeal}
        >
          {busy ? (
            <>
              <LoaderCircle className="seal-card-btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
              Sealing…
            </>
          ) : sealFundsLoading ? (
            <>
              <LoaderCircle className="seal-card-btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
              Checking balance…
            </>
          ) : insufficientFunds ? (
            'Add NIM to continue'
          ) : interrupted ? (
            'Retry seal'
          ) : inNimiqPay || hasNimiqProvider ? (
            'Seal agreement'
          ) : (
            'Seal via Hub'
          )}
        </button>
        {onRefreshFunds && !busy && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={sealFundsLoading}
            onClick={onRefreshFunds}
          >
            Refresh balance
          </button>
        )}
      </div>

      {!inNimiqPay && !hasNimiqProvider && (
        <p className="muted seal-card-hint">
          Sealing redirects to Nimiq Hub in this tab. Keep VeriLock open until you return and the
          on-chain proof is confirmed.
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