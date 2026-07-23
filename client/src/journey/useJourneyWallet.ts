import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NimiqProvider } from '@nimiq/mini-app-sdk'
import { api } from '../api'
import {
  connectNimiq,
  connectViaHub,
  HUB_REDIRECT_MESSAGE,
  isHubCancelError,
  isHubRedirectError,
  isMobileDevice,
  isNimiqPayHost,
  launchNimiqPayMiniApp,
  LOGIN_CANCELED_MESSAGE,
  peekHubRedirectInUrl,
  probeNimiqPay,
  setupHubRedirectHandlers,
  signChallenge,
  warmNimiqProvider,
  shouldUseHubRedirect,
} from '../nimiq'
import { clearStaleHubRpcStateIfIdle, hasPendingHubRedirect } from '../hubRedirectParse'
import { clearSession, loadSession, saveSession } from '../session'
import { createServerBroadcastFallback } from './journeySeal'
import { toJourneyAccount, type JourneyAccount } from './types'

export interface UseJourneyWalletResult {
  account: JourneyAccount | null
  token: string | null
  address: string | null
  nimiq: NimiqProvider | null
  connecting: boolean
  walletStatus: string | null
  error: string | null
  setError: (message: string | null) => void
  connect: (options?: { useRedirect?: boolean }) => Promise<void>
  disconnect: () => void
  setNimiq: (provider: NimiqProvider | null) => void
  applySession: (token: string, address: string) => void
  bootReady: boolean
  /** Completes after Hub seal return handlers finish (if any). */
  hubLockCompletion: Promise<void> | null
  registerHubLockComplete: (
    handler: (result: { txHash: string; token: string; docId: string }) => Promise<void>,
  ) => void
  registerHubLockError: (handler: (err: Error) => Promise<void> | void) => void
  /** User is inside Nimiq Pay WebView (host probe or window.nimiq). */
  inNimiqPay: boolean
  /**
   * Mobile device, not in Pay, not connected — use “Open in Nimiq Pay” copy
   * and deeplink-first connect (legacy mobilePayConnect).
   */
  mobilePayConnect: boolean
  /**
   * True after deeplink launch truly fails (page stayed in foreground).
   * Surfaces install / copy / Hub options — not set after a successful handoff.
   */
  showOpenInPay: boolean
}

const PAY_DEEPLINK_FALLBACK_MS = 2500
/** Shown only when the page stayed foreground after launch — app likely missing. */
const PAY_INSTALL_HINT =
  'Nimiq Pay did not open. Install the app for the best experience, then try again — or continue with Nimiq Hub.'
/**
 * After the browser tab left the foreground (Pay handoff), remind that login
 * lives in the Pay WebView — this tab has a separate sessionStorage.
 */
const PAY_HANDOFF_HINT =
  'Continue in Nimiq Pay to finish login. This browser tab stays separate and will not show that session.'

/**
 * Module-level: one auto-connect attempt per full page load inside Nimiq Pay.
 * Survives React StrictMode remounts; resets on real navigation/reload.
 */
let payHostAutoConnectStarted = false

/**
 * Production wallet session for the journey SPA (Nimiq Pay + Hub).
 * Same auth API path as service A App - no demo addresses.
 */
export function useJourneyWallet(): UseJourneyWalletResult {
  const [token, setToken] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [nimiq, setNimiq] = useState<NimiqProvider | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [walletStatus, setWalletStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bootReady, setBootReady] = useState(false)
  const [hubLockCompletion, setHubLockCompletion] = useState<Promise<void> | null>(null)
  const [inNimiqPay, setInNimiqPay] = useState(() =>
    typeof window !== 'undefined' ? isNimiqPayHost() : false,
  )
  const [showOpenInPay, setShowOpenInPay] = useState(false)

  const hubConnectInFlightRef = useRef(false)
  const walletStatusRef = useRef<string | null>(null)
  const lockCompleteRef = useRef<
    ((result: { txHash: string; token: string; docId: string }) => Promise<void>) | null
  >(null)
  const lockErrorRef = useRef<((err: Error) => Promise<void> | void) | null>(null)
  const deeplinkFallbackTimerRef = useRef<number | null>(null)
  const loginCanceledTimerRef = useRef<number | null>(null)
  /** After explicit disconnect in Pay, do not immediately auto-login again. */
  const skipPayAutoConnectRef = useRef(false)
  /** Mobile browser launched `nimiqpay://` and is waiting to see if the OS left this tab. */
  const payDeeplinkPendingRef = useRef(false)
  /** Page went hidden after deeplink — treat as successful handoff, not install failure. */
  const payDeeplinkLeftPageRef = useRef(false)

  walletStatusRef.current = walletStatus

  const clearDeeplinkFallbackTimer = useCallback(() => {
    if (deeplinkFallbackTimerRef.current != null) {
      window.clearTimeout(deeplinkFallbackTimerRef.current)
      deeplinkFallbackTimerRef.current = null
    }
  }, [])

  const clearPayDeeplinkPending = useCallback(() => {
    payDeeplinkPendingRef.current = false
    payDeeplinkLeftPageRef.current = false
    clearDeeplinkFallbackTimer()
  }, [clearDeeplinkFallbackTimer])

  const clearLoginCanceledTimer = useCallback(() => {
    if (loginCanceledTimerRef.current != null) {
      window.clearTimeout(loginCanceledTimerRef.current)
      loginCanceledTimerRef.current = null
    }
  }, [])

  /** Friendly banner; auto-clears after 5s (CSS fades the last second). */
  const showLoginCanceled = useCallback(() => {
    clearLoginCanceledTimer()
    setWalletStatus(null)
    setError(LOGIN_CANCELED_MESSAGE)
    loginCanceledTimerRef.current = window.setTimeout(() => {
      loginCanceledTimerRef.current = null
      setError(prev => (prev === LOGIN_CANCELED_MESSAGE ? null : prev))
    }, 5000)
  }, [clearLoginCanceledTimer])

  const applySession = useCallback((sessionToken: string, addr: string) => {
    clearLoginCanceledTimer()
    saveSession({ token: sessionToken, address: addr })
    setToken(sessionToken)
    setAddress(addr)
    setShowOpenInPay(false)
  }, [clearLoginCanceledTimer])

  const disconnect = useCallback(() => {
    // Stay logged out until the user taps Login (or reloads the mini app).
    skipPayAutoConnectRef.current = true
    clearSession()
    setToken(null)
    setAddress(null)
    setNimiq(null)
    setError(null)
    setWalletStatus(null)
    setShowOpenInPay(false)
    hubConnectInFlightRef.current = false
    clearPayDeeplinkPending()
  }, [clearPayDeeplinkPending])

  const registerHubLockComplete = useCallback(
    (handler: (result: { txHash: string; token: string; docId: string }) => Promise<void>) => {
      lockCompleteRef.current = handler
    },
    [],
  )

  const registerHubLockError = useCallback(
    (handler: (err: Error) => Promise<void> | void) => {
      lockErrorRef.current = handler
    },
    [],
  )

  /**
   * Hub login uses a full-page redirect. If the user hits Back (or the tab is
   * restored from bfcache) without Hub return params, React state can still
   * say “Logging in…”. Clear only abandoned Hub redirect UI — not in-Pay
   * approve dialogs (those also use `connecting`).
   */
  const resetAbandonedHubRedirect = useCallback(() => {
    if (typeof window === 'undefined') return
    if (peekHubRedirectInUrl() || hasPendingHubRedirect()) return
    if (loadSession()?.token) return

    const status = walletStatusRef.current
    const midHubRedirect =
      hubConnectInFlightRef.current ||
      status === HUB_REDIRECT_MESSAGE ||
      status === 'Connecting via Nimiq Hub…'
    if (!midHubRedirect) return

    hubConnectInFlightRef.current = false
    setConnecting(false)
    setWalletStatus(null)
    // Drop stale Hub RPC entries so the next Login is not blocked as “in flight”.
    clearStaleHubRpcStateIfIdle()
  }, [])

  useEffect(() => {
    let cancelled = false

    const boot = async () => {
      if (isNimiqPayHost()) {
        setInNimiqPay(true)
        warmNimiqProvider()
      }

      const stored = loadSession()
      if (stored && !cancelled) {
        setToken(stored.token)
        setAddress(stored.address)
        try {
          await api.me(stored.token)
        } catch {
          if (!cancelled) {
            clearSession()
            setToken(null)
            setAddress(null)
          }
        }
      }

      void probeNimiqPay(isNimiqPayHost() ? 15_000 : 5_000).then(detected => {
        if (cancelled) return
        const inPay = detected || isNimiqPayHost()
        setInNimiqPay(inPay)
        if (inPay && window.nimiq) {
          setNimiq(window.nimiq)
        }
      })

      const hubSetup = await setupHubRedirectHandlers(
        // Hub single-trip: no address. Legacy chooseAddress path may still pass one.
        async addr => api.challenge(addr ?? undefined),
        async result => {
          try {
            const verified = await api.verify(result.token, {
              publicKey: result.publicKey,
              signature: result.signature,
              authScheme: 'hub',
            })
            applySession(result.token, verified.address)
            setError(null)
            setWalletStatus(null)
          } catch (err) {
            clearSession()
            setToken(null)
            setAddress(null)
            if (isHubCancelError(err)) {
              showLoginCanceled()
            } else {
              setError(err instanceof Error ? err.message : 'Hub login failed')
            }
          } finally {
            hubConnectInFlightRef.current = false
            setConnecting(false)
          }
        },
        err => {
          hubConnectInFlightRef.current = false
          setConnecting(false)
          if (isHubCancelError(err)) {
            showLoginCanceled()
          } else {
            setError(err.message)
            setWalletStatus(null)
          }
        },
        async lockResult => {
          const handler = lockCompleteRef.current
          if (handler) await handler(lockResult)
        },
        async err => {
          const handler = lockErrorRef.current
          if (handler) await handler(err)
          else setError(err.message)
        },
        createServerBroadcastFallback,
      )

      if (!cancelled) {
        setHubLockCompletion(hubSetup.lockCompletion)
        setBootReady(true)
        // History Back can restore after boot without a full remount.
        resetAbandonedHubRedirect()
      }
    }

    void boot()
    return () => {
      cancelled = true
      clearDeeplinkFallbackTimer()
      clearLoginCanceledTimer()
    }
  }, [
    applySession,
    clearDeeplinkFallbackTimer,
    clearLoginCanceledTimer,
    resetAbandonedHubRedirect,
    showLoginCanceled,
  ])

  /**
   * After launching nimiqpay://, mobile often freezes timers while backgrounded.
   * When the user returns, a naive timeout fires and falsely reports "Pay failed"
   * even though login succeeded inside the Pay WebView (separate sessionStorage).
   *
   * Only treat as failure if this tab stayed visible the whole time. If the page
   * hid, handoff worked — show a neutral "continue in Pay" note instead.
   */
  const showPayHandoffHint = useCallback(() => {
    setError(prev => (prev === PAY_INSTALL_HINT ? null : prev))
    setShowOpenInPay(false)
    setWalletStatus(PAY_HANDOFF_HINT)
    setConnecting(false)
    // Soft note only — do not leave the Login control stuck in a busy state.
    window.setTimeout(() => {
      setWalletStatus(prev => (prev === PAY_HANDOFF_HINT ? null : prev))
    }, 8000)
  }, [])

  const markPayDeeplinkHandoff = useCallback(() => {
    if (!payDeeplinkPendingRef.current) return
    payDeeplinkLeftPageRef.current = true
    clearDeeplinkFallbackTimer()
    // Drop any premature "did not open" banner set before the OS switched apps.
    showPayHandoffHint()
  }, [clearDeeplinkFallbackTimer, showPayHandoffHint])

  const completePayDeeplinkReturn = useCallback(() => {
    if (!payDeeplinkPendingRef.current) return
    if (loadSession()?.token) {
      clearPayDeeplinkPending()
      return
    }
    // User came back to the browser after leaving for Pay — not a failed install.
    if (payDeeplinkLeftPageRef.current) {
      clearPayDeeplinkPending()
      showPayHandoffHint()
    }
  }, [clearPayDeeplinkPending, showPayHandoffHint])

  useEffect(() => {
    const onPageShow = () => {
      resetAbandonedHubRedirect()
      completePayDeeplinkReturn()
    }
    // Focus covers some mobile browsers that restore the tab without a full pageshow.
    const onFocus = () => {
      resetAbandonedHubRedirect()
      completePayDeeplinkReturn()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        markPayDeeplinkHandoff()
      } else if (document.visibilityState === 'visible') {
        completePayDeeplinkReturn()
      }
    }
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [resetAbandonedHubRedirect, markPayDeeplinkHandoff, completePayDeeplinkReturn])

  const scheduleDeeplinkFallback = useCallback(() => {
    clearDeeplinkFallbackTimer()
    payDeeplinkPendingRef.current = true
    payDeeplinkLeftPageRef.current = false
    deeplinkFallbackTimerRef.current = window.setTimeout(() => {
      deeplinkFallbackTimerRef.current = null
      if (!payDeeplinkPendingRef.current) return
      // Left the tab / app — handoff, not failure (timers often fire only on resume).
      if (payDeeplinkLeftPageRef.current || document.visibilityState !== 'visible') {
        if (payDeeplinkLeftPageRef.current || document.visibilityState === 'hidden') {
          markPayDeeplinkHandoff()
        }
        return
      }
      if (loadSession()?.token) {
        clearPayDeeplinkPending()
        return
      }
      // Still foreground after launch — OS never switched; app likely missing.
      payDeeplinkPendingRef.current = false
      setShowOpenInPay(true)
      setError(PAY_INSTALL_HINT)
      setWalletStatus(null)
    }, PAY_DEEPLINK_FALLBACK_MS)
  }, [clearDeeplinkFallbackTimer, clearPayDeeplinkPending, markPayDeeplinkHandoff])

  const connect = useCallback(
    async (options?: { useRedirect?: boolean }) => {
      if (hubConnectInFlightRef.current || peekHubRedirectInUrl() || hasPendingHubRedirect()) {
        setWalletStatus(HUB_REDIRECT_MESSAGE)
        return
      }

      setConnecting(true)
      clearLoginCanceledTimer()
      setError(null)
      setWalletStatus(null)
      setShowOpenInPay(false)
      clearPayDeeplinkPending()

      try {
        const payHost = isNimiqPayHost()
        const explicitHubRedirect = options?.useRedirect === true
        setWalletStatus(
          payHost
            ? 'Waiting for Nimiq Pay wallet… approve the dialog when it appears.'
            : isMobileDevice() && !explicitHubRedirect
              ? 'Opening Nimiq Pay…'
              : 'Connecting via Nimiq Hub…',
        )

        // window.nimiq may lag behind window.nimiqPay inside the Nimiq Pay WebView.
        let inPay = payHost || Boolean(typeof window !== 'undefined' && window.nimiq)
        if (!inPay && payHost) {
          void probeNimiqPay(30_000)
            .then(d => {
              if (d && window.nimiq) {
                setNimiq(window.nimiq)
                setInNimiqPay(true)
              }
            })
            .catch(() => {})
        }
        setInNimiqPay(inPay || payHost)

        if (!inPay) {
          if (payHost) {
            throw new Error(
              'Nimiq Pay wallet is still loading. Wait a few seconds, then try Connect again.',
            )
          }

          // Mobile default: try Nimiq Pay deeplink first. Explicit useRedirect skips to Hub
          // (NimiqPayOpenPanel “Continue via Hub redirect”). Note: shouldUseHubRedirect() is
          // true by default for desktop Hub reliability — do not gate Pay on that flag.
          if (isMobileDevice() && !explicitHubRedirect) {
            setWalletStatus('Opening Nimiq Pay…')
            // Full path+query so invite /d/:slug?party= survives Pay open (not just origin → home).
            const appUrl = `${window.location.origin}${window.location.pathname}${window.location.search}`
            const payResult = launchNimiqPayMiniApp(appUrl)
            if (payResult === 'already-in-pay') return
            if (payResult === 'launched') {
              setWalletStatus('Opening Nimiq Pay…')
              // Fail only if this tab never leaves the foreground (app missing).
              scheduleDeeplinkFallback()
              return
            }
            // Deeplink unavailable — show panel, do not fall through to Hub on mobile.
            setShowOpenInPay(true)
            setWalletStatus(null)
            setError(PAY_INSTALL_HINT)
            return
          }

          hubConnectInFlightRef.current = true
          const preferRedirect = shouldUseHubRedirect(options)
          // One Hub trip: signMessage without pre-picked address (pick + sign together).
          // Redirect throws HUB_REDIRECT_MESSAGE; popup path returns signed result here.
          const hubResult = await connectViaHub(
            async addr => api.challenge(addr ?? undefined),
            { preferRedirect },
          )
          const verified = await api.verify(hubResult.token, {
            publicKey: hubResult.publicKey,
            signature: hubResult.signature,
            authScheme: 'hub',
          })
          hubConnectInFlightRef.current = false
          applySession(hubResult.token, verified.address)
          setWalletStatus(null)
          return
        }

        setWalletStatus('Approve account access in Nimiq Pay…')
        const { nimiq: provider, address: addr } = await connectNimiq()
        const { token: sessionToken, nonce } = await api.challenge(addr)
        setWalletStatus('Approve the login signature in Nimiq Pay…')
        const { publicKey, signature } = await signChallenge(provider, nonce)
        const verified = await api.verify(sessionToken, {
          publicKey,
          signature,
          authScheme: 'pay',
        })
        setNimiq(provider)
        setInNimiqPay(true)
        clearPayDeeplinkPending()
        applySession(sessionToken, verified.address)
        setWalletStatus(null)
      } catch (err) {
        if (isHubRedirectError(err)) {
          setError(null)
          setWalletStatus(HUB_REDIRECT_MESSAGE)
          return
        }
        if (isHubCancelError(err)) {
          hubConnectInFlightRef.current = false
          showLoginCanceled()
          return
        }
        hubConnectInFlightRef.current = false
        setError(err instanceof Error ? err.message : 'Wallet connection failed')
        setWalletStatus(null)
      } finally {
        // Keep "Opening Nimiq Pay…" while we wait to see if the OS switches apps.
        if (!hubConnectInFlightRef.current && !payDeeplinkPendingRef.current) {
          setConnecting(false)
        }
      }
    },
    [
      applySession,
      clearLoginCanceledTimer,
      clearPayDeeplinkPending,
      scheduleDeeplinkFallback,
      showLoginCanceled,
    ],
  )

  /**
   * Inside Nimiq Pay: after boot, if there is no session, run Pay login once so
   * opening verilock.online as a mini app lands logged in (approve dialogs only).
   * Does not apply outside Pay; does not re-fire after explicit disconnect.
   */
  useEffect(() => {
    if (!bootReady) return
    if (!isNimiqPayHost()) return
    if (token || loadSession()?.token) return
    if (skipPayAutoConnectRef.current) return
    if (payHostAutoConnectStarted) return
    if (hubConnectInFlightRef.current || peekHubRedirectInUrl() || hasPendingHubRedirect()) {
      return
    }

    payHostAutoConnectStarted = true
    setInNimiqPay(true)
    void connect()
  }, [bootReady, token, connect])

  const account = address ? toJourneyAccount(address) : null

  const mobilePayConnect = useMemo(
    () => isMobileDevice() && !inNimiqPay && !isNimiqPayHost() && !address,
    [inNimiqPay, address],
  )

  return {
    account,
    token,
    address,
    nimiq,
    // Handoff note is informational — must not keep Login looking busy forever.
    connecting:
      connecting ||
      Boolean(walletStatus && !address && walletStatus !== PAY_HANDOFF_HINT),
    walletStatus,
    error,
    setError,
    connect,
    disconnect,
    setNimiq,
    applySession,
    bootReady,
    hubLockCompletion,
    registerHubLockComplete,
    registerHubLockError,
    inNimiqPay,
    mobilePayConnect,
    showOpenInPay,
  }
}
