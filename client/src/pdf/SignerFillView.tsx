/**
 * DocuSign-style signing: the document (PDF or image) is the surface.
 * Click your highlighted fields to open a modal; ink is reused across signature boxes.
 */
import { Check, ChevronLeft, ChevronRight, PenLine, Smartphone, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FEATURES } from '../features'
import { SignOnMobileModal, isLikelyMobileViewport } from '../journey/SignOnMobileModal'
import {
  type BlobPayload,
  type ConstructionPlan,
  type PlacementSlot,
  isInkPlacementKind,
} from './placements'
import {
  normalizedToCanvasRect,
  paintMark,
  paintSignaturePath,
  type SignaturePathData,
} from './annotations'
import { loadDocumentSurface, type DocumentSurface } from './documentSurface'
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

function inkFromLocal(
  path: SignaturePathData,
  imageDataUrl?: string,
): SignatureStrokeResult {
  return {
    path,
    imageDataUrl: imageDataUrl ?? '',
    rawPoints: 0,
    simplifiedPoints: 0,
    epsilon: path.epsilon ?? 1.5,
  }
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
  /** Session token for cross-device Sign on mobile (vector handoff). */
  authToken?: string | null
  documentId?: string | null
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
  authToken = null,
  documentId = null,
}: SignerFillViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modalPanelRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<DocumentSurface | null>(null)
  const [surface, setSurface] = useState<DocumentSurface | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [cssSize, setCssSize] = useState({ width: pageWidth, height: pageWidth * 1.3 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Local drafts for my fillable slots (not yet submitted). */
  const [localFills, setLocalFills] = useState<Record<string, LocalFill>>({})
  /** Shared full signature ink (reused across signature slots). */
  const [sharedInk, setSharedInk] = useState<SignatureStrokeResult | null>(null)
  /** Shared initials ink (reused across initial slots only). */
  const [sharedInitials, setSharedInitials] = useState<SignatureStrokeResult | null>(null)
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null)
  /** reuse = show saved stroke; draw = stroke pad */
  const [sigModalMode, setSigModalMode] = useState<'reuse' | 'draw'>('draw')
  const [modalDraftInk, setModalDraftInk] = useState<SignatureStrokeResult | null>(null)
  const [modalDraftText, setModalDraftText] = useState('')
  const [sigPadKey, setSigPadKey] = useState(0)
  const [localError, setLocalError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [signOnMobileOpen, setSignOnMobileOpen] = useState(false)

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
          (s.kind === 'signature' ||
            s.kind === 'initial' ||
            s.kind === 'name' ||
            s.kind === 'text'),
      ),
    [plan.slots, personSlotIndex],
  )

  const mySignatureSlots = useMemo(
    () => myFillable.filter(s => s.kind === 'signature'),
    [myFillable],
  )

  const myInitialSlots = useMemo(
    () => myFillable.filter(s => s.kind === 'initial'),
    [myFillable],
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
        if (slot.kind === 'signature' && sharedInk?.path?.strokes?.length) return true
        if (slot.kind === 'initial' && sharedInitials?.path?.strokes?.length) return true
        return false
      }
      if (f.kind === 'ink') return Boolean(f.path.strokes?.length)
      return f.text.trim().length > 0
    },
    [localFills, sharedInk, sharedInitials, isServerFilled],
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
    loadDocumentSurface(file)
      .then(next => {
        if (cancelled) {
          next.destroy()
          return
        }
        surfaceRef.current?.destroy()
        surfaceRef.current = next
        setSurface(next)
        setPageCount(next.pageCount)
      })
      .catch(err => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not open document')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [file])

  useEffect(() => {
    return () => {
      surfaceRef.current?.destroy()
      surfaceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!surface || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    surface
      .renderPage(pageNumber, pageWidth, canvas)
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
  }, [surface, pageNumber, pageWidth])

  // Lock background scroll while modal is open
  useEffect(() => {
    if (!activeSlotId) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [activeSlotId])

  // Escape closes modal
  useEffect(() => {
    if (!activeSlotId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setActiveSlotId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSlotId])

  // Focus modal panel when opened
  useEffect(() => {
    if (!activeSlotId) return
    const t = window.setTimeout(() => {
      modalPanelRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(t)
  }, [activeSlotId])

  const pageSlots = useMemo(
    () => plan.slots.filter(s => s.pageIndex === pageNumber - 1),
    [plan.slots, pageNumber],
  )

  const activeSlot = activeSlotId
    ? plan.slots.find(s => s.id === activeSlotId) ?? null
    : null

  const resolveExistingInk = (
    slot: PlacementSlot,
  ): SignatureStrokeResult | null => {
    const local = localFills[slot.id]
    if (local?.kind === 'ink' && local.path.strokes?.length) {
      return inkFromLocal(local.path, local.imageDataUrl)
    }
    if (slot.kind === 'signature' && sharedInk?.path?.strokes?.length) return sharedInk
    if (slot.kind === 'initial' && sharedInitials?.path?.strokes?.length) {
      return sharedInitials
    }
    return null
  }

  const closeModal = () => {
    setActiveSlotId(null)
    setModalDraftInk(null)
    setModalDraftText('')
  }

  const openSlot = (slot: PlacementSlot) => {
    if (disabled || busy || submitting) return
    if (slot.personSlotIndex !== personSlotIndex) return
    if (slot.kind === 'checkmark' || slot.kind === 'cross') return
    if (isServerFilled(slot.id)) return
    setLocalError(null)
    if (slot.pageIndex !== pageNumber - 1) {
      setPageNumber(slot.pageIndex + 1)
    }

    if (isInkPlacementKind(slot.kind)) {
      const existing = resolveExistingInk(slot)
      if (existing) {
        setSigModalMode('reuse')
        setModalDraftInk(existing)
      } else {
        setSigModalMode('draw')
        setModalDraftInk(null)
        setSigPadKey(k => k + 1)
      }
      setModalDraftText('')
    } else {
      const existingText =
        localFills[slot.id]?.kind === 'text'
          ? (localFills[slot.id] as { text: string }).text
          : ''
      setModalDraftText(existingText)
      setModalDraftInk(null)
    }

    setActiveSlotId(slot.id)
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
    if (slot.kind === 'initial' && sharedInitials?.path) {
      return {
        kind: 'ink',
        path: sharedInitials.path,
        imageDataUrl: sharedInitials.imageDataUrl,
      }
    }
    return null
  }

  /** After applying one field, open the next incomplete one (or close). */
  const openNextAfter = (
    justFilledId: string,
    fillsSnapshot: Record<string, LocalFill>,
    sharedSig: SignatureStrokeResult | null,
    sharedInit: SignatureStrokeResult | null,
  ) => {
    const isFilled = (slot: PlacementSlot) => {
      if (isServerFilled(slot.id)) return true
      if (slot.id === justFilledId) return true
      const f = fillsSnapshot[slot.id]
      if (f?.kind === 'ink') return Boolean(f.path.strokes?.length)
      if (f?.kind === 'text') return f.text.trim().length > 0
      if (slot.kind === 'signature' && sharedSig?.path?.strokes?.length) return true
      if (slot.kind === 'initial' && sharedInit?.path?.strokes?.length) return true
      return false
    }
    const next = myFillable.find(s => !isFilled(s))
    if (!next) {
      closeModal()
      return
    }
    // Open next without full close (smoother)
    if (next.pageIndex !== pageNumber - 1) {
      setPageNumber(next.pageIndex + 1)
    }
    if (isInkPlacementKind(next.kind)) {
      const existing = (() => {
        const local = fillsSnapshot[next.id]
        if (local?.kind === 'ink' && local.path.strokes?.length) {
          return inkFromLocal(local.path, local.imageDataUrl)
        }
        return next.kind === 'initial' ? sharedInit : sharedSig
      })()
      if (existing?.path?.strokes?.length) {
        setSigModalMode('reuse')
        setModalDraftInk(existing)
      } else {
        setSigModalMode('draw')
        setModalDraftInk(null)
        setSigPadKey(k => k + 1)
      }
      setModalDraftText('')
    } else {
      const existingText =
        fillsSnapshot[next.id]?.kind === 'text'
          ? (fillsSnapshot[next.id] as { text: string }).text
          : ''
      setModalDraftText(existingText)
      setModalDraftInk(null)
    }
    setActiveSlotId(next.id)
  }

  const confirmModal = () => {
    if (!activeSlot) return
    if (isInkPlacementKind(activeSlot.kind)) {
      const isInitial = activeSlot.kind === 'initial'
      if (!modalDraftInk?.path?.strokes?.length) {
        setLocalError(
          isInitial ? 'Draw your initials before applying.' : 'Draw your signature before applying.',
        )
        return
      }
      const result = modalDraftInk
      const targets = isInitial ? myInitialSlots : mySignatureSlots
      const nextFills = { ...localFills }
      for (const s of targets) {
        if (!isServerFilled(s.id)) {
          nextFills[s.id] = {
            kind: 'ink',
            path: result.path,
            imageDataUrl: result.imageDataUrl,
          }
        }
      }
      const nextSharedSig = isInitial ? sharedInk : result
      const nextSharedInit = isInitial ? result : sharedInitials
      if (isInitial) setSharedInitials(result)
      else setSharedInk(result)
      setLocalFills(nextFills)
      setLocalError(null)
      // Stamp every same-kind line immediately, then move to remaining fields.
      openNextAfter(activeSlot.id, nextFills, nextSharedSig, nextSharedInit)
      return
    }

    const t = modalDraftText.trim()
    if (!t) {
      setLocalError(
        activeSlot.kind === 'name' ? 'Enter your name.' : 'Enter the required text.',
      )
      return
    }
    const nextFills = {
      ...localFills,
      [activeSlot.id]: { kind: 'text' as const, text: t },
    }
    setLocalFills(nextFills)
    setLocalError(null)
    openNextAfter(activeSlot.id, nextFills, sharedInk, sharedInitials)
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
        openSlot(slot)
        return
      }
      if (draft.kind === 'ink') {
        if (!draft.path.strokes?.length) {
          setLocalError(
            slot.kind === 'initial'
              ? 'Draw your initials in each initial box.'
              : 'Draw your signature in each signature box.',
          )
          openSlot(slot)
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
          openSlot(slot)
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
    isServerFilled,
    localFills,
    sharedInk,
    sharedInitials,
  ])

  const remaining = pendingSlots.length
  const nextHint = pendingSlots[0]
  const modalCanApply =
    activeSlot && isInkPlacementKind(activeSlot.kind)
      ? Boolean(modalDraftInk?.path?.strokes?.length)
      : modalDraftText.trim().length > 0

  const sigCount = mySignatureSlots.filter(s => !isServerFilled(s.id)).length
  const initCount = myInitialSlots.filter(s => !isServerFilled(s.id)).length
  const activeIsInitial = activeSlot?.kind === 'initial'
  const activeInkPeerCount = activeIsInitial ? initCount : sigCount

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
          Tap each <strong>highlighted</strong> box on the PDF. Signing opens in a panel so you stay
          with the document
          {sigCount > 1 || initCount > 1
            ? ' — each signature and each initial is reused on every matching box after the first.'
            : '.'}{' '}
          Other people&apos;s fields stay locked.
        </p>
      </header>

      {allAlreadyOnServer ? (
        <p className="signer-fill-done">
          <Check size={16} strokeWidth={2.5} aria-hidden /> Your page fields are already saved.
        </p>
      ) : null}

      <div className="signer-fill-toolbar">
        {pageCount > 1 && (
          <>
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
          </>
        )}
        {nextHint && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => openSlot(nextHint)}
          >
            Next field
          </button>
        )}
      </div>

      <div className="signer-fill-stage-wrap">
        <div className="pdf-annotator-stage signer-fill-stage">
          {loading && <p className="pdf-annotator-hint">Loading document…</p>}
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
                  (slot.kind === 'signature' ||
                    slot.kind === 'initial' ||
                    slot.kind === 'name' ||
                    slot.kind === 'text')

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
                        ? `${slot.kind} field${serverDone || draft ? ' (filled — tap to edit)' : ' (tap to fill)'}`
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
                          : slot.kind === 'initial'
                            ? 'Initial'
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

      {/*
        Portal to document.body so journey overflow/transform ancestors cannot trap
        position:fixed and park the dialog above the visible viewport.
      */}
      {activeSlot &&
        activeSlot.personSlotIndex === personSlotIndex &&
        !isServerFilled(activeSlot.id) &&
        createPortal(
          <div
            className="signer-fill-modal"
            role="presentation"
            onMouseDown={e => {
              if (e.target === e.currentTarget) closeModal()
            }}
          >
            <div
              ref={modalPanelRef}
              className="signer-fill-modal-panel"
              style={{ ['--person-color' as string]: color }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="signer-fill-modal-title"
              tabIndex={-1}
            >
              <div className="signer-fill-modal-head">
                <div>
                  <p className="signer-fill-modal-eyebrow">
                    {person.displayName || `Person ${personSlotIndex}`}
                  </p>
                  <h4 id="signer-fill-modal-title">
                    {isInkPlacementKind(activeSlot.kind)
                      ? sigModalMode === 'reuse'
                        ? activeIsInitial
                          ? 'Use your initials'
                          : 'Use your signature'
                        : activeIsInitial
                          ? 'Draw your initials'
                          : 'Draw your signature'
                      : activeSlot.kind === 'name'
                        ? 'Type your name'
                        : activeSlot.lockedContent?.text?.trim() || 'Enter text'}
                  </h4>
                </div>
                <button
                  type="button"
                  className="signer-fill-modal-close"
                  aria-label="Close"
                  onClick={closeModal}
                >
                  <X size={18} strokeWidth={2.25} aria-hidden />
                </button>
              </div>

              <div
                className={`signer-fill-modal-body${activeIsInitial ? ' is-initial' : ''}`}
              >
                {isInkPlacementKind(activeSlot.kind) ? (
                  sigModalMode === 'reuse' && modalDraftInk?.path?.strokes?.length ? (
                    <div className="signer-fill-reuse">
                      <div
                        className={`signer-fill-reuse-preview${activeIsInitial ? ' is-initial' : ''}`}
                      >
                        {modalDraftInk.imageDataUrl ? (
                          <img
                            src={modalDraftInk.imageDataUrl}
                            alt={activeIsInitial ? 'Your initials' : 'Your signature'}
                            className="signer-fill-reuse-img"
                          />
                        ) : (
                          <InkPreview
                            path={modalDraftInk.path}
                            width={activeIsInitial ? 140 : 280}
                            height={activeIsInitial ? 80 : 100}
                          />
                        )}
                      </div>
                      <p className="muted signer-fill-reuse-note">
                        {activeInkPeerCount > 1
                          ? activeIsInitial
                            ? 'These initials are applied to every initial box assigned to you.'
                            : 'This signature is applied to every signature line assigned to you.'
                          : activeIsInitial
                            ? 'Apply to place your initials on the document.'
                            : 'Apply to place this signature on the document.'}
                      </p>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setSigModalMode('draw')
                          setModalDraftInk(null)
                          setSigPadKey(k => k + 1)
                        }}
                      >
                        {activeIsInitial ? 'Draw different initials' : 'Draw a different signature'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <SignatureStrokePad
                        key={sigPadKey}
                        productMode
                        label={
                          activeIsInitial
                            ? 'Initials in the box below'
                            : 'Sign in the box below'
                        }
                        onChange={result => setModalDraftInk(result)}
                        disabled={disabled || busy || submitting}
                      />
                      {FEATURES.signOnMobile &&
                        authToken &&
                        !isLikelyMobileViewport() &&
                        !activeIsInitial && (
                          <button
                            type="button"
                            className="btn btn-secondary signer-fill-mobile-btn"
                            disabled={disabled || busy || submitting}
                            onClick={() => setSignOnMobileOpen(true)}
                          >
                            <Smartphone size={16} strokeWidth={2.25} aria-hidden />
                            Sign on mobile
                          </button>
                        )}
                    </>
                  )
                ) : (
                  <input
                    className="field-input signer-fill-inline-input"
                    autoFocus
                    value={modalDraftText}
                    onChange={e => setModalDraftText(e.target.value.slice(0, 200))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        confirmModal()
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
              </div>

              <div className="signer-fill-modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!modalCanApply || disabled || busy || submitting}
                  onClick={confirmModal}
                >
                  {isInkPlacementKind(activeSlot.kind)
                    ? activeInkPeerCount > 1 && sigModalMode === 'draw'
                      ? activeIsInitial
                        ? 'Apply to all initial boxes'
                        : 'Apply to all signature lines'
                      : activeIsInitial
                        ? 'Apply initials'
                        : 'Apply signature'
                    : remaining > 1
                      ? 'Save & next field'
                      : 'Save'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {FEATURES.signOnMobile && authToken && (
        <SignOnMobileModal
          open={signOnMobileOpen}
          token={authToken}
          documentId={documentId ?? undefined}
          onClose={() => setSignOnMobileOpen(false)}
          onSignature={result => {
            const stroke: SignatureStrokeResult = {
              path: result.path,
              imageDataUrl: result.imageDataUrl || '',
              rawPoints: result.rawPoints,
              simplifiedPoints: result.simplifiedPoints,
              epsilon: result.epsilon,
            }
            setModalDraftInk(stroke)
            setSigModalMode('reuse')
            setSignOnMobileOpen(false)
            setLocalError(null)
          }}
        />
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
