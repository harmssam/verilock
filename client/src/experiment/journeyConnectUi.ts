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
  const about =
    'VeriLock uses Nimiq — a simple crypto wallet — so you can sign and seal agreements without uploading your PDF. Only a SHA-256 fingerprint is recorded; your file stays on this device.'

  switch (mode) {
    case 'pay-native':
      return {
        title: 'Login with Nimiq Pay',
        about,
        steps: [
          'Approve the connection in Nimiq Pay when prompted.',
          'Your wallet address becomes your VeriLock identity.',
          'You can disconnect anytime from the account menu.',
        ],
      }
    case 'pay-open':
      return {
        title: 'Login with Nimiq Pay',
        about,
        steps: [
          'Open VeriLock inside the Nimiq Pay app for the best mobile experience.',
          'If you don’t have the app yet, install it from the store links below.',
          'Then connect your wallet and return here to continue.',
        ],
      }
    case 'hub-fallback':
      return {
        title: 'Login with Nimiq',
        about,
        steps: [
          'Nimiq Pay did not open — you can still login in this browser via Nimiq Hub.',
          'You’ll leave VeriLock briefly, approve the connection, then return automatically.',
          'Or install Nimiq Pay and open VeriLock from the app for a smoother flow.',
        ],
      }
    case 'hub':
      return {
        title: 'Login with Nimiq',
        about,
        steps: [
          'Continue opens Nimiq Hub in this browser — no app install required.',
          'Choose or create a wallet, then approve the connection.',
          'You’ll return to VeriLock signed in as that address.',
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
