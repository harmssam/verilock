/**
 * Desktop-only Nimiq Pay QR login: start room, show QR, poll with desktop secret.
 * Never encodes pollSecret into the QR (phone only gets public id).
 */
import { ChevronLeft, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api } from '../api'
import { isLoopbackAppOrigin, payLoginQrPayload } from '../nimiq'
import { qrDataUrl } from '../signatureHandoff/qr'
import { journeyDesktopChoiceLabels } from './journeyConnectUi'

const QR_POLL_MS = 1600

type QrPhase = 'loading' | 'waiting' | 'error'

interface DesktopPayQrPanelProps {
  onSession: (token: string, address: string) => void
  onBack: () => void
  onClose?: () => void
}

export function DesktopPayQrPanel({ onSession, onBack, onClose }: DesktopPayQrPanelProps) {
  const titleId = useId()
  const labels = journeyDesktopChoiceLabels()
  const [phase, setPhase] = useState<QrPhase>('loading')
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)

  const pollTimerRef = useRef<number | null>(null)
  const qrIdRef = useRef<string | null>(null)
  const pollSecretRef = useRef<string | null>(null)
  const startedRef = useRef(false)

  const clearPoll = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    clearPoll()
    qrIdRef.current = null
    pollSecretRef.current = null
  }, [clearPoll])

  const start = useCallback(async () => {
    if (isLoopbackAppOrigin()) {
      setPhase('error')
      setError(
        'Nimiq Pay QR login does not work on localhost - your phone cannot open this machine. Use Nimiq Hub, or try this on production.',
      )
      return
    }

    clearPoll()
    setPhase('loading')
    setError(null)
    setQrImage(null)

    try {
      const { id, pollSecret, expiresAt: exp } = await api.authQrStart()
      qrIdRef.current = id
      pollSecretRef.current = pollSecret
      const payload = payLoginQrPayload(id)
      if (payload.loopback) {
        setPhase('error')
        setError(
          'Nimiq Pay QR login does not work on localhost - your phone cannot open this machine. Use Nimiq Hub, or try this on production.',
        )
        return
      }
      setExpiresAt(exp)
      const dataUrl = await qrDataUrl(payload.qrText, 200)
      setQrImage(dataUrl)
      setPhase('waiting')

      pollTimerRef.current = window.setInterval(() => {
        const sid = qrIdRef.current
        const secret = pollSecretRef.current
        if (!sid || !secret) return
        void (async () => {
          try {
            const status = await api.authQrStatus(sid, secret)
            if (status.status === 'ready' && status.token && status.address) {
              stop()
              onSession(status.token, status.address)
              onClose?.()
              return
            }
            if (status.status === 'expired' || status.status === 'consumed') {
              stop()
              setPhase('error')
              setError(
                status.status === 'expired'
                  ? 'QR expired. Go back and try again.'
                  : 'This QR was already used. Go back and try again.',
              )
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : ''
            if (/expired|not found|already used|poll secret|401|429/i.test(msg)) {
              stop()
              setPhase('error')
              setError(
                /429|too many/i.test(msg)
                  ? 'Too many poll attempts - wait a moment and try again.'
                  : msg || 'QR login failed',
              )
            }
          }
        })()
      }, QR_POLL_MS)
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Could not start QR login')
    }
  }, [clearPoll, onClose, onSession, stop])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
    return () => {
      stop()
    }
  }, [start, stop])

  const expiresLabel =
    expiresAt != null
      ? `Expires ${new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : null

  return (
    <div className="login-sheet-qr" role="status" aria-live="polite">
      <button type="button" className="btn btn-ghost login-sheet-qr-back" onClick={onBack}>
        <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
        Back
      </button>
      <h3 id={titleId} className="login-sheet-sr-only">
        Scan with Nimiq Pay
      </h3>
      {phase === 'error' ? (
        <>
          <p className="login-sheet-qr-error" role="alert">
            {error}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void start()}>
            Try again
          </button>
        </>
      ) : (
        <>
          {qrImage ? (
            <img
              className="login-sheet-qr-img"
              src={qrImage}
              alt="Scan with Nimiq Pay on your phone"
              width={200}
              height={200}
            />
          ) : (
            <div className="login-sheet-qr-placeholder">
              <LoaderCircle className="btn-spinner" size={24} strokeWidth={2.5} aria-hidden />
            </div>
          )}
          <p className="muted login-sheet-qr-hint">{labels.payHint}</p>
          <p className="login-sheet-qr-wait">
            {phase === 'loading' ? 'Generating QR…' : labels.payBusy}
          </p>
          {expiresLabel && <p className="muted login-sheet-qr-expires">{expiresLabel}</p>}
        </>
      )}
    </div>
  )
}
