/**
 * Single-button connect UX for Journey:
 * - Desktop → Hub only (no intermediate sheet)
 * - Mobile → chooser sheet: Nimiq Pay app or Hub in browser
 * - Inside Pay → native wallet connect
 *
 * Entry points use a short “Login” label; mode-specific labels live on the
 * Login sheet (and in busy states after proceed).
 */

export type JourneyConnectMode = 'pay-native' | 'pay-open' | 'hub-fallback' | 'hub'

/** Options passed into useJourneyWallet.connect */
export type JourneyConnectRequest = { useRedirect?: boolean }

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

/**
 * Desktop Hub + in-app Pay: go straight to connect.
 * Mobile browser: show chooser (Pay app vs Hub).
 */
export function journeyLoginNeedsSheet(mode: JourneyConnectMode): boolean {
  return mode === 'pay-open' || mode === 'hub-fallback'
}

/** Short labels for header / page entry buttons (opens sheet or starts connect). */
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
      return { idle: 'Continue with Nimiq Hub', busy: 'Opening Hub…' }
    case 'hub':
      return { idle: 'Continue with Nimiq Hub', busy: 'Opening Hub…' }
  }
}

/** Labels for the mobile dual-choice sheet. */
export function journeyMobileChoiceLabels(): {
  payIdle: string
  payBusy: string
  payHint: string
  hubIdle: string
  hubBusy: string
  hubHint: string
  storesLabel: string
} {
  return {
    payIdle: 'Open in Nimiq Pay',
    payBusy: 'Opening…',
    payHint: 'Requires the Nimiq Pay app',
    hubIdle: 'Continue in browser',
    hubBusy: 'Opening Hub…',
    hubHint: 'Nimiq Hub — one step, no app install',
    storesLabel: 'Get Nimiq Pay',
  }
}

/** Copy for the Login sheet (about Nimiq + how to proceed). */
export function journeyLoginSheetCopy(mode: JourneyConnectMode): {
  title: string
  about: string
  /** Ordered steps for single-path modes; empty for mobile chooser. */
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
    case 'hub-fallback':
      return {
        title: 'Login with Nimiq',
        about,
        // Dual-choice sheet: options carry the how-to, not a step list.
        steps: [],
      }
    case 'hub':
      return {
        title: 'Login with Nimiq',
        about,
        steps: [
          'Continue opens Nimiq Hub once in this browser — no app install, no pop-up chain.',
          'Pick or create a wallet, approve the sign-in, and return logged in.',
        ],
      }
  }
}

/** Options passed to useJourneyWallet.connect for the active mode. */
export function journeyConnectOptions(mode: JourneyConnectMode): JourneyConnectRequest | undefined {
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
      ? ' After connect you can drop the shared document to open the agreement.'
      : role === 'verifier'
        ? ' Wallet is optional for verify — connect only if you need it.'
        : ' After connect, step 2 opens the document stage.'

  switch (mode) {
    case 'pay-native':
      return `Connect your Nimiq Pay wallet to continue.${tail}`
    case 'pay-open':
      return `Open VeriLock in Nimiq Pay for the best mobile experience, or continue in the browser with Nimiq Hub.${tail}`
    case 'hub-fallback':
      return `Nimiq Pay did not open. Install the app, or continue with Nimiq Hub in this browser.${tail}`
    case 'hub':
      return `Connect your Nimiq wallet in the browser via Nimiq Hub — no app install needed.${tail}`
  }
}
