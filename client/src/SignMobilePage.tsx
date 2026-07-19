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

function keyFromHash(): string | null {
  const hash = window.location.hash.replace(/^#/, '')
  const params = new URLSearchParams(hash)
  const k = params.get('k')
  if (k) return k
  if (hash.startsWith('k=')) return hash.slice(2)
  return null
}

/**
 * Focused mobile signature capture — no wallet, no PDF.
 * Sends unit-square stroke vectors (primary) + optional PNG preview, E2E encrypted.
 */
export function SignMobilePage() {
  const sessionId = parseSessionId(window.location.pathname)
  const [phase, setPhase] = useState<GuestPhase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [stroke, setStroke] = useState<SignatureStrokeResult | null>(null)
  const [padKey, setPadKey] = useState(0)

  const keyRef = useRef<CryptoKey | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const peerRef = useRef<PeerSession | null>(null)
  const channelOpenRef = useRef(false)

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
                setPhase(p => (p === 'sending' || p === 'sent' || p === 'preview' ? p : 'connected'))
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

  const goPreview = useCallback(() => {
    if (!stroke?.path?.strokes?.length) return
    setPhase('preview')
  }, [stroke])

  const send = useCallback(async () => {
    if (!stroke?.path?.strokes?.length || !sessionId || !keyRef.current) return
    setPhase('sending')
    setError(null)
    try {
      const payload = strokeResultToPayload(
        sessionId,
        stroke.path,
        stroke.imageDataUrl || undefined,
      )
      const pkg = await encryptPayload(keyRef.current, sessionId, payload)
      const packed = packEncrypted(pkg)

      // Best-effort P2P for lower latency — never the sole delivery path.
      const ch = channelRef.current
      if (ch && (ch.readyState === 'open' || channelOpenRef.current)) {
        try {
          if (ch.readyState !== 'open') await waitForChannelOpen(ch, 4000)
          sendOnChannel(ch, packed)
        } catch {
          /* deposit below is durable */
        }
      }

      // Always deposit ciphertext so the host can retrieve even if WebRTC drops.
      await depositEncrypted(sessionId, pkg)

      setPhase('sent')
      peerRef.current?.stop()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send signature')
      setPhase('error')
    }
  }, [stroke, sessionId])

  const redraw = () => {
    setStroke(null)
    setPadKey(k => k + 1)
    setPhase(channelOpenRef.current ? 'connected' : 'ready')
    setError(null)
  }

  return (
    <div className="sign-mobile-page">
      <header className="sign-mobile-header">
        <p className="sign-mobile-kicker">VeriLock</p>
        <h1 className="sign-mobile-title">Draw your signature</h1>
        <p className="sign-mobile-sub muted">
          Strokes are sent as vectors to your computer (encrypted). Wallet signing stays on the
          computer.
        </p>
      </header>

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
        </div>
      )}

      {(phase === 'ready' || phase === 'connecting' || phase === 'connected') && (
        <>
          <SignatureStrokePad
            key={padKey}
            productMode
            label="Sign here"
            onChange={result => setStroke(result)}
          />
          <div className="sign-mobile-dock">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={!stroke?.path?.strokes?.length}
              onClick={goPreview}
            >
              Preview
            </button>
            <p className="muted sign-mobile-dock-hint">
              {phase === 'connected'
                ? 'Private channel ready'
                : 'You can confirm even if the channel is still connecting'}
            </p>
          </div>
        </>
      )}

      {phase === 'preview' && stroke && (
        <div className="sign-mobile-preview-block">
          {stroke.imageDataUrl ? (
            <img
              className="sign-mobile-preview-img"
              src={stroke.imageDataUrl}
              alt="Your signature preview"
            />
          ) : (
            <p className="muted">Signature ready ({stroke.simplifiedPoints} points)</p>
          )}
          <div className="sign-mobile-dock">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void send()}>
              Confirm &amp; send
            </button>
            <button type="button" className="btn btn-secondary" onClick={redraw}>
              Redraw
            </button>
          </div>
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
            Keep the computer window open. Review the signature there and continue with wallet sign.
            You can close this tab once it appears on the computer.
          </p>
        </div>
      )}
    </div>
  )
}
