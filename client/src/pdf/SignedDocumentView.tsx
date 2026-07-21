/**
 * Read-only signed document: local file + placement fills / signature images.
 * Used when an involved party verifies (or revisits Done) with their copy of the file.
 * Same visual surface as create/sign (pdf.js stage), not the document-card metaphor.
 */
import { Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { DocumentAnnotation, DocumentParty, DocumentSignature } from '../types'
import type { PdfAnnotation } from './annotations'
import type { PlacementSlot } from './placements'
import { reconstructAnnotationsFromPlanAndFills } from './placementStream'
import {
  PdfReconstructor,
  printRenderedPages,
  type PdfReconstructorHandle,
} from './PdfReconstructor'
import './PdfAnnotator.css'
import './SignedDocumentView.css'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

function resolveImageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) {
    return path
  }
  return `${API_BASE}${path}`
}

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

async function fetchSignatureImageDataUrl(
  imageUrl: string,
  token: string | null | undefined,
): Promise<string | null> {
  try {
    const headers: HeadersInit = {}
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(resolveImageUrl(imageUrl), { headers })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/**
 * Map wallet signature images onto signature/initial placement slots by person index.
 * Used when fill wire frames are unavailable but parties still have ink images.
 */
async function annotationsFromSignatureImages(input: {
  slots: PlacementSlot[]
  people: Array<{ slotIndex: number; displayName?: string; walletAddress?: string | null }>
  parties: DocumentParty[]
  signatures: DocumentSignature[]
  authToken?: string | null
}): Promise<PdfAnnotation[]> {
  const { slots, people, parties, signatures, authToken } = input
  if (!slots.length || !signatures.length) return []

  const required = parties.filter(p => p.required)
  const orderedParties =
    required.length > 0
      ? required
      : [...parties].sort((a, b) => a.id.localeCompare(b.id))

  /** personSlotIndex → party id */
  const personToParty = new Map<number, string>()
  for (const person of people) {
    const personWallet = person.walletAddress?.replace(/\s/g, '').toUpperCase()
    const byWallet =
      personWallet &&
      orderedParties.find(
        p =>
          p.walletAddress &&
          p.walletAddress.replace(/\s/g, '').toUpperCase() === personWallet,
      )
    if (byWallet) {
      personToParty.set(person.slotIndex, byWallet.id)
      continue
    }
    const byName =
      person.displayName?.trim() &&
      orderedParties.find(
        p =>
          p.displayName?.trim() &&
          p.displayName.trim().toLowerCase() === person.displayName!.trim().toLowerCase(),
      )
    if (byName) {
      personToParty.set(person.slotIndex, byName.id)
      continue
    }
    // 1-based person index → ordered required party
    const byIndex = orderedParties[person.slotIndex - 1]
    if (byIndex) personToParty.set(person.slotIndex, byIndex.id)
  }

  // Also map by slot index alone when people list is empty
  if (people.length === 0) {
    orderedParties.forEach((p, i) => personToParty.set(i + 1, p.id))
  }

  const imageByParty = new Map<string, string>()
  await Promise.all(
    signatures.map(async sig => {
      if (!sig.imageUrl) return
      const dataUrl = await fetchSignatureImageDataUrl(sig.imageUrl, authToken)
      if (dataUrl) imageByParty.set(sig.partyId, dataUrl)
    }),
  )

  const out: PdfAnnotation[] = []
  for (const slot of slots) {
    if (slot.kind === 'checkmark' || slot.kind === 'cross') {
      if (slot.lockedContent?.mark) {
        out.push({
          id: slot.id,
          type: slot.lockedContent.mark,
          pageIndex: slot.pageIndex,
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          color: slot.lockedContent.color,
        })
      }
      continue
    }
    if (slot.kind === 'name' || slot.kind === 'text') {
      if (slot.lockedContent?.text) {
        out.push({
          id: slot.id,
          type: 'text',
          pageIndex: slot.pageIndex,
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          text: slot.lockedContent.text,
          fontSizeRatio: slot.lockedContent.fontSizeRatio ?? 0.025,
          color: slot.lockedContent.color ?? '#0f172a',
        })
      }
      continue
    }
    // signature / initial — prefer party ink image
    if (slot.kind === 'signature' || slot.kind === 'initial') {
      const partyId = personToParty.get(slot.personSlotIndex)
      const imageDataUrl = partyId ? imageByParty.get(partyId) : undefined
      if (imageDataUrl) {
        out.push({
          id: slot.id,
          type: 'signature',
          pageIndex: slot.pageIndex,
          x: slot.x,
          y: slot.y,
          width: slot.width,
          height: slot.height,
          imageDataUrl,
        })
      }
    }
  }
  return out
}

export interface SignedDocumentViewProps {
  file: File
  /** PDF fingerprint (sha256 hex) used to load placement fills. */
  fingerprint: string | null | undefined
  /** Session token — required to unlock fill wire frames / private images. */
  authToken?: string | null
  /**
   * When false, only plain document pages are shown (no private overlays).
   * Involved parties pass true.
   */
  revealPrivate?: boolean
  /** Optional legacy document.annotations fallback. */
  documentAnnotations?: DocumentAnnotation[] | null
  /** For image fallback onto placement slots when fill frames are missing. */
  signatures?: DocumentSignature[]
  parties?: DocumentParty[]
  pageWidth?: number
  className?: string
}

type LoadState = 'idle' | 'loading' | 'ready' | 'plain'

/**
 * Shows the local document with all recorded page fields (signatures, initials,
 * text, marks) overlaid when the viewer is an involved party and data exists.
 */
export function SignedDocumentView({
  file,
  fingerprint,
  authToken = null,
  revealPrivate = false,
  documentAnnotations = null,
  signatures = [],
  parties = [],
  pageWidth = 640,
  className,
}: SignedDocumentViewProps) {
  const reconRef = useRef<PdfReconstructorHandle>(null)
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([])
  const [loadState, setLoadState] = useState<LoadState>('idle')
  const [note, setNote] = useState<string | null>(null)
  const [pagesReady, setPagesReady] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [printError, setPrintError] = useState<string | null>(null)

  // Stable keys so parent re-renders with new array refs do not re-fetch forever.
  const sigKey = signatures
    .map(s => `${s.id}:${s.imageUrl ?? ''}:${s.hasImage ? 1 : 0}`)
    .join('|')
  const partyKey = parties.map(p => `${p.id}:${p.walletAddress ?? ''}`).join('|')
  const legacyKey = documentAnnotations?.map(a => a.id).join('|') ?? ''

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

    setLoadState('loading')
    setNote(null)

    void (async () => {
      try {
        if (!/^[a-f0-9]{64}$/.test(hash)) {
          if (cancelled) return
          setAnnotations(legacy)
          setLoadState(legacy.length > 0 ? 'ready' : 'plain')
          setNote(
            legacy.length > 0
              ? null
              : 'Showing your local file. Signature images appear under Recorded signatures when present.',
          )
          return
        }

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

        const people = (planRes.plan?.people ?? []).map(p => ({
          slotIndex: p.slotIndex,
          displayName: p.displayName,
          walletAddress: p.walletAddress ?? null,
        }))

        const fillBatches = planRes.fillBatches ?? []
        const hasFrames =
          planRes.fillPayloadRevealed === true &&
          fillBatches.some(b => Array.isArray(b.framesHex) && b.framesHex.length > 0)

        // 1) Prefer vector fill frames (full signatures / initials / text).
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
                ? 'Signatures and fields reconstructed on your local copy — read only.'
                : null,
            )
            return
          }
        }

        // 2) Fallback: stamp wallet signature images into signature boxes.
        if (slots.length > 0 && signatures.some(s => s.imageUrl || s.hasImage)) {
          const fromImages = await annotationsFromSignatureImages({
            slots,
            people,
            parties,
            signatures,
            authToken,
          })
          if (cancelled) return
          if (fromImages.length > 0) {
            setAnnotations(fromImages)
            setLoadState('ready')
            setNote(
              hasFrames
                ? null
                : 'Signatures placed from recorded ink images. Page text fields may be incomplete if fill data is unavailable.',
            )
            return
          }
        }

        // 3) Locked content / legacy annotations only
        if (slots.length > 0) {
          const { annotations: lockedOnly } = await reconstructAnnotationsFromPlanAndFills({
            slots,
            fillBatches: [],
          })
          if (cancelled) return
          const combined = lockedOnly.length > 0 ? lockedOnly : legacy
          setAnnotations(combined)
          setLoadState('ready')
          setNote(
            filledCountMessage(
              planRes.filledSlotIds?.length ?? 0,
              hasFrames,
              signatures.some(s => s.hasImage || s.imageUrl),
            ),
          )
          return
        }

        if (legacy.length > 0) {
          setAnnotations(legacy)
          setLoadState('ready')
          setNote(null)
          return
        }

        // Always show the PDF for involved parties even without overlays.
        setAnnotations([])
        setLoadState('plain')
        setNote(
          'No field layout is stored for this fingerprint. Your local file is shown below; wallet signatures appear under Recorded signatures.',
        )
      } catch {
        if (cancelled) return
        if (legacy.length > 0) {
          setAnnotations(legacy)
          setLoadState('ready')
          setNote(null)
        } else {
          // Still open the local PDF
          setAnnotations([])
          setLoadState('plain')
          setNote(
            'Could not load field layout. Showing your local file only — signature images appear under Recorded signatures when present.',
          )
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sigKey/partyKey/legacyKey stabilize array props
  }, [file, fingerprint, authToken, revealPrivate, sigKey, partyKey, legacyKey])

  const handlePrint = async () => {
    setPrintError(null)
    setPrintBusy(true)
    try {
      await printRenderedPages(
        reconRef.current?.getPagesRoot() ?? null,
        file.name ? `Signed — ${file.name}` : 'Signed document',
      )
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Could not print')
    } finally {
      setPrintBusy(false)
    }
  }

  return (
    <section
      className={className ?? 'signed-document-view'}
      aria-label="Signed document preview"
    >
      <header className="signed-document-view-head">
        <div className="signed-document-view-head-row">
          <div className="signed-document-view-head-text">
            <h3 className="signed-document-view-title">Signed document</h3>
            <p className="muted signed-document-view-lead">
              Your local file with recorded signatures on the page. Read only — nothing leaves this
              device.
            </p>
          </div>
          {(loadState === 'ready' || loadState === 'plain') && (
            <button
              type="button"
              className={`btn btn-secondary signed-document-print${printBusy ? ' btn--busy' : ''}`}
              disabled={!pagesReady || printBusy}
              onClick={() => void handlePrint()}
            >
              <Printer size={16} strokeWidth={2.25} aria-hidden />
              {printBusy ? 'Preparing…' : 'Print'}
            </button>
          )}
        </div>
      </header>
      {loadState === 'loading' && (
        <p className="pdf-annotator-hint">Building signed view…</p>
      )}
      {(loadState === 'ready' || loadState === 'plain') && (
        <PdfReconstructor
          ref={reconRef}
          file={file}
          annotations={annotations}
          pageWidth={pageWidth}
          className="signed-document-view-recon"
          onReadyChange={setPagesReady}
        />
      )}
      {printError && (
        <p className="signed-document-view-note signed-document-print-error" role="alert">
          {printError}
        </p>
      )}
      {note && (
        <p className="muted signed-document-view-note" role="status">
          {note}
        </p>
      )}
    </section>
  )
}

function filledCountMessage(
  filledSlots: number,
  hadFrames: boolean,
  hasSigImages: boolean,
): string | null {
  if (filledSlots > 0 && !hadFrames && !hasSigImages) {
    return 'Field layout loaded, but signature ink was not available for this session. Check Recorded signatures below.'
  }
  if (filledSlots === 0 && !hasSigImages) {
    return 'Field layout is set, but no page fills are recorded yet.'
  }
  return null
}
