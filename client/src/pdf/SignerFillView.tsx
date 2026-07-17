/**
 * DocuSign-style signing: the PDF is the surface. Click your highlighted fields
 * on the page to type or draw; others’ fields stay dim and non-interactive.
 */
import { Check, ChevronLeft, ChevronRight, PenLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  type BlobPayload,
  type ConstructionPlan,
  type PlacementSlot,
} from './placements'
import {
  normalizedToCanvasRect,
  paintMark,
  paintSignaturePath,
  type SignaturePathData,
} from './annotations'
import { loadPdfFromFile, renderPageToCanvas } from './pdfDocument'
import {
  SignatureStrokePad,
  type SignatureStrokeResult,
} from './SignatureStrokePad'
import './PdfAnnotator.css'
import './SignerFillView.css'

const PERSON_COLORS = ['#0f766e', '#b45309', '#1d4ed8', '#7c3aed'] as const

function personColor(slotIndex: number): string {
  return PERSON_COLORS[(Math.max(1, slotIndex) - 1) % PERSON_COLORS.length]!
}

export interface SignerFillResult {
  personSlotIndex: number
  fills: Array<{ slotId: string; personSlotIndex: number; payload: BlobPayload }>
  inkPath?: SignaturePathData
  /** PNG data URL for wallet signature image (from last draw). */
  signatureImageDataUrl?: string
  printedName?: string
}

export interface SignerFillViewProps {
  file: File
  plan: ConstructionPlan
  personSlotIndex: number
  disabled?: boolean
  busy?: boolean
  filledSlotIds?: ReadonlySet<string>
  onSubmit: (result: SignerFillResult) => void | Promise<void>
  pageWidth?: number
}

type LocalFill =
  | { kind: 'ink'; path: SignaturePathData; imageDataUrl?: string }
  | { kind: 'text'; text: string }

export function SignerFillView({
  file,
  plan,
  personSlotIndex,
  disabled = false,
  busy = false,
  filledSlotIds,
  onSubmit,
  pageWidth = 640,
}: SignerFillViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [cssSize, setCssSize] = useState({ width: pageWidth, height: pageWidth * 1.3 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Local drafts for my fillable slots (not yet submitted). */
  const [localFills, setLocalFills] = useState<Record<string, LocalFill>>({})
  /** Shared ink reused across signature slots when user draws once. */
  const [sharedInk, setSharedInk] = useState<SignatureStrokeResult | null>(null)
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const person =
    plan.people.find(p => p.slotIndex === personSlotIndex) ?? {
      slotIndex: personSlotIndex,
      displayName: `Person ${personSlotIndex}`,
    }
  const color = personColor(personSlotIndex)

  const myFillable = useMemo(
    () =>
      plan.slots.filter(
        s =>
          s.personSlotIndex === personSlotIndex &&
          (s.kind === 'signature' || s.kind === 'name' || s.kind === 'text'),
      ),
    [plan.slots, personSlotIndex],
  )

  const isServerFilled = useCallback(
    (id: string) => Boolean(filledSlotIds?.has(id)),
    [filledSlotIds],
  )

  const isLocallyFilled = useCallback(
    (slot: PlacementSlot) => {
      if (isServerFilled(slot.id)) return true
      const f = localFills[slot.id]
      if (!f) {
        // Signature can inherit shared ink
        if (slot.kind === 'signature' && sharedInk?.path?.strokes?.length) return true
        return false
      }
      if (f.kind === 'ink') return Boolean(f.path.strokes?.length)
      return f.text.trim().length > 0
    },
    [localFills, sharedInk, isServerFilled],
  )

  const pendingSlots = useMemo(
    () => myFillable.filter(s => !isLocallyFilled(s) && !isServerFilled(s.id)),
    [myFillable, isLocallyFilled, isServerFilled],
  )

  const allMyFilled =
    myFillable.length > 0 && myFillable.every(s => isLocallyFilled(s) || isServerFilled(s.id))

  const allAlreadyOnServer =
    myFillable.length > 0 && myFillable.every(s => isServerFilled(s.id))

  // Jump to first page with a pending field
  useEffect(() => {
    if (pendingSlots.length === 0) return
    const first = pendingSlots[0]!
    setPageNumber(first.pageIndex + 1)
  }, [personSlotIndex]) // only on person change

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    loadPdfFromFile(file)
      .then(pdf => {
        if (cancelled) {
          void pdf.destroy()
          return
        }
        setDoc(pdf)
        setPageCount(pdf.numPages)
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not open PDF')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    if (!doc || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    renderPageToCanvas(doc, pageNumber, pageWidth, canvas)
      .then(rendered => {
        if (cancelled) return
        setCssSize({ width: rendered.cssWidth, height: rendered.cssHeight })
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not render page')
      })
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, pageWidth])

  const pageSlots = useMemo(
    () => plan.slots.filter(s => s.pageIndex === pageNumber - 1),
    [plan.slots, pageNumber],
  )

  const activeSlot = activeSlotId
    ? plan.slots.find(s => s.id === activeSlotId) ?? null
    : null

  const openSlot = (slot: PlacementSlot) => {
    if (disabled || busy || submitting) return
    if (slot.personSlotIndex !== personSlotIndex) return
    if (slot.kind === 'checkmark' || slot.kind === 'cross') return
    if (isServerFilled(slot.id)) return
    setActiveSlotId(slot.id)
    setLocalError(null)
    if (slot.pageIndex !== pageNumber - 1) {
      setPageNumber(slot.pageIndex + 1)
    }
  }

  const applySharedInkToAllSigs = (result: SignatureStrokeResult) => {
    setSharedInk(result)
    setLocalFills(prev => {
      const next = { ...prev }
      for (const s of myFillable) {
        if (s.kind === 'signature' && !isServerFilled(s.id)) {
          next[s.id] = {
            kind: 'ink',
            path: result.path,
            imageDataUrl: result.imageDataUrl,
          }
        }
      }
      return next
    })
  }

  const setTextForSlot = (slotId: string, text: string) => {
    setLocalFills(prev => ({
      ...prev,
      [slotId]: { kind: 'text', text },
    }))
  }

  const goNextPending = () => {
    const pending = myFillable.filter(s => !isLocallyFilled(s) && !isServerFilled(s.id))
    if (pending.length === 0) {
      setActiveSlotId(null)
      return
    }
    // Prefer next after active
    let idx = pending.findIndex(s => s.id === activeSlotId)
    const next = pending[(idx >= 0 ? idx + 1 : 0) % pending.length]!
    setActiveSlotId(next.id)
    setPageNumber(next.pageIndex + 1)
  }

  const previewForSlot = (slot: PlacementSlot): LocalFill | null => {
    if (localFills[slot.id]) return localFills[slot.id]!
    if (slot.kind === 'signature' && sharedInk?.path) {
      return {
        kind: 'ink',
        path: sharedInk.path,
        imageDataUrl: sharedInk.imageDataUrl,
      }
    }
    return null
  }

  const handleFinish = useCallback(async () => {
    setLocalError(null)
    const fills: SignerFillResult['fills'] = []
    let printedName: string | undefined
    let inkPath: SignaturePathData | undefined
    let imageDataUrl: string | undefined

    for (const slot of myFillable) {
      if (isServerFilled(slot.id)) continue
      const draft = previewForSlot(slot)
      if (!draft) {
        setLocalError('Complete all of your highlighted fields on the PDF.')
        setActiveSlotId(slot.id)
        setPageNumber(slot.pageIndex + 1)
        return
      }
      if (draft.kind === 'ink') {
        if (!draft.path.strokes?.length) {
          setLocalError('Draw your signature in each signature box.')
          setActiveSlotId(slot.id)
          setPageNumber(slot.pageIndex + 1)
          return
        }
        fills.push({
          slotId: slot.id,
          personSlotIndex,
          payload: { kind: 'ink', path: draft.path },
        })
        inkPath = draft.path
        if (draft.imageDataUrl) imageDataUrl = draft.imageDataUrl
      } else {
        const t = draft.text.trim()
        if (!t) {
          setLocalError('Fill in every text box assigned to you.')
          setActiveSlotId(slot.id)
          setPageNumber(slot.pageIndex + 1)
          return
        }
        fills.push({
          slotId: slot.id,
          personSlotIndex,
          payload: {
            kind: 'text',
            text: t,
            fontSizeRatio: slot.kind === 'name' ? 0.025 : 0.022,
          },
        })
        if (slot.kind === 'name' && !printedName) printedName = t
      }
    }

    if (fills.length === 0) {
      // No fillable slots (or already on server) — continue to parent wallet bind.
      setSubmitting(true)
      try {
        await onSubmit({
          personSlotIndex,
          fills: [],
          printedName,
        })
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Could not continue')
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        personSlotIndex,
        fills,
        inkPath,
        signatureImageDataUrl: imageDataUrl,
        printedName,
      })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save signature')
    } finally {
      setSubmitting(false)
    }
  }, [
    myFillable,
    personSlotIndex,
    onSubmit,
    allAlreadyOnServer,
    isServerFilled,
    localFills,
    sharedInk,
  ])

  const remaining = pendingSlots.length
  const nextHint = pendingSlots[0]

  return (
    <div className={`signer-fill-view${disabled ? ' is-disabled' : ''}`}>
      <header className="signer-fill-head" style={{ ['--person-color' as string]: color }}>
        <div className="signer-fill-head-row">
          <h3>
            Sign as <strong>{person.displayName || `Person ${personSlotIndex}`}</strong>
          </h3>
          {remaining > 0 ? (
            <span className="signer-fill-remaining">
              {remaining} field{remaining === 1 ? '' : 's'} left
            </span>
          ) : (
            <span className="signer-fill-remaining is-done">
              <Check size={14} strokeWidth={2.5} aria-hidden /> Ready to finish
            </span>
          )}
        </div>
        <p className="muted signer-fill-help">
          Tap each <strong>highlighted</strong> box on the PDF to sign or type. Other people&apos;s
          fields stay locked until they sign.
        </p>
      </header>

      {allAlreadyOnServer ? (
        <p className="signer-fill-done">
          <Check size={16} strokeWidth={2.5} aria-hidden /> Your page fields are already saved.
        </p>
      ) : null}

      <div className="signer-fill-toolbar">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber(p => Math.max(1, p - 1))}
        >
          <ChevronLeft size={16} aria-hidden /> Prev
        </button>
        <span className="signer-fill-page-label">
          Page {pageNumber} / {pageCount}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pageNumber >= pageCount}
          onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))}
        >
          Next <ChevronRight size={16} aria-hidden />
        </button>
        {nextHint && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setActiveSlotId(nextHint.id)
              setPageNumber(nextHint.pageIndex + 1)
            }}
          >
            Next field
          </button>
        )}
      </div>

      <div className="signer-fill-stage-wrap">
        <div className="pdf-annotator-stage signer-fill-stage">
          {loading && <p className="pdf-annotator-hint">Loading PDF…</p>}
          {loadError && <p className="pdf-annotator-hint">{loadError}</p>}
          <div className="pdf-annotator-page-wrap" style={{ width: cssSize.width }}>
            <canvas ref={canvasRef} />
            <div className="pdf-annotator-layer signer-fill-layer">
              {pageSlots.map(slot => {
                const mine = slot.personSlotIndex === personSlotIndex
                const serverDone = isServerFilled(slot.id)
                const draft = mine ? previewForSlot(slot) : null
                const isActive = activeSlotId === slot.id
                const r = normalizedToCanvasRect(slot, cssSize.width, cssSize.height)
                const slotColor = personColor(slot.personSlotIndex)
                const clickable =
                  mine &&
                  !serverDone &&
                  !disabled &&
                  (slot.kind === 'signature' || slot.kind === 'name' || slot.kind === 'text')

                return (
                  <button
                    key={slot.id}
                    type="button"
                    className={[
                      'signer-fill-field',
                      mine ? 'is-mine' : 'is-theirs',
                      serverDone || draft ? 'is-complete' : '',
                      isActive ? 'is-active' : '',
                      clickable ? 'is-clickable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                      ['--person-color' as string]: slotColor,
                    }}
                    disabled={!clickable}
                    onClick={() => openSlot(slot)}
                    aria-label={
                      mine
                        ? `${slot.kind} field${serverDone || draft ? ' (filled)' : ' (tap to fill)'}`
                        : `Reserved for person ${slot.personSlotIndex}`
                    }
                  >
                    {slot.kind === 'checkmark' || slot.kind === 'cross' ? (
                      <MarkCanvas
                        kind={slot.lockedContent?.mark ?? slot.kind}
                        color={slot.lockedContent?.color ?? slotColor}
                        width={r.width}
                        height={r.height}
                      />
                    ) : draft?.kind === 'ink' ? (
                      <InkPreview path={draft.path} width={r.width} height={r.height} />
                    ) : draft?.kind === 'text' ? (
                      <span className="signer-fill-field-value">{draft.text}</span>
                    ) : mine && !serverDone ? (
                      <span className="signer-fill-field-cta">
                        {slot.kind === 'signature'
                          ? 'Sign here'
                          : slot.kind === 'name'
                            ? 'Type name'
                            : slot.lockedContent?.text?.trim() || 'Type here'}
                      </span>
                    ) : serverDone && mine ? (
                      <span className="signer-fill-field-cta is-saved">Saved</span>
                    ) : (
                      <span className="signer-fill-field-cta is-theirs-label">
                        {plan.people.find(p => p.slotIndex === slot.personSlotIndex)?.displayName ||
                          `Person ${slot.personSlotIndex}`}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* In-context editor for the active field */}
      {activeSlot &&
        activeSlot.personSlotIndex === personSlotIndex &&
        !isServerFilled(activeSlot.id) && (
          <div
            className="signer-fill-popover"
            style={{ ['--person-color' as string]: color }}
            role="dialog"
            aria-label="Fill field"
          >
            <div className="signer-fill-popover-head">
              <strong>
                {activeSlot.kind === 'signature'
                  ? 'Draw your signature'
                  : activeSlot.kind === 'name'
                    ? 'Type your name'
                    : activeSlot.lockedContent?.text?.trim() || 'Enter text'}
              </strong>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setActiveSlotId(null)}
              >
                Close
              </button>
            </div>

            {activeSlot.kind === 'signature' ? (
              <>
                <SignatureStrokePad
                  onChange={result => {
                    if (!result) {
                      setSharedInk(null)
                      setLocalFills(prev => {
                        const next = { ...prev }
                        delete next[activeSlot.id]
                        return next
                      })
                      return
                    }
                    applySharedInkToAllSigs(result)
                  }}
                  disabled={disabled || busy || submitting}
                />
                <p className="muted" style={{ margin: 0, fontSize: '0.78rem' }}>
                  This signature is applied to all of your signature boxes on the document.
                </p>
              </>
            ) : (
              <input
                className="field-input signer-fill-inline-input"
                autoFocus
                value={
                  localFills[activeSlot.id]?.kind === 'text'
                    ? (localFills[activeSlot.id] as { text: string }).text
                    : ''
                }
                onChange={e => setTextForSlot(activeSlot.id, e.target.value.slice(0, 200))}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    goNextPending()
                  }
                }}
                placeholder={
                  activeSlot.kind === 'name'
                    ? 'Full name'
                    : activeSlot.lockedContent?.text?.trim() || 'Type here'
                }
                maxLength={200}
                disabled={disabled || busy || submitting}
              />
            )}

            <div className="signer-fill-popover-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => goNextPending()}
                disabled={
                  activeSlot.kind === 'signature'
                    ? !sharedInk?.path?.strokes?.length
                    : !(
                        localFills[activeSlot.id]?.kind === 'text' &&
                        (localFills[activeSlot.id] as { text: string }).text.trim()
                      )
                }
              >
                {remaining <= 1 ? 'Done with fields' : 'Next field'}
              </button>
            </div>
          </div>
        )}

      {localError && (
        <p className="signer-fill-error" role="alert">
          {localError}
        </p>
      )}

      <div className="signer-fill-footer">
        <button
          type="button"
          className={`btn btn-primary btn-lg${submitting || busy ? ' btn--busy' : ''}`}
          disabled={
            disabled ||
            busy ||
            submitting ||
            (myFillable.length > 0 && !allMyFilled && !allAlreadyOnServer)
          }
          onClick={() => void handleFinish()}
        >
          <PenLine size={18} strokeWidth={2.25} aria-hidden />
          {submitting || busy
            ? 'Saving…'
            : myFillable.length === 0 || allAlreadyOnServer
              ? 'Continue'
              : 'Finish & save my fields'}
        </button>
        {myFillable.length === 0 && (
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            No page fields were assigned to you — continue with wallet sign only.
          </p>
        )}
      </div>
    </div>
  )
}

function MarkCanvas({
  kind,
  color,
  width,
  height,
}: {
  kind: 'checkmark' | 'cross'
  color: string
  width: number
  height: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(1, Math.round(width * dpr))
    c.height = Math.max(1, Math.round(height * dpr))
    c.style.width = `${width}px`
    c.style.height = `${height}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paintMark(ctx, kind, { left: 0, top: 0, width, height }, color)
  }, [kind, color, width, height])
  return <canvas ref={ref} className="signer-fill-mark" aria-hidden />
}

function InkPreview({
  path,
  width,
  height,
}: {
  path: SignaturePathData
  width: number
  height: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.max(1, Math.round(width * dpr))
    c.height = Math.max(1, Math.round(height * dpr))
    c.style.width = `${width}px`
    c.style.height = `${height}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    paintSignaturePath(ctx, path, { left: 0, top: 0, width, height })
  }, [path, width, height])
  return <canvas ref={ref} className="signer-fill-ink-preview" aria-hidden />
}
