/**
 * Single-button connect UX for Journey:
 * - Desktop → Hub only
 * - Mobile → Pay deeplink first, then Hub after failure
 * - Inside Pay → native wallet connect
 */

export type JourneyConnectMode = 'pay-native' | 'pay-open' | 'hub-fallback' | 'hub'

export function resolveJourneyConnectMode(options: {
  inNimiqPay: boolean
  mobilePayConnect: boolean
  showOpenInPay: boolean
}): JourneyConnectMode {
  if (options.inNimiqPay) return 'pay-native'
  if (options.mobilePayConnect && options.showOpenInPay) return 'hub-fallback'
  if (options.mobilePayConnect) return 'pay-open'
  return 'hub'
}

export function journeyConnectLabels(mode: JourneyConnectMode): {
  idle: string
  busy: string
} {
  switch (mode) {
    case 'pay-native':
      return { idle: 'Connect wallet', busy: 'Connecting…' }
    case 'pay-open':
      return { idle: 'Open in Nimiq Pay', busy: 'Opening…' }
    case 'hub-fallback':
      return { idle: 'Continue with Nimiq Hub', busy: 'Redirecting to Hub…' }
    case 'hub':
      return { idle: 'Connect with Nimiq Hub', busy: 'Redirecting to Hub…' }
  }
}

/** Options passed to useJourneyWallet.connect for the active mode. */
export function journeyConnectOptions(
  mode: JourneyConnectMode,
): { useRedirect?: boolean } | undefined {
  // Hub paths request redirect explicitly (desktop + mobile fallback).
  if (mode === 'hub' || mode === 'hub-fallback') return { useRedirect: true }
  return undefined
}

export function journeyConnectLead(
  mode: JourneyConnectMode,
  role: 'creator' | 'signer' | 'verifier' | null,
): string {
  const tail =
    role === 'signer'
      ? ' After connect you can drop the shared PDF to open the agreement.'
      : role === 'verifier'
        ? ' Wallet is optional for verify — connect only if you need it.'
        : ' After connect, step 2 opens the PDF stage.'

  switch (mode) {
    case 'pay-native':
      return `Connect your Nimiq Pay wallet to continue.${tail}`
    case 'pay-open':
      return `Open VeriLock in Nimiq Pay for the best mobile experience.${tail}`
    case 'hub-fallback':
      return `Nimiq Pay did not open. Install the app, or continue with Nimiq Hub in this browser.${tail}`
    case 'hub':
      return `Connect your Nimiq wallet in the browser via Nimiq Hub — no app install needed.${tail}`
  }
}
