import { createPortal } from 'react-dom'
import { Check, Copy, LoaderCircle, Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { paintSignaturePath } from '../pdf/annotations'
import {
  cancelHandoff,
  completeHandoff,
  createHandoffSession,
  takeDeposit,
} from '../signatureHandoff/signalingClient'
import {
  decryptPayload,
  exportKeyB64url,
  generatePayloadKey,
  payloadToHandoffResult,
  unpackEncrypted,
} from '../signatureHandoff/crypto'
import { qrDataUrl } from '../signatureHandoff/qr'
import {
  startHostPeer,
  type PeerSession,
} from '../signatureHandoff/webrtc'
import type { HandoffInkResult, HostPhase } from '../signatureHandoff/types'

interface SignOnMobileModalProps {
  token: string
  documentId?: string
  open: boolean
  onClose: () => void
  /** Primary ink is vectors; PNG blob is optional convenience for wallet image. */
  onSignature: (result: HandoffInkResult) => void
}

const FALLBACK_POLL_MS = 1500
/** After this, surface a soft hint that the durable deposit path is still active. */
const DEPOSIT_HINT_MS = 12_000

export function SignOnMobileModal({
  token,
  documentId,
  open,
  onClose,
  onSignature,
}: SignOnMobileModalProps) {
  const [phase, setPhase] = useState<HostPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState<string | null>(null)
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null)
  const [received, setReceived] = useState<HandoffInkResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [expiresLabel, setExpiresLabel] = useState<string | null>(null)
  const [depositHint, setDepositHint] = useState(false)

  const sessionIdRef = useRef<string | null>(null)
  const keyRef = useRef<CryptoKey | null>(null)
  const peerRef = useRef<PeerSession | null>(null)
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const receivedRef = useRef(false)
  const applyingRef = useRef(false)
  const mountedRef = useRef(true)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const objectUrlRef = useRef<string | null>(null)

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
  }, [])

  const cleanupNet = useCallback(
    async (cancelRoom: boolean) => {
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current)
        fallbackTimer.current = null
      }
      if (hintTimer.current) {
        clearTimeout(hintTimer.current)
        hintTimer.current = null
      }
      peerRef.current?.stop()
      peerRef.current = null
      const sid = sessionIdRef.current
      if (cancelRoom && sid) {
        try {
          await cancelHandoff(token, sid)
        } catch {
          /* ignore */
        }
      }
    },
    [token],
  )

  const applyEncrypted = useCallback(
    async (raw: string | { iv: string; ciphertext: string }) => {
      if (receivedRef.current || !keyRef.current || !sessionIdRef.current) return
      const pkg = typeof raw === 'string' ? unpackEncrypted(raw) : raw
      const payload = await decryptPayload(keyRef.current, sessionIdRef.current, pkg)
      const result = payloadToHandoffResult(payload)
      receivedRef.current = true
      if (!mountedRef.current) return
      revokeObjectUrl()
      setReceived(result)
      setPhase('received')
      setDepositHint(false)
      peerRef.current?.stop()
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current)
        fallbackTimer.current = null
      }
      if (hintTimer.current) {
        clearTimeout(hintTimer.current)
        hintTimer.current = null
      }
    },
    [revokeObjectUrl],
  )

  const startSession = useCallback(async () => {
    setPhase('creating')
    setError(null)
    setQrUrl(null)
    setHandoffUrl(null)
    setReceived(null)
    setDepositHint(false)
    revokeObjectUrl()
    receivedRef.current = false
    applyingRef.current = false
    await cleanupNet(true)

    try {
      const key = await generatePayloadKey()
      keyRef.current = key
      const k = await exportKeyB64url(key)
      const room = await createHandoffSession(token, documentId)
      sessionIdRef.current = room.sessionId
      const url = `${window.location.origin}/m/sign/${room.sessionId}#k=${k}`
      setHandoffUrl(url)
      setExpiresLabel(new Date(room.expiresAt).toLocaleTimeString())
      const qr = await qrDataUrl(url, 240)
      if (!mountedRef.current) return
      setQrUrl(qr)
      setPhase('waiting')

      peerRef.current = startHostPeer({
        sessionId: room.sessionId,
        hostToken: token,
        onChannel: ch => {
          ch.onmessage = ev => {
            const data = typeof ev.data === 'string' ? ev.data : null
            if (!data || applyingRef.current || receivedRef.current) return
            applyingRef.current = true
            void applyEncrypted(data)
              .catch(err => {
                if (mountedRef.current) {
                  setError(err instanceof Error ? err.message : 'Could not read signature')
                  setPhase('error')
                }
              })
              .finally(() => {
                applyingRef.current = false
              })
          }
        },
        onStatus: s => {
          if (!mountedRef.current || receivedRef.current) return
          if (s === 'connecting') setPhase(p => (p === 'waiting' || p === 'creating' ? 'connecting' : p))
          if (s === 'connected') setPhase(p => (p === 'received' ? p : 'connected'))
        },
        onError: err => {
          console.warn('[sig-handoff]', err.message)
        },
      })

      fallbackTimer.current = setInterval(() => {
        if (receivedRef.current || applyingRef.current || !sessionIdRef.current) return
        applyingRef.current = true
        void (async () => {
          try {
            const pkg = await takeDeposit(token, sessionIdRef.current!)
            if (!pkg || receivedRef.current || !mountedRef.current) return
            await applyEncrypted(pkg)
          } catch (err) {
            if (!mountedRef.current || receivedRef.current) return
            const status = (err as Error & { status?: number }).status
            if (status === 404) return
            const message = err instanceof Error ? err.message : 'Could not read signature'
            if (/decrypt|tamper|payload|Invalid|mismatch|Outdated|Unsupported|Missing/i.test(message)) {
              setError(message)
              setPhase('error')
            }
          } finally {
            applyingRef.current = false
          }
        })()
      }, FALLBACK_POLL_MS)

      hintTimer.current = setTimeout(() => {
        if (!mountedRef.current || receivedRef.current) return
        setDepositHint(true)
      }, DEPOSIT_HINT_MS)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Could not start mobile sign')
      setPhase('error')
    }
  }, [token, documentId, cleanupNet, applyEncrypted, revokeObjectUrl])

  useEffect(() => {
    mountedRef.current = true
    if (open) void startSession()
    return () => {
      mountedRef.current = false
      void cleanupNet(true)
      revokeObjectUrl()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Paint vector preview when we have path but no PNG (or prefer path always as canvas)
  useEffect(() => {
    if (!received?.path?.strokes?.length || !previewCanvasRef.current) return
    const c = previewCanvasRef.current
    const w = 280
    const h = 100
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    c.style.width = `${w}px`
    c.style.height = `${h}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    paintSignaturePath(ctx, received.path, { left: 8, top: 8, width: w - 16, height: h - 16 })
  }, [received])

  const handleClose = () => {
    void cleanupNet(true)
    setPhase('closed')
    onClose()
  }

  const handleUse = async () => {
    if (!received || !sessionIdRef.current) return
    try {
      await completeHandoff(token, sessionIdRef.current)
    } catch {
      /* still apply locally */
    }
    onSignature(received)
    void cleanupNet(false)
    onClose()
  }

  const handleDiscard = () => {
    void startSession()
  }

  const handleCopy = async () => {
    if (!handoffUrl) return
    try {
      await navigator.clipboard.writeText(handoffUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy link')
    }
  }

  if (!open) return null

  const statusText =
    phase === 'creating'
      ? 'Preparing secure session…'
      : phase === 'waiting'
        ? 'Waiting for phone… scan the QR code'
        : phase === 'connecting'
          ? 'Phone connected — establishing private channel…'
          : phase === 'connected'
            ? 'Connected — draw and confirm on your phone'
            : phase === 'received'
              ? 'Signature received (vector ink) — review below'
              : phase === 'error'
                ? error ?? 'Something went wrong'
                : ''

  const previewImgUrl = received?.imageDataUrl || null

  const node = (
    <div className="login-sheet-layer sig-mobile-modal-layer" role="presentation">
      <button
        type="button"
        className="login-sheet-backdrop"
        aria-label="Close"
        onClick={handleClose}
      />
      <div
        className="login-sheet login-sheet--popover sig-mobile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sig-mobile-title"
      >
        <div className="sig-mobile-modal-head">
          <h2 id="sig-mobile-title" className="sig-mobile-modal-title">
            <Smartphone size={18} strokeWidth={2.25} aria-hidden />
            Sign on mobile
          </h2>
          <button type="button" className="btn btn-ghost sig-mobile-close" onClick={handleClose}>
            <X size={18} strokeWidth={2.25} aria-hidden />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <p className="muted sig-mobile-modal-lead">
          Draw with your finger on your phone. Strokes are sent as vectors (encrypted). Your computer
          keeps wallet identity.
        </p>

        {phase !== 'received' && (
          <div className="sig-mobile-qr-wrap">
            {qrUrl ? (
              <img className="sig-mobile-qr" src={qrUrl} alt="QR code to open signature pad on phone" />
            ) : (
              <div className="sig-mobile-qr-placeholder" aria-hidden>
                <LoaderCircle className="btn-spinner" size={28} strokeWidth={2.25} />
              </div>
            )}
          </div>
        )}

        {phase === 'received' && received && (
          <div className="sig-mobile-preview-wrap">
            {previewImgUrl ? (
              <img className="sig-mobile-preview" src={previewImgUrl} alt="Signature from phone" />
            ) : (
              <canvas ref={previewCanvasRef} className="sig-mobile-preview" aria-label="Signature from phone" />
            )}
          </div>
        )}

        <p
          className={`sig-mobile-status${phase === 'error' ? ' sig-mobile-status--error' : ''}`}
          role="status"
        >
          {(phase === 'creating' || phase === 'waiting' || phase === 'connecting') && (
            <LoaderCircle className="btn-spinner" size={14} strokeWidth={2.25} aria-hidden />
          )}
          {phase === 'received' && <Check size={14} strokeWidth={2.5} aria-hidden />}
          {statusText}
        </p>

        {depositHint && phase !== 'received' && phase !== 'error' && phase !== 'creating' && (
          <p className="muted sig-mobile-expires">
            Still waiting — keep this window open. Your phone can still deliver via the secure backup
            path.
          </p>
        )}

        {expiresLabel && phase !== 'received' && phase !== 'error' && (
          <p className="muted sig-mobile-expires">Session expires around {expiresLabel}</p>
        )}

        {handoffUrl && phase !== 'received' && (
          <div className="sig-mobile-link-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCopy()}>
              <Copy size={14} strokeWidth={2.25} aria-hidden />
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void startSession()}>
              New QR
            </button>
          </div>
        )}

        {phase === 'received' && (
          <div className="sig-mobile-actions">
            <button type="button" className="btn btn-primary" onClick={() => void handleUse()}>
              Use this signature
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleDiscard}>
              Discard &amp; retry
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div className="sig-mobile-actions">
            <button type="button" className="btn btn-primary" onClick={() => void startSession()}>
              Try again
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(node, document.body)
}

/** True when the primary surface is already a phone-sized touch device. */
export function isLikelyMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  const narrow = window.matchMedia('(max-width: 640px)').matches
  const coarse = window.matchMedia('(pointer: coarse)').matches
  return narrow && coarse
}
