/**
 * Connect UX for Journey:
 * - Desktop → chooser sheet: Nimiq Pay QR or Hub in browser
 * - Mobile → chooser sheet: Nimiq Pay app or Hub in browser
 * - Inside Pay → native wallet connect (no sheet)
 *
 * Entry points use a short “Login” label; mode-specific labels live on the
 * Login sheet (and in busy states after proceed).
 */

export type JourneyConnectMode =
  | 'pay-native'
  | 'pay-open'
  | 'hub-fallback'
  | 'desktop-choice'
  | 'hub'

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
  // Desktop browser (not Pay): show Pay QR + Hub choice.
  return 'desktop-choice'
}

/**
 * Desktop choice + mobile Pay/Hub: show Login sheet.
 * In-app Pay: go straight to connect (optional sheet for copy only).
 */
export function journeyLoginNeedsSheet(mode: JourneyConnectMode): boolean {
  return (
    mode === 'pay-open' ||
    mode === 'hub-fallback' ||
    mode === 'desktop-choice'
  )
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
    case 'desktop-choice':
      return { idle: 'Login with Nimiq', busy: 'Logging in…' }
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
    hubHint: 'Nimiq Hub - one step, no app install',
    storesLabel: 'Get Nimiq Pay',
  }
}

/** Labels for desktop dual-choice (Hub default, Pay QR optional). */
export function journeyDesktopChoiceLabels(): {
  payIdle: string
  payBusy: string
  payHint: string
  hubIdle: string
  hubBusy: string
  hubHint: string
} {
  return {
    hubIdle: 'Continue with Nimiq Hub',
    hubBusy: 'Opening Hub…',
    hubHint: 'Recommended - sign in on this computer in one step',
    payIdle: 'Sign in with Nimiq Pay on your phone',
    payBusy: 'Waiting for phone…',
    payHint:
      'Use this if your wallet lives in the Nimiq Pay app. Scan a QR, approve on your phone, and this computer finishes login.',
  }
}

/** Copy for the Login sheet (about Nimiq + how to proceed). */
export function journeyLoginSheetCopy(mode: JourneyConnectMode): {
  title: string
  about: string
  /** Ordered steps for single-path modes; empty for chooser sheets. */
  steps: string[]
} {
  const about =
    'Connect a Nimiq wallet to sign and lock on the blockchain. VeriLock never holds your keys.'

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
    case 'desktop-choice':
      return {
        title: 'Login with Nimiq',
        about: 'Connect via browser Hub or the Nimiq Pay app.',
        steps: [],
      }
    case 'hub':
      return {
        title: 'Login with Nimiq',
        about,
        steps: [
          'Continue opens Nimiq Hub once in this browser - no app install, no pop-up chain.',
          'Pick or create a wallet, approve the sign-in, and return logged in.',
        ],
      }
  }
}

/** Options passed to useJourneyWallet.connect for the active mode. */
export function journeyConnectOptions(mode: JourneyConnectMode): JourneyConnectRequest | undefined {
  // Hub paths request redirect explicitly (desktop + mobile fallback).
  if (mode === 'hub' || mode === 'hub-fallback') return { useRedirect: true }
  // Desktop choice Hub button also uses redirect when user picks Hub.
  if (mode === 'desktop-choice') return { useRedirect: true }
  return undefined
}
