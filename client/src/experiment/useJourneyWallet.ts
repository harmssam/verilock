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
  peekHubRedirectInUrl,
  probeNimiqPay,
  setupHubRedirectHandlers,
  signChallenge,
  warmNimiqProvider,
  shouldUseHubRedirect,
} from '../nimiq'
import { hasPendingHubRedirect } from '../hubRedirectParse'
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
   * True after deeplink launch fails or user returns without a session
   * (~2.5s visibility check). Surfaces install / copy / Hub options.
   */
  showOpenInPay: boolean
}

const PAY_DEEPLINK_FALLBACK_MS = 2500
/** Shown after mobile deeplink fails; primary button becomes “Continue with Nimiq Hub”. */
const PAY_INSTALL_HINT =
  'Nimiq Pay did not open. Install the app for the best experience, then try again — or continue with Nimiq Hub.'

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
  const lockCompleteRef = useRef<
    ((result: { txHash: string; token: string; docId: string }) => Promise<void>) | null
  >(null)
  const lockErrorRef = useRef<((err: Error) => Promise<void> | void) | null>(null)
  const deeplinkFallbackTimerRef = useRef<number | null>(null)

  const clearDeeplinkFallbackTimer = useCallback(() => {
    if (deeplinkFallbackTimerRef.current != null) {
      window.clearTimeout(deeplinkFallbackTimerRef.current)
      deeplinkFallbackTimerRef.current = null
    }
  }, [])

  const applySession = useCallback((sessionToken: string, addr: string) => {
    saveSession({ token: sessionToken, address: addr })
    setToken(sessionToken)
    setAddress(addr)
    setShowOpenInPay(false)
  }, [])

  const disconnect = useCallback(() => {
    clearSession()
    setToken(null)
    setAddress(null)
    setNimiq(null)
    setError(null)
    setWalletStatus(null)
    setShowOpenInPay(false)
    hubConnectInFlightRef.current = false
    clearDeeplinkFallbackTimer()
  }, [clearDeeplinkFallbackTimer])

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
        async addr => api.challenge(addr),
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
            setError(err instanceof Error ? err.message : 'Hub login failed')
          } finally {
            hubConnectInFlightRef.current = false
            setConnecting(false)
          }
        },
        err => {
          hubConnectInFlightRef.current = false
          setConnecting(false)
          setError(err.message)
          setWalletStatus(null)
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
      }
    }

    void boot()
    return () => {
      cancelled = true
      clearDeeplinkFallbackTimer()
    }
  }, [applySession, clearDeeplinkFallbackTimer])

  const scheduleDeeplinkFallback = useCallback(() => {
    clearDeeplinkFallbackTimer()
    deeplinkFallbackTimerRef.current = window.setTimeout(() => {
      deeplinkFallbackTimerRef.current = null
      if (document.visibilityState !== 'visible') return
      if (loadSession()?.token) return
      setShowOpenInPay(true)
      setError(PAY_INSTALL_HINT)
    }, PAY_DEEPLINK_FALLBACK_MS)
  }, [clearDeeplinkFallbackTimer])

  const connect = useCallback(
    async (options?: { useRedirect?: boolean }) => {
      if (hubConnectInFlightRef.current || peekHubRedirectInUrl() || hasPendingHubRedirect()) {
        setWalletStatus(HUB_REDIRECT_MESSAGE)
        return
      }

      setConnecting(true)
      setError(null)
      setWalletStatus(null)
      setShowOpenInPay(false)
      clearDeeplinkFallbackTimer()

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
            const appUrl = window.location.origin
            const payResult = launchNimiqPayMiniApp(appUrl)
            if (payResult === 'already-in-pay') return
            if (payResult === 'launched') {
              setWalletStatus(null)
              // If the user stays (or returns) without a session, surface install/copy/Hub.
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
          await connectViaHub(async addr => api.challenge(addr), { preferRedirect })
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
        applySession(sessionToken, verified.address)
        setWalletStatus(null)
      } catch (err) {
        if (isHubRedirectError(err)) {
          setError(null)
          setWalletStatus(HUB_REDIRECT_MESSAGE)
          return
        }
        if (isHubCancelError(err)) {
          setError(null)
          setWalletStatus('Login cancelled in Hub.')
          hubConnectInFlightRef.current = false
          return
        }
        hubConnectInFlightRef.current = false
        setError(err instanceof Error ? err.message : 'Wallet connection failed')
        setWalletStatus(null)
      } finally {
        if (!hubConnectInFlightRef.current) {
          setConnecting(false)
        }
      }
    },
    [applySession, clearDeeplinkFallbackTimer, scheduleDeeplinkFallback],
  )

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
    connecting: connecting || Boolean(walletStatus && !address),
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
