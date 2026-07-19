import { Check, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './pdf/SignatureStrokePad'
import {
  encryptPayload,
  importKeyB64url,
  packEncrypted,
  strokeResultToPayload,
} from './signatureHandoff/crypto'
import { depositEncrypted, getHandoffSession } from './signatureHandoff/signalingClient'
import {
  sendOnChannel,
  startGuestPeer,
  waitForChannelOpen,
  type PeerSession,
} from './signatureHandoff/webrtc'
import type { GuestPhase } from './signatureHandoff/types'
import './SignMobilePage.css'

function parseSessionId(pathname: string): string | null {
  const m = pathname.match(/^\/m\/sign\/([^/]+)\/?$/)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

function hashParams(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash && !hash.includes('=')) return new URLSearchParams()
  return new URLSearchParams(hash)
}

function keyFromHash(): string | null {
  const params = hashParams()
  const k = params.get('k')
  if (k) return k
  const raw = window.location.hash.replace(/^#/, '')
  if (raw.startsWith('k=')) return raw.slice(2).split('&')[0] || null
  return null
}

function aspectFromHash(): number | null {
  const a = Number(hashParams().get('a'))
  if (!Number.isFinite(a) || a < 0.05 || a > 20) return null
  return a
}

function kindFromHash(): 'signature' | 'initial' {
  return hashParams().get('kind') === 'initial' ? 'initial' : 'signature'
}

/**
 * Full-screen mobile signature capture — no wallet, no PDF, no preview step.
 * Draw → Done sends vectors (E2E encrypted) to the desktop host.
 */
export function SignMobilePage() {
  const sessionId = parseSessionId(window.location.pathname)
  const [phase, setPhase] = useState<GuestPhase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [stroke, setStroke] = useState<SignatureStrokeResult | null>(null)
  const [padKey, setPadKey] = useState(0)
  const padAspect = aspectFromHash()
  const fieldKind = kindFromHash()
  const isInitial = fieldKind === 'initial'

  const keyRef = useRef<CryptoKey | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const peerRef = useRef<PeerSession | null>(null)
  const channelOpenRef = useRef(false)
  const strokeRef = useRef<SignatureStrokeResult | null>(null)
  strokeRef.current = stroke
  const sendingRef = useRef(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      if (!sessionId) {
        setError('Invalid link — ask your computer to show a new QR code.')
        setPhase('error')
        return
      }
      const k = keyFromHash()
      if (!k) {
        setError(
          'Missing encryption key. Open the full link from the QR code (some in-app browsers strip it).',
        )
        setPhase('error')
        return
      }
      try {
        const key = await importKeyB64url(k)
        keyRef.current = key
        const room = await getHandoffSession(sessionId)
        if (cancelled) return
        if (room.status === 'expired' || room.status === 'completed') {
          setError('This session expired. Ask your computer to show a new QR code.')
          setPhase('error')
          return
        }

        peerRef.current = startGuestPeer({
          sessionId,
          onChannel: ch => {
            channelRef.current = ch
            ch.onopen = () => {
              channelOpenRef.current = true
              if (!cancelled) {
                setPhase(p => (p === 'sending' || p === 'sent' ? p : 'connected'))
              }
            }
          },
          onStatus: s => {
            if (cancelled) return
            if (s === 'connected') {
              setPhase(p => (p === 'ready' || p === 'connecting' || p === 'loading' ? 'connected' : p))
            }
          },
          onError: () => {
            /* deposit fallback still available */
          },
        })

        setPhase('ready')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not open session')
        setPhase('error')
      }
    })()

    return () => {
      cancelled = true
      peerRef.current?.stop()
    }
  }, [sessionId])

  const send = useCallback(async () => {
    const current = strokeRef.current
    if (!current?.path?.strokes?.length || !sessionId || !keyRef.current) return
    if (sendingRef.current) return
    sendingRef.current = true
    setPhase('sending')
    setError(null)
    try {
      const payload = strokeResultToPayload(
        sessionId,
        current.path,
        current.imageDataUrl || undefined,
      )
      const pkg = await encryptPayload(keyRef.current, sessionId, payload)
      const packed = packEncrypted(pkg)

      const ch = channelRef.current
      if (ch && (ch.readyState === 'open' || channelOpenRef.current)) {
        try {
          if (ch.readyState !== 'open') await waitForChannelOpen(ch, 4000)
          sendOnChannel(ch, packed)
        } catch {
          /* deposit below is durable */
        }
      }

      await depositEncrypted(sessionId, pkg)

      setPhase('sent')
      peerRef.current?.stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send signature')
      setPhase('error')
    } finally {
      sendingRef.current = false
    }
  }, [sessionId])

  const drawing =
    phase === 'ready' || phase === 'connecting' || phase === 'connected'

  return (
    <div className={`sign-mobile-page${drawing ? ' sign-mobile-page--draw' : ''}`}>
      {drawing && (
        <>
          <header className="sign-mobile-header sign-mobile-header--compact">
            <p className="sign-mobile-kicker">VeriLock</p>
            <h1 className="sign-mobile-title">
              {isInitial ? 'Draw your initials' : 'Draw your signature'}
            </h1>
          </header>

          <div className="sign-mobile-pad-stage">
            <SignatureStrokePad
              key={padKey}
              productMode
              compact
              label={isInitial ? 'Initials' : 'Signature'}
              padAspect={padAspect ?? (isInitial ? 1.4 : 2.8)}
              onChange={result => setStroke(result)}
            />
          </div>

          {/*
            Floating dock: canvas stays full-size underneath. Pointer capture on the
            pad keeps drawing continuous when the finger passes over the buttons.
          */}
          <div className="sign-mobile-float-dock">
            <button
              type="button"
              className={`btn btn-primary btn-lg sign-mobile-done-btn${
                !stroke?.path?.strokes?.length ? ' is-disabled' : ''
              }`}
              disabled={!stroke?.path?.strokes?.length}
              onClick={() => void send()}
            >
              Done
            </button>
          </div>
        </>
      )}

      {phase === 'loading' && (
        <p className="sign-mobile-status" role="status">
          <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.25} />
          Opening secure session…
        </p>
      )}

      {phase === 'error' && (
        <div className="sign-mobile-error" role="alert">
          <p>{error ?? 'Something went wrong'}</p>
          <p className="muted">Return to your computer and open a new QR code.</p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setError(null)
              setStroke(null)
              setPadKey(k => k + 1)
              setPhase(channelOpenRef.current ? 'connected' : 'ready')
            }}
          >
            Try again
          </button>
        </div>
      )}

      {phase === 'sending' && (
        <p className="sign-mobile-status" role="status">
          <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.25} />
          Sending encrypted signature…
        </p>
      )}

      {phase === 'sent' && (
        <div className="sign-mobile-done" role="status">
          <Check size={28} strokeWidth={2.5} aria-hidden />
          <h2>Sent to your computer</h2>
          <p className="muted">
            Keep the computer window open until the signature appears. You can close this tab.
          </p>
        </div>
      )}
    </div>
  )
}
