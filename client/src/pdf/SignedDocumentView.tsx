/**
 * Read-only signed document: local file + placement fills / document annotations.
 * Used when an involved party verifies (or revisits Done) with their copy of the file.
 */
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { DocumentAnnotation } from '../types'
import type { PdfAnnotation } from './annotations'
import type { PlacementSlot } from './placements'
import { reconstructAnnotationsFromPlanAndFills } from './placementStream'
import { PdfReconstructor } from './PdfReconstructor'
import './PdfAnnotator.css'
import './SignedDocumentView.css'

function documentAnnsToPdf(anns: DocumentAnnotation[] | null | undefined): PdfAnnotation[] {
  if (!anns?.length) return []
  return anns.map(a => {
    if (a.type === 'signature') {
      return {
        id: a.id,
        type: 'signature' as const,
        pageIndex: a.pageIndex,
        x: a.x,
        y: a.y,
        width: a.width,
        height: a.height,
        imageDataUrl: a.imageDataUrl ?? '',
        ...(a.path ? { path: a.path } : {}),
      }
    }
    if (a.type === 'text') {
      return {
        id: a.id,
        type: 'text' as const,
        pageIndex: a.pageIndex,
        x: a.x,
        y: a.y,
        width: a.width,
        height: a.height,
        text: a.text,
        fontSizeRatio: a.fontSizeRatio,
        color: a.color,
      }
    }
    return {
      id: a.id,
      type: a.type,
      pageIndex: a.pageIndex,
      x: a.x,
      y: a.y,
      width: a.width,
      height: a.height,
      color: a.color,
    }
  })
}

export interface SignedDocumentViewProps {
  file: File
  /** PDF fingerprint (sha256 hex) used to load placement fills. */
  fingerprint: string | null | undefined
  /** Session token — required to unlock fill wire frames for parties. */
  authToken?: string | null
  /**
   * When false, only plain document pages are shown (no private overlays).
   * Involved parties pass true.
   */
  revealPrivate?: boolean
  /** Optional legacy document.annotations fallback. */
  documentAnnotations?: DocumentAnnotation[] | null
  pageWidth?: number
  className?: string
}

type LoadState = 'idle' | 'loading' | 'ready' | 'plain'

/**
 * Shows the local document with all recorded page fields (signatures, initials,
 * text, marks) overlaid when the viewer is an involved party and fill data exists.
 */
export function SignedDocumentView({
  file,
  fingerprint,
  authToken = null,
  revealPrivate = false,
  documentAnnotations = null,
  pageWidth = 560,
  className,
}: SignedDocumentViewProps) {
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // Public / non-party: never paint private ink — bare document only.
    if (!revealPrivate) {
      setAnnotations([])
      setLoadState('plain')
      setNote(null)
      return
    }

    const legacy = documentAnnsToPdf(documentAnnotations)
    const hash = (fingerprint ?? '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      setAnnotations(legacy)
      setLoadState(legacy.length > 0 ? 'ready' : 'plain')
      setNote(
        legacy.length > 0
          ? null
          : 'Document layout is not available for this fingerprint. Signature images still appear under Recorded signatures when present.',
      )
      return
    }

    setLoadState('loading')
    setNote(null)

    void (async () => {
      try {
        const planRes = await api.getPlacementPlan(hash, authToken)
        if (cancelled) return

        const slots: PlacementSlot[] = (planRes.plan?.slots ?? []).map(s => ({
          id: s.id,
          personSlotIndex: s.personSlotIndex,
          kind: (s.kind as PlacementSlot['kind']) || 'signature',
          pageIndex: s.pageIndex,
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
          ...(s.lockedContent ? { lockedContent: s.lockedContent } : {}),
        }))

        const fillBatches = planRes.fillBatches ?? []
        const hasFrames =
          planRes.fillPayloadRevealed === true &&
          fillBatches.some(b => Array.isArray(b.framesHex) && b.framesHex.length > 0)

        if (slots.length > 0 && hasFrames) {
          const { annotations: fromFills, filledCount } =
            await reconstructAnnotationsFromPlanAndFills({
              slots,
              fillBatches,
            })
          if (cancelled) return
          if (fromFills.length > 0) {
            setAnnotations(fromFills)
            setLoadState('ready')
            setNote(
              filledCount > 0
                ? 'Signed fields reconstructed on your local copy — read only.'
                : null,
            )
            return
          }
        }

        // Locked content only (marks / static text) when no fills yet
        if (slots.length > 0) {
          const { annotations: lockedOnly } = await reconstructAnnotationsFromPlanAndFills({
            slots,
            fillBatches: [],
          })
          if (cancelled) return
          if (lockedOnly.length > 0 || legacy.length > 0) {
            setAnnotations(lockedOnly.length > 0 ? lockedOnly : legacy)
            setLoadState('ready')
            setNote(
              filledCountMessage(planRes.filledSlotIds?.length ?? 0, hasFrames),
            )
            return
          }
        }

        if (legacy.length > 0) {
          setAnnotations(legacy)
          setLoadState('ready')
          setNote(null)
          return
        }

        setAnnotations([])
        setLoadState('plain')
        setNote(
          'No page-field layout is stored for this file. Your local copy is shown as-is; wallet signatures appear below when available.',
        )
      } catch {
        if (cancelled) return
        if (legacy.length > 0) {
          setAnnotations(legacy)
          setLoadState('ready')
          setNote(null)
        } else {
          setAnnotations([])
          setLoadState('plain')
          setNote(
            'Could not load field layout. Your local copy is shown as-is.',
          )
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [file, fingerprint, authToken, revealPrivate, documentAnnotations])

  return (
    <section
      className={className ?? 'signed-document-view'}
      aria-label="Signed document preview"
    >
      <header className="signed-document-view-head">
        <h3 className="signed-document-view-title">Signed document</h3>
        <p className="muted signed-document-view-lead">
          Your local file with recorded signatures, initials, and text fields. Read only — nothing
          leaves this device.
        </p>
      </header>
      {loadState === 'loading' && (
        <p className="pdf-annotator-hint">Building signed view…</p>
      )}
      {(loadState === 'ready' || loadState === 'plain') && (
        <PdfReconstructor
          file={file}
          annotations={annotations}
          pageWidth={pageWidth}
          className="signed-document-view-recon"
        />
      )}
      {note && (
        <p className="muted signed-document-view-note" role="status">
          {note}
        </p>
      )}
    </section>
  )
}

function filledCountMessage(filledSlots: number, hadFrames: boolean): string | null {
  if (filledSlots > 0 && !hadFrames) {
    return 'Field layout loaded, but fill payloads were not available for this session. Signature images still appear under Recorded signatures.'
  }
  if (filledSlots === 0) {
    return 'Field layout is set, but no page fills are recorded yet. Signature images appear under Recorded signatures when present.'
  }
  return null
}
