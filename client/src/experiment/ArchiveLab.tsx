/**
 * /pdf2 — Hash-only archive lab (non-production demo).
 *
 * Drop a PDF → annotate → pack with 8-byte association id → optional multi-tx
 * broadcast → reconstruct by fingerprint alone (scan Nimiq or local wire).
 * Parallel to seal; does not charge credits.
 */
import { Database, Fingerprint, LoaderCircle, Radio, RefreshCw, Upload } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { api } from '../api'
import {
  associationIdHex,
  packLabArchive,
  type LabArchivePack,
} from '../pdf/labArchivePack'
import {
  expandStreamAnnotations,
  type StreamAnnotation,
} from '../pdf/annotationStream'
import { PdfAnnotator } from '../pdf/PdfAnnotator'
import { PdfReconstructor } from '../pdf/PdfReconstructor'
import type { PdfAnnotation } from '../pdf/annotations'
import { sha256Hex, shortHash } from '../pdf/hashPdf'
import type { UseJourneyWalletResult } from '../journey/useJourneyWallet'
import '../pdf/PdfAnnotator.css'
import './ArchiveLab.css'

export interface ArchiveLabProps {
  wallet: UseJourneyWalletResult
}

export function ArchiveLab({ wallet }: ArchiveLabProps) {
  const { token, address, connect, connecting } = wallet

  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfHash, setPdfHash] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [pack, setPack] = useState<LabArchivePack | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<{
    txHashes: string[]
    onChain: boolean
    confirmedFrames: number
    broadcastError?: string
    broadcastEnabled?: boolean
    serviceWalletConfigured?: boolean
    serviceWalletAddress?: string | null
  } | null>(null)
  const [recon, setRecon] = useState<{
    source: string
    frameCount: number
    integrityOk: boolean
    annotationCount: number
    peopleCount: number
    sigsCount: number
    scanMeta?: {
      scannedTxs: number
      truncated: boolean
      streamCount: number
      scanAddresses: string[]
    }
    chainError?: string
  } | null>(null)
  const [reconAnnotations, setReconAnnotations] = useState<PdfAnnotation[] | null>(null)

  const assoc = useMemo(
    () => (pdfHash ? associationIdHex(pdfHash) : null),
    [pdfHash],
  )

  const onPickPdf = useCallback(async (file: File | null) => {
    setError(null)
    setPdfFile(null)
    setPdfHash(null)
    setAnnotations([])
    setPack(null)
    setPublishResult(null)
    setRecon(null)
    setReconAnnotations(null)
    if (!file) return
    setBusy(true)
    setBusyLabel('Fingerprinting PDF…')
    try {
      const buf = await file.arrayBuffer()
      const hash = await sha256Hex(buf)
      setPdfFile(file)
      setPdfHash(hash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hash PDF')
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }, [])

  const doPack = useCallback(async () => {
    if (!pdfHash || annotations.length === 0) {
      setError('Add at least one annotation (signature/text) before packing')
      return
    }
    setBusy(true)
    setBusyLabel('Packing frames (8-byte association id)…')
    setError(null)
    try {
      const packed = await packLabArchive({
        pdfSha256: pdfHash,
        annotations,
        displayName: address ? `Wallet ${address.slice(0, 10)}…` : 'Lab signer',
        walletAddress: address,
      })
      setPack(packed)
      setPublishResult(null)
      setRecon(null)
      setReconAnnotations(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pack failed')
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }, [pdfHash, annotations, address])

  const doPublish = useCallback(async () => {
    if (!token) {
      setError('Connect a wallet to publish (service wallet still pays dust)')
      return
    }
    if (!pack) {
      setError('Pack frames first')
      return
    }
    setBusy(true)
    setBusyLabel(`Broadcasting ${pack.frameCount} frames to Nimiq…`)
    setError(null)
    try {
      const result = await api.labBroadcastFrames(token, {
        originalSha256: pack.pdfSha256,
        framesHex: pack.framesHex,
        broadcast: true,
      })
      setPublishResult({
        txHashes: result.txHashes,
        onChain: result.onChain,
        confirmedFrames: result.confirmedFrames,
        broadcastError: result.broadcastError,
        broadcastEnabled: result.broadcastEnabled,
        serviceWalletConfigured: result.serviceWalletConfigured,
        serviceWalletAddress: result.serviceWalletAddress,
      })
      if (result.broadcastError) setError(result.broadcastError)
      if (!result.onChain && result.txHashes.length === 0) {
        setError(
          result.broadcastError ||
            'No txs returned. Set ANNOTATION_STREAM_BROADCAST=true and SERVICE_WALLET_PRIVATE_KEY locally.',
        )
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Broadcast failed')
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }, [token, pack])

  const doReconstruct = useCallback(
    async (source: 'auto' | 'scan' | 'wire') => {
      if (!pdfHash) {
        setError('Load a PDF first')
        return
      }
      setBusy(true)
      setBusyLabel(
        source === 'scan'
          ? 'Scanning Nimiq by association id…'
          : source === 'wire'
            ? 'Unpacking stored lab frames…'
            : 'Reconstructing (auto)…',
      )
      setError(null)
      setRecon(null)
      setReconAnnotations(null)
      try {
        const result = await api.reconstructChainData(pdfHash, { source })
        const raw = result.unpacked.annotations ?? []
        // Wire/scan may return slim stream annotations (`t: 's'`) — expand for paint
        let paint: PdfAnnotation[] = []
        if (Array.isArray(raw) && raw.length > 0) {
          const first = raw[0] as Record<string, unknown>
          if (first && typeof first.t === 'string') {
            paint = expandStreamAnnotations(raw as StreamAnnotation[])
          } else {
            paint = raw as PdfAnnotation[]
          }
        }
        setReconAnnotations(paint.length > 0 ? paint : null)
        setRecon({
          source: result.source,
          frameCount: result.frameCount,
          integrityOk: result.integrityOk,
          annotationCount: paint.length,
          peopleCount: result.unpacked.manifest?.people?.length ?? 0,
          sigsCount: result.unpacked.manifest?.sigs?.length ?? 0,
          scanMeta: result.scanMeta,
          chainError: result.chainError,
        })
        if (result.chainError) setError(result.chainError)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Reconstruct failed')
      } finally {
        setBusy(false)
        setBusyLabel(null)
      }
    },
    [pdfHash],
  )

  return (
    <div className="archive-lab">
      <header className="archive-lab-head">
        <div>
          <p className="archive-lab-kicker">
            Lab · not production lock · <a href="/pdf">/pdf</a> · <strong>/pdf2</strong>
          </p>
          <h1>Hash-only archive demo</h1>
          <p className="muted archive-lab-lead">
            Fingerprint a PDF, pack signatures with an 8-byte association id, push frames to
            Nimiq (service wallet), then rebuild from the hash alone — no recovery file.
          </p>
        </div>
        <div className="archive-lab-wallet">
          {address ? (
            <span className="archive-lab-wallet-addr mono">{address}</span>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void connect()}
              disabled={connecting}
            >
              {connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="archive-lab-error" role="alert">
          {error}
        </p>
      )}
      {busy && busyLabel && (
        <p className="archive-lab-busy" role="status">
          <LoaderCircle className="archive-lab-spin" size={16} aria-hidden />
          {busyLabel}
        </p>
      )}

      <section className="archive-lab-card">
        <h2>
          <Upload size={18} aria-hidden /> 1. PDF
        </h2>
        <input
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={e => void onPickPdf(e.target.files?.[0] ?? null)}
        />
        {pdfHash && (
          <dl className="archive-lab-facts">
            <div>
              <dt>Fingerprint</dt>
              <dd className="mono">{pdfHash}</dd>
            </div>
            <div>
              <dt>Association id (8 bytes)</dt>
              <dd className="mono archive-lab-assoc">{assoc}</dd>
            </div>
            <div>
              <dt>File</dt>
              <dd>{pdfFile?.name}</dd>
            </div>
          </dl>
        )}
      </section>

      {pdfFile && pdfHash && (
        <section className="archive-lab-card">
          <h2>
            <Fingerprint size={18} aria-hidden /> 2. Annotate
          </h2>
          <p className="muted">
            Draw a signature or place text — same as /pdf. These become the on-chain payload.
          </p>
          <PdfAnnotator
            file={pdfFile}
            annotations={annotations}
            onChange={setAnnotations}
            disabled={busy}
          />
          <p className="muted archive-lab-ann-count">
            {annotations.length} annotation{annotations.length === 1 ? '' : 's'}
          </p>
        </section>
      )}

      {pdfHash && (
        <section className="archive-lab-card">
          <h2>
            <Database size={18} aria-hidden /> 3. Pack &amp; publish
          </h2>
          <div className="archive-lab-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || annotations.length === 0}
              onClick={() => void doPack()}
            >
              Pack locally
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !pack || !token}
              onClick={() => void doPublish()}
            >
              <Radio size={16} aria-hidden />
              Publish to Nimiq
            </button>
          </div>
          {pack && (
            <dl className="archive-lab-facts">
              <div>
                <dt>Frames</dt>
                <dd>
                  {pack.frameCount} ({pack.annotationFrames} annotation + {pack.manifestFrames}{' '}
                  manifest)
                </dd>
              </div>
              <div>
                <dt>Payload</dt>
                <dd>{pack.payloadBytes} bytes JSON (chunked)</dd>
              </div>
              <div>
                <dt>First frame assoc</dt>
                <dd className="mono">{pack.framesHex[0]?.slice(10, 26)}</dd>
              </div>
            </dl>
          )}
          {publishResult && (
            <div className="archive-lab-publish">
              <p>
                <strong>
                  {publishResult.onChain
                    ? 'On-chain'
                    : publishResult.txHashes.length
                      ? 'Partial / pending'
                      : 'Not on-chain'}
                </strong>
                {' · '}
                {publishResult.txHashes.length} tx
                {publishResult.confirmedFrames
                  ? ` · ${publishResult.confirmedFrames} confirmed`
                  : ''}
              </p>
              {publishResult.serviceWalletAddress && (
                <p className="muted mono">
                  Service wallet {publishResult.serviceWalletAddress}
                </p>
              )}
              {publishResult.txHashes.length > 0 && (
                <details>
                  <summary>Tx hashes ({publishResult.txHashes.length})</summary>
                  <ul className="archive-lab-hashes mono">
                    {publishResult.txHashes.map(h => (
                      <li key={h}>
                        <a
                          href={`https://nimiq.watch/#${h}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {shortHash(h, 10)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </section>
      )}

      {pdfHash && (
        <section className="archive-lab-card">
          <h2>
            <RefreshCw size={18} aria-hidden /> 4. Reconstruct by hash
          </h2>
          <p className="muted">
            Uses only the fingerprint. <code>scan</code> walks the <strong>service wallet</strong>{' '}
            (sender of our frames) for association id{' '}
            <span className="mono">{assoc}</span>. Lab rows never displace production archives.
          </p>
          <div className="archive-lab-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void doReconstruct('wire')}
            >
              From server index
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void doReconstruct('scan')}
            >
              Scan Nimiq (hash only)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void doReconstruct('auto')}
            >
              Auto
            </button>
          </div>
          {recon && (
            <dl className="archive-lab-facts">
              <div>
                <dt>Source</dt>
                <dd>
                  <code>{recon.source}</code>
                  {recon.integrityOk ? ' · integrity ok' : ' · integrity soft-fail'}
                </dd>
              </div>
              <div>
                <dt>Frames</dt>
                <dd>{recon.frameCount}</dd>
              </div>
              <div>
                <dt>Annotations / people / sigs</dt>
                <dd>
                  {recon.annotationCount} / {recon.peopleCount} / {recon.sigsCount}
                </dd>
              </div>
              {recon.scanMeta && (
                <div>
                  <dt>Scan</dt>
                  <dd>
                    {recon.scanMeta.scannedTxs} txs · {recon.scanMeta.streamCount} streams
                    {recon.scanMeta.truncated ? ' · truncated' : ''}
                  </dd>
                </div>
              )}
            </dl>
          )}
          {pdfFile && reconAnnotations && reconAnnotations.length > 0 && (
            <div className="archive-lab-recon-view">
              <h3>Painted from reconstruct</h3>
              <PdfReconstructor file={pdfFile} annotations={reconAnnotations} />
            </div>
          )}
        </section>
      )}

      <footer className="archive-lab-foot muted">
        Requires local/staging: <code>ANNOTATION_STREAM_BROADCAST=true</code> and a funded{' '}
        <code>SERVICE_WALLET_PRIVATE_KEY</code>. Not linked from the marketing home.
      </footer>
    </div>
  )
}
