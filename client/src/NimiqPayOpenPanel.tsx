import { useState } from 'react'
import { ExternalLink, LoaderCircle, Smartphone } from 'lucide-react'
import {
  copyNimiqPayDeepLink,
  getMiniAppWebUrl,
  isMobileDevice,
  launchNimiqPayMiniApp,
  NIMIQ_PAY_ANDROID_URL,
  NIMIQ_PAY_IOS_URL,
} from './nimiq'

interface NimiqPayOpenPanelProps {
  appUrl: string
  compact?: boolean
  showHubFallback?: boolean
  busy?: boolean
  onHubRedirect?: () => void
}

export function NimiqPayOpenPanel({
  appUrl,
  compact,
  showHubFallback,
  busy,
  onHubRedirect,
}: NimiqPayOpenPanelProps) {
  const mobile = isMobileDevice()
  const [copied, setCopied] = useState<'web' | 'deeplink' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const flashCopied = (kind: 'web' | 'deeplink') => {
    setCopied(kind)
    window.setTimeout(() => setCopied(null), 2500)
  }

  const copyWebUrl = async () => {
    const url = getMiniAppWebUrl(appUrl)
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url)
    }
    flashCopied('web')
  }

  const copyDeepLink = async () => {
    await copyNimiqPayDeepLink(appUrl)
    flashCopied('deeplink')
  }

  const handleOpen = () => {
    setNotice(null)
    const result = launchNimiqPayMiniApp(appUrl)
    if (result === 'unavailable') {
      setNotice(
        'This browser cannot open Nimiq Pay. Install the app on your phone, copy the link below, and open it from there.',
      )
    }
  }

  return (
    <div className={`pay-open-panel${compact ? ' pay-open-panel--compact' : ''}`}>
      {!compact && (
        <p className="muted pay-open-lead">
          {mobile
            ? showHubFallback
              ? 'Open VeriLock in Nimiq Pay for the best experience, or connect via Nimiq Hub.'
              : 'Wallet actions work best inside the Nimiq Pay app.'
            : showHubFallback
              ? 'Connect your Nimiq wallet in the browser — no app install needed.'
              : 'Nimiq Pay runs on your phone — use a mobile browser to open the app there.'}
        </p>
      )}

      <div className="pay-open-actions row">
        {mobile && (
          <button type="button" className="btn btn-primary" onClick={handleOpen}>
            <Smartphone size={16} strokeWidth={2.25} aria-hidden />
            Open in Nimiq Pay
          </button>
        )}
        {showHubFallback && onHubRedirect && !mobile && (
          <button
            type="button"
            className={`btn btn-primary${busy ? ' btn--busy' : ''}`}
            disabled={busy}
            onClick={onHubRedirect}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                Redirecting to Hub…
              </>
            ) : (
              'Connect via Nimiq Hub'
            )}
          </button>
        )}
      </div>

      {mobile && (
        <div className="pay-open-store">
          <p className="muted pay-open-store-label">Don&apos;t have Nimiq Pay yet? Get the app:</p>
          <div className="pay-open-actions row">
            <a className="btn btn-secondary" href={NIMIQ_PAY_IOS_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={15} strokeWidth={2.25} aria-hidden />
              Get on App Store
            </a>
            <a className="btn btn-secondary" href={NIMIQ_PAY_ANDROID_URL} target="_blank" rel="noreferrer">
              <ExternalLink size={15} strokeWidth={2.25} aria-hidden />
              Get on Google Play
            </a>
          </div>
        </div>
      )}

      <div className="pay-open-actions row">
        <button type="button" className="btn btn-ghost" onClick={() => void copyWebUrl()}>
          {copied === 'web' ? 'Link copied' : 'Copy app link'}
        </button>
        {mobile && (
          <button type="button" className="btn btn-ghost" onClick={() => void copyDeepLink()}>
            {copied === 'deeplink' ? 'Deeplink copied' : 'Copy deeplink'}
          </button>
        )}
        {showHubFallback && onHubRedirect && mobile && (
          <button
            type="button"
            className={`btn btn-secondary${busy ? ' btn--busy' : ''}`}
            disabled={busy}
            onClick={onHubRedirect}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                Opening Hub…
              </>
            ) : (
              'Continue via Hub redirect'
            )}
          </button>
        )}
      </div>

      {notice && <p className="pay-open-notice muted">{notice}</p>}

      {!compact && (
        <ol className="pay-open-steps muted">
          {mobile ? (
            <>
              <li>Download Nimiq Pay if you don&apos;t have it yet (links above).</li>
              <li>Tap Open in Nimiq Pay, or copy the app link and open it inside the app.</li>
              {showHubFallback && <li>Prefer a browser wallet? Use Continue via Hub redirect below.</li>}
            </>
          ) : (
            <>
              <li>Click Connect via Nimiq Hub to sign in with your wallet.</li>
              <li>No phone or app install required — Hub works right in your browser.</li>
            </>
          )}
        </ol>
      )}
    </div>
  )
}