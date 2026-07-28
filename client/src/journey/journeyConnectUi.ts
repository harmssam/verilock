/**
 * Login surface policy for Journey / shell.
 *
 * Three surfaces only:
 * - in-pay: Nimiq Pay WebView → native connect (no sheet)
 * - mobile: phone browser → deeplink chooser (Pay app vs Hub)
 * - desktop: browser → Hub primary + optional Pay QR
 */

/** Where the user is sitting. */
export type LoginSurface = 'in-pay' | 'mobile' | 'desktop'

/**
 * @deprecated Prefer LoginSurface. Kept as alias so older prop names compile during rename.
 * Maps: pay-native→in-pay, pay-open|hub-fallback→mobile, desktop-choice|hub→desktop
 */
export type JourneyConnectMode = LoginSurface | 'pay-native' | 'pay-open' | 'hub-fallback' | 'desktop-choice' | 'hub'

/** Options passed into useJourneyWallet.connect */
export type JourneyConnectRequest = { useRedirect?: boolean }

export function resolveLoginSurface(options: {
  inNimiqPay: boolean
  isMobile: boolean
}): LoginSurface {
  if (options.inNimiqPay) return 'in-pay'
  if (options.isMobile) return 'mobile'
  return 'desktop'
}

/**
 * @deprecated Use resolveLoginSurface. Bridges old mobilePayConnect / showOpenInPay flags.
 */
export function resolveJourneyConnectMode(options: {
  inNimiqPay: boolean
  mobilePayConnect: boolean
  showOpenInPay: boolean
  isMobile?: boolean
}): LoginSurface {
  return resolveLoginSurface({
    inNimiqPay: options.inNimiqPay,
    isMobile: options.mobilePayConnect || options.isMobile === true,
  })
}

/** Normalize legacy mode names to LoginSurface. */
export function asLoginSurface(mode: JourneyConnectMode): LoginSurface {
  switch (mode) {
    case 'in-pay':
    case 'pay-native':
      return 'in-pay'
    case 'mobile':
    case 'pay-open':
    case 'hub-fallback':
      return 'mobile'
    case 'desktop':
    case 'desktop-choice':
    case 'hub':
    default:
      return 'desktop'
  }
}

/** Sheet for mobile chooser + desktop Hub/Pay chooser. In-Pay goes straight to connect. */
export function journeyLoginNeedsSheet(mode: JourneyConnectMode): boolean {
  const surface = asLoginSurface(mode)
  return surface === 'mobile' || surface === 'desktop'
}

/** Short labels for header / page entry buttons. */
export function journeyLoginEntryLabels(): { idle: string; busy: string } {
  return { idle: 'Login', busy: 'Logging in…' }
}

/** Mode-specific proceed labels. */
export function journeyConnectLabels(mode: JourneyConnectMode): {
  idle: string
  busy: string
} {
  switch (asLoginSurface(mode)) {
    case 'in-pay':
      return { idle: 'Connect wallet', busy: 'Connecting…' }
    case 'mobile':
      return { idle: 'Open in Nimiq Pay', busy: 'Opening…' }
    case 'desktop':
      return { idle: 'Login with Nimiq', busy: 'Logging in…' }
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
    hubHint: 'Nimiq Hub: create or unlock a wallet, no app install',
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
    hubIdle: 'Nimiq Hub',
    hubBusy: 'Opening Hub…',
    hubHint: 'Recommended · this computer',
    payIdle: 'Nimiq Pay',
    payBusy: 'Waiting for phone…',
    payHint: 'Scan QR · approve on your phone',
  }
}

/** Copy for the Login sheet. */
export function journeyLoginSheetCopy(mode: JourneyConnectMode): {
  title: string
  about: string
  steps: string[]
} {
  const surface = asLoginSurface(mode)
  if (surface === 'in-pay') {
    return {
      title: 'Login with Nimiq Pay',
      about:
        'Connect a Nimiq wallet to sign and lock on the blockchain. VeriLock never holds your keys.',
      steps: [
        'Approve the connection when Nimiq Pay prompts you.',
        'Your wallet address becomes your VeriLock identity.',
      ],
    }
  }
  if (surface === 'mobile') {
    return {
      title: 'Login with Nimiq',
      about: 'Connect via browser Hub or the Nimiq Pay app.',
      steps: [],
    }
  }
  return {
    title: 'Login with Nimiq',
    about: 'Connect via browser Hub or the Nimiq Pay app.',
    steps: [],
  }
}

/**
 * Default connect options when the caller does not pass explicit ones.
 * Mobile Pay and in-Pay must stay undefined so connect() deeplinks / uses provider.
 * Hub buttons always pass `{ useRedirect: true }` themselves.
 */
export function journeyConnectOptions(mode: JourneyConnectMode): JourneyConnectRequest | undefined {
  // No defaults that force Hub on desktop/mobile Pay paths.
  void mode
  return undefined
}

/** Hub is primary on desktop, or on mobile after Pay deeplink failed. */
export function journeyHubPreferred(
  mode: JourneyConnectMode,
  showOpenInPay = false,
): boolean {
  const surface = asLoginSurface(mode)
  if (surface === 'desktop') return true
  if (surface === 'mobile' && showOpenInPay) return true
  return false
}
