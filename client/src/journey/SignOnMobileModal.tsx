import { createPortal } from 'react-dom'
import { Check, Copy, LoaderCircle, Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  payloadToBlob,
  unpackEncrypted,
} from '../signatureHandoff/crypto'
import { qrDataUrl } from '../signatureHandoff/qr'
import {
  startHostPeer,
  type PeerSession,
} from '../signatureHandoff/webrtc'
import type { HostPhase } from '../signatureHandoff/types'

interface SignOnMobileModalProps {
  token: string
  documentId?: string
  open: boolean
  onClose: () => void
  onSignature: (blob: Blob) => void
}

const FALLBACK_POLL_MS = 1500
const WEBRTC_GIVE_UP_MS = 14_000

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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const [copied, setCopied] = useState(false)
  const [expiresLabel, setExpiresLabel] = useState<string | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const keyRef = useRef<CryptoKey | null>(null)
  const peerRef = useRef<PeerSession | null>(null)
  const fallbackTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const receivedRef = useRef(false)
  const mountedRef = useRef(true)

  const cleanupNet = useCallback(async (cancelRoom: boolean) => {
    if (fallbackTimer.current) {
      clearInterval(fallbackTimer.current)
      fallbackTimer.current = null
    }
    if (giveUpTimer.current) {
      clearTimeout(giveUpTimer.current)
      giveUpTimer.current = null
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
  }, [token])

  const applyEncrypted = useCallback(
    async (raw: string | { iv: string; ciphertext: string }) => {
      if (receivedRef.current || !keyRef.current || !sessionIdRef.current) return
      const pkg = typeof raw === 'string' ? unpackEncrypted(raw) : raw
      const payload = await decryptPayload(keyRef.current, sessionIdRef.current, pkg)
      const blob = payloadToBlob(payload)
      receivedRef.current = true
      if (!mountedRef.current) return
      const url = URL.createObjectURL(blob)
      setPreviewBlob(blob)
      setPreviewUrl(url)
      setPhase('received')
      peerRef.current?.stop()
      if (fallbackTimer.current) {
        clearInterval(fallbackTimer.current)
        fallbackTimer.current = null
      }
    },
    [],
  )

  const startSession = useCallback(async () => {
    setPhase('creating')
    setError(null)
    setQrUrl(null)
    setHandoffUrl(null)
    setPreviewBlob(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    receivedRef.current = false
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
            if (data) void applyEncrypted(data).catch(err => {
              if (mountedRef.current) {
                setError(err instanceof Error ? err.message : 'Could not read signature')
                setPhase('error')
              }
            })
          }
        },
        onStatus: s => {
          if (!mountedRef.current || receivedRef.current) return
          if (s === 'connecting') setPhase(p => (p === 'waiting' || p === 'creating' ? 'connecting' : p))
          if (s === 'connected') setPhase(p => (p === 'received' ? p : 'connected'))
        },
        onError: err => {
          // Non-fatal while fallback may still work
          console.warn('[sig-handoff]', err.message)
        },
      })

      // Poll encrypted deposit as fallback (and after WebRTC soft-fail)
      fallbackTimer.current = setInterval(() => {
        if (receivedRef.current || !sessionIdRef.current) return
        void takeDeposit(token, sessionIdRef.current)
          .then(pkg => {
            if (pkg) return applyEncrypted(pkg)
          })
          .catch(() => {
            /* no deposit yet */
          })
      }, FALLBACK_POLL_MS)

      giveUpTimer.current = setTimeout(() => {
        // WebRTC may still connect later; deposit remains primary fallback — no hard fail.
      }, WEBRTC_GIVE_UP_MS)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Could not start mobile sign')
      setPhase('error')
    }
  }, [token, documentId, cleanupNet, applyEncrypted, previewUrl])

  useEffect(() => {
    mountedRef.current = true
    if (open) void startSession()
    return () => {
      mountedRef.current = false
      void cleanupNet(true)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // Only re-run when open toggles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleClose = () => {
    void cleanupNet(true)
    setPhase('closed')
    onClose()
  }

  const handleUse = async () => {
    if (!previewBlob || !sessionIdRef.current) return
    try {
      await completeHandoff(token, sessionIdRef.current)
    } catch {
      /* still apply locally */
    }
    onSignature(previewBlob)
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
              ? 'Signature received — review below'
              : phase === 'error'
                ? error ?? 'Something went wrong'
                : ''

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
          Draw with your finger on your phone. Your computer keeps wallet identity and seals the
          fingerprint — the ink is end-to-end encrypted.
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

        {phase === 'received' && previewUrl && (
          <div className="sig-mobile-preview-wrap">
            <img className="sig-mobile-preview" src={previewUrl} alt="Signature from phone" />
          </div>
        )}

        <p className={`sig-mobile-status${phase === 'error' ? ' sig-mobile-status--error' : ''}`} role="status">
          {(phase === 'creating' || phase === 'waiting' || phase === 'connecting') && (
            <LoaderCircle className="btn-spinner" size={14} strokeWidth={2.25} aria-hidden />
          )}
          {phase === 'received' && <Check size={14} strokeWidth={2.5} aria-hidden />}
          {statusText}
        </p>

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
