/**
 * Experiment: PDF annotation create + on-chain stream test + reconstruct.
 * PDF stays local; hash + annotation frames (≤64 B each) can go on Nimiq.
 */
import { Fingerprint, LoaderCircle, Upload } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { api } from '../api'
import { clampField, MAX_DISPLAY_NAME_LENGTH, MAX_TITLE_LENGTH } from '../fieldLimits'
import {
  annotationsWithoutImageBytes,
  bodyContainsPdfBytes,
  type PdfAnnotation,
} from '../pdf/annotations'
import { estimateStreamStats } from '../pdf/annotationStream'
import {
  buildFillBatch,
  collectKnownBlobIds,
  computePlanRoot,
  emptyPlan,
  lockPlan,
  newSlotId,
} from '../pdf/placements'
import {
  computeBatchRoot,
  expandMergedToAnnotations,
  mergePlacementBatches,
  packLockedPlan,
  packPlacementBatch,
  unpackPlacementBatch,
} from '../pdf/placementStream'
import { PdfAnnotator } from '../pdf/PdfAnnotator'
import { PdfReconstructor } from '../pdf/PdfReconstructor'
import { getPdfPageCount, sha256Hex, shortHash } from '../pdf/hashPdf'
import type { SealDocument } from '../types'
import type { UseJourneyWalletResult } from '../journey/useJourneyWallet'
import '../pdf/PdfAnnotator.css'
import '../journey/Journey.css'

export interface ExperimentDocumentJourneyProps {
  wallet: UseJourneyWalletResult
}

type Phase = 'create' | 'annotate' | 'created' | 'verify' | 'chain'

export function DocumentJourney({ wallet }: ExperimentDocumentJourneyProps) {
  const { token, address, connect, connecting, account } = wallet

  const [phase, setPhase] = useState<Phase>('create')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfHash, setPdfHash] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [title, setTitle] = useState('')
  const [creatorName, setCreatorName] = useState('')
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [doc, setDoc] = useState<SealDocument | null>(null)
  const [busy, setBusy] = useState(false)
  /** Shown while packing / broadcasting so long multi-tx publishes feel active. */
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastPostBody, setLastPostBody] = useState<unknown>(null)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyHash, setVerifyHash] = useState<string | null>(null)
  const [verifyAnnotations, setVerifyAnnotations] = useState<PdfAnnotation[] | null>(null)
  const [streamResult, setStreamResult] = useState<{
    frameCount: number
    payloadBytes: number
    txHashes: string[]
    onChain: boolean
    confirmedFrames?: number
    broadcastError?: string
    partialBroadcast?: boolean
    serviceWalletConfigured?: boolean
    broadcastEnabled?: boolean
  } | null>(null)
  const [chainRecon, setChainRecon] = useState<{
    source: 'index' | 'chain' | 'wire'
    annotations: PdfAnnotation[]
    frameCount: number
    txHashes: string[]
    onChain: boolean
    confirmedFrames?: number
    chainError?: string
    chainSampleOk?: boolean
    integrityOk?: boolean
  } | null>(null)
  /** Local-only v2 placement packer demo (plan lock + fill dedup). */
  const [placementDemo, setPlacementDemo] = useState<{
    planRoot: string
    planFrames: number
    fillFrames: number
    blobCount: number
    fillCount: number
    dedupSavedBlobs: number
    reconstructed: number
    batchRoot0: string
    batchRoot1: string
  } | null>(null)

  const streamPreview = useMemo(() => {
    if (!pdfHash || annotations.length === 0) return null
    try {
      return estimateStreamStats(pdfHash, annotations)
    } catch {
      return null
    }
  }, [pdfHash, annotations])

  const onPickPdf = useCallback(async (file: File | null) => {
    setError(null)
    setPdfFile(null)
    setPdfHash(null)
    setAnnotations([])
    setDoc(null)
    setStreamResult(null)
    setChainRecon(null)
    if (!file) return
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const hash = await sha256Hex(buf)
      const pages = await getPdfPageCount(file)
      setPdfFile(file)
      setPdfHash(hash)
      setPageCount(pages)
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ''))
      setPhase('annotate')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read PDF')
    } finally {
      setBusy(false)
    }
  }, [title])

  const createAnnotatedDocument = async () => {
    if (!token || !pdfFile || !pdfHash) {
      setError('Connect wallet and select a PDF first')
      return
    }
    if (!creatorName.trim()) {
      setError('Enter your name')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const body = {
        title: clampField(title || pdfFile.name.replace(/\.pdf$/i, ''), MAX_TITLE_LENGTH),
        originalFileName: pdfFile.name,
        type: 'other' as const,
        creatorRole: 'creator',
        creatorDisplayName: clampField(creatorName.trim(), MAX_DISPLAY_NAME_LENGTH),
        originalSha256: pdfHash,
        pageCount,
        requiredSignatures: 1,
        annotations,
      }

      if (bodyContainsPdfBytes(body)) {
        throw new Error('Refusing to send PDF bytes — annotations-only payload required')
      }
      setLastPostBody({
        ...body,
        annotations: annotationsWithoutImageBytes(annotations),
        _note: 'image payloads stripped for display; full annotations sent to API',
      })

      const { document, hashWarning } = await api.createDocument(token, body)
      if (hashWarning) setError(hashWarning)
      setDoc(document)
      setPhase('created')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const publishStream = async (broadcast: boolean) => {
    if (!token || !pdfHash || annotations.length === 0) {
      setError('Need wallet, PDF hash, and at least one annotation')
      return
    }
    const frameHint = streamPreview?.frameCount ?? '…'
    setBusy(true)
    setBusyLabel(
      broadcast
        ? `Publishing on-chain (~${frameHint} txs via service wallet)…`
        : `Packing stream (~${frameHint} frames)…`,
    )
    setError(null)
    try {
      const result = await api.publishAnnotationStream(token, {
        originalSha256: pdfHash,
        annotations,
        broadcast,
      })
      setStreamResult({
        frameCount: result.frameCount,
        payloadBytes: result.payloadBytes,
        txHashes: result.txHashes,
        onChain: result.onChain,
        confirmedFrames: result.confirmedFrames,
        broadcastError: result.broadcastError,
        partialBroadcast: result.partialBroadcast,
        serviceWalletConfigured: result.serviceWalletConfigured,
        broadcastEnabled: result.broadcastEnabled,
      })
      if (broadcast && !result.onChain && !result.broadcastError && result.txHashes.length === 0) {
        setError(
          'Publish returned without tx hashes. Check that ANNOTATION_STREAM_BROADCAST=true and SERVICE_WALLET_PRIVATE_KEY are set on the server.',
        )
      }
      if (result.broadcastError) {
        setError(result.broadcastError)
      }
      // Stay on annotate so pack/publish/edit remain available; "chain" is a status panel.
      if (phase === 'created' || phase === 'chain' || phase === 'verify') {
        setPhase(pdfFile ? 'annotate' : 'chain')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stream publish failed')
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }

  const startVerify = () => {
    setPhase('verify')
    setVerifyFile(null)
    setVerifyHash(null)
    setVerifyAnnotations(null)
    setChainRecon(null)
    setError(null)
  }

  const onVerifyPick = async (file: File | null) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const hash = await sha256Hex(buf)
      setVerifyFile(file)
      setVerifyHash(hash)

      // Prefer stream reconstruct-by-hash (index or chain)
      try {
        const recon = await api.reconstructAnnotationStream(hash)
        setChainRecon({
          source: recon.source,
          annotations: recon.annotations as PdfAnnotation[],
          frameCount: recon.frameCount,
          txHashes: recon.txHashes,
          onChain: recon.onChain,
          confirmedFrames: recon.confirmedFrames,
          chainError: recon.chainError,
          chainSampleOk: recon.chainSampleOk,
          integrityOk: recon.integrityOk,
        })
        setVerifyAnnotations(recon.annotations as PdfAnnotation[])
        // Soft note only — wire/index reconstruct still succeeds on RPC rate limits
        if (recon.chainError && recon.source === 'index' && recon.integrityOk === false) {
          setError(
            `Could not fully re-read chain (${recon.chainError}). Showing stored stream copy.`,
          )
        } else if (recon.chainError && recon.source === 'wire') {
          // Rate limit on optional HEAD/END sample — not fatal
          setError(null)
        }
        return
      } catch {
        /* fall back to document annotations if any */
      }

      if (doc && hash.toLowerCase() === doc.originalSha256.toLowerCase()) {
        const { document: fresh } = await api.getDocument(doc.id, token)
        setDoc(fresh)
        setVerifyAnnotations((fresh.annotations as PdfAnnotation[]) ?? [])
      } else {
        setError(
          `No annotation stream for hash ${shortHash(hash)}. Publish a stream first, or match a created document.`,
        )
        setVerifyAnnotations(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verify failed')
    } finally {
      setBusy(false)
    }
  }

  const postSummary = useMemo(() => {
    if (!lastPostBody || typeof lastPostBody !== 'object') return null
    const b = lastPostBody as Record<string, unknown>
    return {
      hasPdfBytes: bodyContainsPdfBytes(b),
      keys: Object.keys(b).filter(k => !k.startsWith('_')),
      annotationCount: Array.isArray(b.annotations) ? b.annotations.length : 0,
      originalSha256: b.originalSha256,
    }
  }, [lastPostBody])

  /**
   * Lab: lock a synthetic two-person plan and pack a fill where two signature
   * slots share one ink blob (dedup). Client-only — no server publish yet.
   */
  const runPlacementDemo = useCallback(async () => {
    if (!pdfHash) {
      setError('Select a PDF first (hash required for packer).')
      return
    }
    setError(null)
    setBusy(true)
    setBusyLabel('Packing placement plan + fill (v2)…')
    try {
      let plan = emptyPlan(pdfHash, 2)
      plan = {
        ...plan,
        people: [
          { slotIndex: 1, displayName: 'Tom' },
          { slotIndex: 2, displayName: 'Alex' },
        ],
        slots: [
          {
            id: newSlotId(),
            personSlotIndex: 1,
            kind: 'signature',
            pageIndex: 0,
            x: 0.1,
            y: 0.72,
            width: 0.35,
            height: 0.08,
          },
          {
            id: newSlotId(),
            personSlotIndex: 1,
            kind: 'name',
            pageIndex: 0,
            x: 0.1,
            y: 0.82,
            width: 0.35,
            height: 0.04,
          },
          {
            id: newSlotId(),
            personSlotIndex: 2,
            kind: 'signature',
            pageIndex: 0,
            x: 0.55,
            y: 0.72,
            width: 0.35,
            height: 0.08,
          },
        ],
      }
      const planRoot = await computePlanRoot(plan)
      const locked = lockPlan(plan, planRoot)
      const packed0 = await packLockedPlan(locked)
      const known = collectKnownBlobIds([packed0.batch])

      const inkPath = {
        epsilon: 1.5,
        lineWidthRatio: 0.02,
        strokes: [
          {
            points: Array.from({ length: 16 }, (_, i) => ({
              x: i / 15,
              y: 0.45 + 0.1 * Math.sin(i / 2),
            })),
          },
        ],
      }
      const sigSlots = locked.slots.filter(s => s.kind === 'signature')
      const nameSlot = locked.slots.find(s => s.kind === 'name')
      const fillBatch = await buildFillBatch({
        batchIndex: 1,
        prevRoot: packed0.batchRoot,
        pdfSha256: pdfHash,
        planRoot,
        knownBlobIds: known,
        fills: [
          ...sigSlots.map(s => ({
            slotId: s.id,
            personSlotIndex: s.personSlotIndex,
            payload: { kind: 'ink' as const, path: inkPath },
          })),
          ...(nameSlot
            ? [
                {
                  slotId: nameSlot.id,
                  personSlotIndex: nameSlot.personSlotIndex,
                  payload: { kind: 'text' as const, text: 'Tom Demo' },
                },
              ]
            : []),
        ],
      })
      const fillRoot = await computeBatchRoot(fillBatch)
      const fillWithRoot = { ...fillBatch, batchRoot: fillRoot }
      const fillFrames = packPlacementBatch(fillWithRoot)
      await unpackPlacementBatch(fillFrames)
      const merged = await mergePlacementBatches([
        { ...packed0.batch, batchRoot: packed0.batchRoot },
        fillWithRoot,
      ])
      const anns = expandMergedToAnnotations(merged)
      const withoutDedup = sigSlots.length + (nameSlot ? 1 : 0)
      setPlacementDemo({
        planRoot,
        planFrames: packed0.frames.length,
        fillFrames: fillFrames.length,
        blobCount: fillBatch.blobs.length,
        fillCount: fillBatch.fills.length,
        dedupSavedBlobs: withoutDedup - fillBatch.blobs.length,
        reconstructed: anns.length,
        batchRoot0: packed0.batchRoot,
        batchRoot1: fillRoot,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Placement demo failed')
      setPlacementDemo(null)
    } finally {
      setBusy(false)
      setBusyLabel(null)
    }
  }, [pdfHash])

  return (
    <div className="journey experiment-journey" style={{ padding: '1rem', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: '0 0 0.35rem', fontSize: '1.25rem' }}>
          Experiment · PDF annotations + chain stream
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
          Local pdf.js · RDP signatures · check/X marks · 64-byte Nimiq frames · reconstruct by hash
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>
          <a href="/pdf/lab" style={{ color: '#0f766e' }}>
            Signature encoding lab →
          </a>
          {' · '}
          <span className="muted">v2 placement: BLOB/PLACE/FILL + dedup (client packer)</span>
        </p>
      </header>

      {!account && (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={connecting}>
            {connecting ? <LoaderCircle className="spin" size={16} /> : null}
            Connect wallet to create / publish
          </button>
        </div>
      )}
      {address && (
        <p className="muted" style={{ fontSize: '0.8125rem' }}>
          Session: {address.slice(0, 12)}…
        </p>
      )}

      {error && (
        <p role="alert" style={{ color: '#b91c1c', fontSize: '0.875rem' }}>
          {error}
        </p>
      )}
      {busy && busyLabel && (
        <p role="status" style={{ color: '#0f766e', fontSize: '0.875rem', display: 'flex', gap: 8, alignItems: 'center' }}>
          <LoaderCircle className="spin" size={16} />
          {busyLabel}
        </p>
      )}

      {(phase === 'create' || phase === 'annotate') && (
        <section>
          <label className="btn btn-ghost" style={{ display: 'inline-flex', gap: 8, cursor: 'pointer' }}>
            <Upload size={16} />
            {pdfFile ? 'Replace PDF' : 'Select PDF (stays local)'}
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={e => void onPickPdf(e.target.files?.[0] ?? null)}
            />
          </label>
          {pdfHash && (
            <p className="muted" style={{ fontSize: '0.8125rem' }}>
              <Fingerprint size={14} style={{ verticalAlign: 'middle' }} />{' '}
              {shortHash(pdfHash)} · {pageCount} page{pageCount === 1 ? '' : 's'} · {pdfFile?.name}
            </p>
          )}
        </section>
      )}

      {phase === 'annotate' && pdfFile && (
        <section style={{ marginTop: '1rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1rem', maxWidth: 420 }}>
            <label>
              <span className="field-label">Title</span>
              <input
                className="field-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={MAX_TITLE_LENGTH}
              />
            </label>
            <label>
              <span className="field-label">Your name</span>
              <input
                className="field-input"
                value={creatorName}
                onChange={e => setCreatorName(e.target.value)}
                maxLength={MAX_DISPLAY_NAME_LENGTH}
                placeholder="Full name"
              />
            </label>
          </div>

          <PdfAnnotator file={pdfFile} annotations={annotations} onChange={setAnnotations} disabled={busy} />

          {streamPreview && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: '#f0fdfa',
                borderRadius: 8,
                fontSize: '0.8125rem',
              }}
            >
              <strong>Stream preview (local pack)</strong>
              <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem' }}>
                <li>
                  Payload {streamPreview.payloadBytes} B →{' '}
                  <strong>{streamPreview.frameCount} frames</strong> × 64 B (Nimiq data field)
                </li>
                <li>Slim ops: {streamPreview.slim.length} (PNG stripped; path/check/X/text only)</li>
              </ul>
            </div>
          )}

          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem',
              background: '#f8fafc',
              borderRadius: 8,
              fontSize: '0.8125rem',
              border: '1px solid rgba(15, 23, 42, 0.08)',
            }}
          >
            <strong>Placement construction v2 (local packer)</strong>
            <p className="muted" style={{ margin: '0.35rem 0' }}>
              Locks a Tom/Alex plan (sig+name slots), then packs a fill where both signature lines share one
              ink blob. No server call — validates BLOB/PLACE/FILL + dedup before journey UI.
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !pdfHash}
              onClick={() => void runPlacementDemo()}
            >
              Pack plan + fill (dedup demo)
            </button>
            {placementDemo && (
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
                <li>
                  planRoot <code>{shortHash(placementDemo.planRoot)}</code> · batch0{' '}
                  <code>{shortHash(placementDemo.batchRoot0)}</code> · batch1{' '}
                  <code>{shortHash(placementDemo.batchRoot1)}</code>
                </li>
                <li>
                  Frames: plan {placementDemo.planFrames} + fill {placementDemo.fillFrames} (v2, 64 B each)
                </li>
                <li>
                  Blobs on wire: <strong>{placementDemo.blobCount}</strong> · fills:{' '}
                  {placementDemo.fillCount} · dedup saved {placementDemo.dedupSavedBlobs} blob
                  {placementDemo.dedupSavedBlobs === 1 ? '' : 's'}
                </li>
                <li>Reconstructed paint ops: {placementDemo.reconstructed}</li>
              </ul>
            )}
          </div>

          {streamResult && pdfHash && (
            <div
              style={{
                marginTop: '1rem',
                padding: '0.75rem 1rem',
                background: streamResult.onChain ? '#ecfdf5' : '#fff7ed',
                border: '1px solid rgba(15, 23, 42, 0.08)',
                borderRadius: 10,
                fontSize: '0.875rem',
              }}
            >
              <strong>Last stream result</strong>
              <p style={{ margin: '0.35rem 0 0' }}>
                Hash <code>{shortHash(pdfHash)}</code> · {streamResult.frameCount} frames ·{' '}
                {streamResult.payloadBytes} B
              </p>
              <p style={{ margin: '0.25rem 0 0' }}>
                On-chain:{' '}
                {streamResult.onChain
                  ? 'yes (all frames confirmed)'
                  : streamResult.txHashes.length > 0
                    ? 'partial / incomplete'
                    : 'no (index only — safe to publish next)'}
                {streamResult.confirmedFrames != null && streamResult.txHashes.length > 0
                  ? ` · confirmed ${streamResult.confirmedFrames}/${streamResult.frameCount}`
                  : ''}
              </p>
              {streamResult.broadcastError && (
                <p style={{ color: '#b45309', margin: '0.35rem 0 0' }}>{streamResult.broadcastError}</p>
              )}
              {streamResult.txHashes.length > 0 && (
                <details style={{ marginTop: '0.5rem' }}>
                  <summary>Tx hashes ({streamResult.txHashes.length})</summary>
                  <ul style={{ fontSize: '0.75rem', margin: '0.35rem 0 0' }}>
                    {streamResult.txHashes.map(h => (
                      <li key={h}>
                        <code>{h}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !token || !pdfHash}
              onClick={() => void createAnnotatedDocument()}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              Create document (DB)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !token || !pdfHash || annotations.length === 0}
              onClick={() => void publishStream(false)}
            >
              Pack stream (index only)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy ||
                !token ||
                !pdfHash ||
                annotations.length === 0 ||
                Boolean(streamResult?.onChain)
              }
              onClick={() => void publishStream(true)}
              title={
                streamResult?.onChain
                  ? 'Already fully on-chain'
                  : 'Broadcast packed frames via service wallet (1 luna each)'
              }
            >
              {busy && busyLabel?.includes('on-chain') ? (
                <LoaderCircle className="spin" size={16} />
              ) : null}
              Publish stream on-chain
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={startVerify}>
              Reconstruct by hash…
            </button>
          </div>
        </section>
      )}

      {phase === 'created' && doc && (
        <section style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.05rem' }}>Document created</h2>
          <p>
            Slug: <code>{doc.slug}</code>
          </p>
          <p>
            Fingerprint: <code>{shortHash(doc.originalSha256)}</code>
          </p>
          <p>
            Server annotations: {(doc.annotations ?? []).length}
          </p>
          {postSummary && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.75rem',
                background: '#f8fafc',
                borderRadius: 8,
                fontSize: '0.8125rem',
              }}
            >
              <strong>POST body check</strong>
              <ul>
                <li>PDF bytes in body: {postSummary.hasPdfBytes ? 'YES (bug)' : 'no ✓'}</li>
                <li>Keys: {postSummary.keys.join(', ')}</li>
                <li>Annotations: {postSummary.annotationCount}</li>
              </ul>
            </div>
          )}
          {pdfFile && (doc.annotations?.length ?? 0) > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.95rem' }}>Local preview</h3>
              <PdfReconstructor file={pdfFile} annotations={doc.annotations ?? annotations} />
            </div>
          )}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !token}
              onClick={() => void publishStream(false)}
            >
              Pack stream (index)
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !token}
              onClick={() => void publishStream(true)}
            >
              Publish on-chain
            </button>
            <button type="button" className="btn btn-ghost" onClick={startVerify}>
              Reconstruct by hash
            </button>
          </div>
        </section>
      )}

      {phase === 'chain' && streamResult && pdfHash && (
        <section style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.05rem' }}>Annotation stream</h2>
          <p>
            Hash <code>{shortHash(pdfHash)}</code> · {streamResult.frameCount} frames ·{' '}
            {streamResult.payloadBytes} B payload
          </p>
          <p>
            On-chain: {streamResult.onChain ? 'yes (all frames confirmed)' : 'no / incomplete'}
            {streamResult.confirmedFrames != null
              ? ` · confirmed ${streamResult.confirmedFrames}/${streamResult.frameCount}`
              : ''}
            {streamResult.partialBroadcast ? ' · partial broadcast' : ''}
            {streamResult.serviceWalletConfigured === false
              ? ' — service wallet not configured'
              : ''}
            {streamResult.broadcastEnabled === false
              ? ' — broadcast disabled (ANNOTATION_STREAM_BROADCAST)'
              : ''}
          </p>
          {streamResult.broadcastError && (
            <p style={{ color: '#b45309', fontSize: '0.875rem' }}>{streamResult.broadcastError}</p>
          )}
          {streamResult.txHashes.length > 0 && (
            <div style={{ fontSize: '0.8125rem' }}>
              <strong>Tx hashes</strong>
              <ul>
                {streamResult.txHashes.map(h => (
                  <li key={h}>
                    <code>{h}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !token || annotations.length === 0 || streamResult.onChain}
              onClick={() => void publishStream(true)}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : null}
              {streamResult.onChain ? 'Already on-chain' : 'Publish stream on-chain'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !token || annotations.length === 0}
              onClick={() => void publishStream(false)}
            >
              Re-pack (index)
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError(null)
                setPhase('annotate')
              }}
            >
              ← Back to editor
            </button>
            <button type="button" className="btn btn-ghost" onClick={startVerify}>
              Reconstruct by hash
            </button>
          </div>
        </section>
      )}

      {phase === 'verify' && (
        <section style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.05rem' }}>Reconstruct by PDF hash</h2>
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            Drop the <strong>original</strong> PDF. We hash it locally, then fetch the annotation
            stream (from Nimiq when tx hashes exist, else server index) and overlay — never upload
            the file.
          </p>
          <label className="btn btn-ghost" style={{ display: 'inline-flex', gap: 8, cursor: 'pointer' }}>
            <Upload size={16} />
            Open original PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={e => void onVerifyPick(e.target.files?.[0] ?? null)}
            />
          </label>
          {verifyHash && (
            <p className="muted" style={{ fontSize: '0.8125rem' }}>
              Local hash {shortHash(verifyHash)}
              {chainRecon
                ? ` · source: ${chainRecon.source}${chainRecon.onChain ? ' (on-chain frames)' : ''}`
                : ''}
            </p>
          )}
          {chainRecon && (
            <p style={{ fontSize: '0.8125rem' }}>
              {chainRecon.annotations.length} annotations · {chainRecon.frameCount} frames
              {chainRecon.txHashes.length > 0
                ? ` · ${chainRecon.txHashes.length} txs`
                : ''}
              {chainRecon.integrityOk === false ? ' · integrity fallback' : ''}
            </p>
          )}
          {verifyFile && verifyAnnotations && (
            <PdfReconstructor file={verifyFile} annotations={verifyAnnotations} />
          )}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginTop: '0.75rem' }}
            onClick={() => {
              setPhase('create')
              setPdfFile(null)
              setPdfHash(null)
              setAnnotations([])
              setDoc(null)
              setVerifyFile(null)
              setVerifyAnnotations(null)
              setStreamResult(null)
              setChainRecon(null)
            }}
          >
            Start over
          </button>
        </section>
      )}
    </div>
  )
}

export default DocumentJourney
