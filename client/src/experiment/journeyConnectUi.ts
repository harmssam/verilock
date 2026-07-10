/**
 * Single-button connect UX for Journey:
 * - Desktop → Hub only
 * - Mobile → Pay deeplink first, then Hub after failure
 * - Inside Pay → native wallet connect
 *
 * Entry points use a short “Login” label; mode-specific labels live on the
 * Login sheet proceed button (and in busy states after proceed).
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

/** Short labels for header / page entry buttons (opens Login sheet). */
export function journeyLoginEntryLabels(): { idle: string; busy: string } {
  return { idle: 'Login', busy: 'Logging in…' }
}

/** Mode-specific proceed labels (after user reads Nimiq how-to). */
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
      return { idle: 'Continue with Nimiq Hub', busy: 'Redirecting to Hub…' }
  }
}

/** Copy for the Login sheet (about Nimiq + how to proceed). */
export function journeyLoginSheetCopy(mode: JourneyConnectMode): {
  title: string
  about: string
  steps: string[]
} {
  const about = 'Connect a Nimiq wallet to sign and seal. VeriLock never holds your keys.'

  switch (mode) {
    case 'pay-native':
      return {
        title: 'Login with Nimiq Pay',
        about,
        steps: [
          'Approve the connection when Nimiq Pay prompts you.',
          'Your wallet address becomes your VeriLock identity.',
        ],
      }
    case 'pay-open':
      return {
        title: 'Login with Nimiq Pay',
        about,
        steps: [
          'Open VeriLock in the Nimiq Pay app, or install it from the store links below.',
          'Connect your wallet there, then return here to continue.',
        ],
      }
    case 'hub-fallback':
      return {
        title: 'Login with Nimiq',
        about,
        steps: [
          'Nimiq Pay did not open — continue with Nimiq Hub in this browser instead.',
          'Approve the connection, then you’ll return signed in.',
        ],
      }
    case 'hub':
      return {
        title: 'Login with Nimiq',
        about,
        steps: [
          'Continue opens Nimiq Hub in this browser — no app install needed.',
          'Choose or create a wallet, approve, and return signed in.',
        ],
      }
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
