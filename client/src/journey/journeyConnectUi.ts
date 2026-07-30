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
      return { idle: 'Login with Nimiq Hub', busy: 'Opening Hub…' }
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
    // Hub first: works in any mobile browser without a custom URL scheme.
    hubIdle: 'Nimiq Hub',
    hubBusy: 'Opening Hub…',
    hubHint: 'Recommended · works in this browser · create or unlock a wallet',
    payIdle: 'Open in Nimiq Pay',
    payBusy: 'Opening…',
    payHint: 'Requires the Nimiq Pay app installed on this phone',
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
      about:
        'Use Nimiq Hub in this browser (recommended), or open VeriLock in the Nimiq Pay app if you have it installed.',
      steps: [],
    }
  }
  return {
    title: 'Login with Nimiq',
    about: 'Connect with Nimiq Hub in this browser, or scan a QR to approve in Nimiq Pay.',
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

/**
 * Hub is the reliable default in any browser (desktop + mobile Safari/Chrome).
 * Nimiq Pay stays available as a secondary path when the app is installed.
 * `showOpenInPay` is retained for callers that still track a failed deeplink.
 */
export function journeyHubPreferred(
  mode: JourneyConnectMode,
  _showOpenInPay = false,
): boolean {
  const surface = asLoginSurface(mode)
  if (surface === 'desktop' || surface === 'mobile') return true
  void _showOpenInPay
  return false
}
