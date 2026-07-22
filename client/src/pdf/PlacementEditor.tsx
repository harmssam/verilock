/**
 * Construction-phase placement editor: name people, place empty signature/name
 * slots on a local document (PDF or image). Parent freezes geometry when continuing
 * to the next step (and can re-open until someone signs). No ink payloads here.
 */
import {
  AlignLeft,
  Check,
  Minus,
  Plus,
  Square,
  Trash2,
  Type,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isValidNimiqAddress, normalizeAddress, shortAddress } from '../addresses'
import {
  type ConstructionPerson,
  type ConstructionPlan,
  type PlacementKind,
  type PlacementSlot,
  MAX_CONSTRUCTION_PEOPLE,
  MIN_CONSTRUCTION_PEOPLE,
  clamp01,
  defaultPeople,
  newSlotId,
  personColor,
} from './placements'
import {
  canvasRectToNormalized,
  normalizedToCanvasRect,
  paintMark,
} from './annotations'
import { loadDocumentSurface, type DocumentSurface } from './documentSurface'
import './PdfAnnotator.css'
import './PlacementEditor.css'

type Tool = 'select' | 'signature' | 'initial' | 'name' | 'text' | 'checkmark' | 'cross'

/** Handwritten signature mark (black via currentColor on white tool buttons). */
function SignatureToolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="placement-tool-svg"
    >
      {/* Cursive ink stroke */}
      <path
        d="M2.8 15.2c1.1-2.4 2.4-4.6 3.6-5.1 1.4-.6 2.2 1.6 3.1 2.4 1.1 1 2.1-2.8 3.5-2.6 1.6.2 2.2 3.4 3.5 3.2 1.2-.2 1.8-2.8 3.3-2.4 1.1.3 2.2 1.9 3.2 3.4"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Flourish / end loop */}
      <path
        d="M17.2 13.4c.7.9 1.1 1.7.9 2.4-.3 1.1-1.6 1.3-2.3.4"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Signature baseline */}
      <path
        d="M3.2 19.2h14.6"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Compact monogram-style initials mark. */
function InitialsToolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="placement-tool-svg"
    >
      {/* Capital A-like stroke */}
      <path
        d="M5.2 17.5 9 6.8l3.6 10.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 13.4h4.6"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
      {/* Capital B-like stroke */}
      <path
        d="M14.2 6.8v10.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M14.2 7.2h3.1c1.35 0 2.25.85 2.25 2.05S18.65 11.3 17.3 11.3H14.2"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.2 11.3h3.4c1.45 0 2.4.9 2.4 2.2s-1 2.25-2.45 2.25H14.2"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface PlacementEditorProps {
  file: File
  plan: ConstructionPlan
  onChange: (next: ConstructionPlan) => void
  disabled?: boolean
  /** True while parent is locking/unlocking the plan. */
  lockBusy?: boolean
  pageWidth?: number
  /**
   * Read-only revisit (e.g. co-signer Done step). Locked layout with
   * copy that explains boxes were designed earlier — not for filling now.
   */
  reviewMode?: boolean
  /** Slot ids already filled on the server (review summary). */
  filledSlotIds?: ReadonlySet<string>
}

function kindLabel(kind: PlacementKind): string {
  switch (kind) {
    case 'signature':
      return 'signature'
    case 'initial':
      return 'initial'
    case 'name':
      return 'name'
    case 'text':
      return 'text'
    case 'checkmark':
      return 'check'
    case 'cross':
      return 'X'
    default:
      return kind
  }
}

export function PlacementEditor({
  file,
  plan,
  onChange,
  disabled = false,
  lockBusy = false,
  pageWidth = 560,
  reviewMode = false,
  filledSlotIds,
}: PlacementEditorProps) {
  const locked = plan.status === 'locked' || reviewMode
  const editDisabled = disabled || locked || lockBusy

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<DocumentSurface | null>(null)
  const [surface, setSurface] = useState<DocumentSurface | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [cssSize, setCssSize] = useState({ width: pageWidth, height: pageWidth * 1.3 })
  const [pagePts, setPagePts] = useState({ width: 612, height: 792 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  /** No person pre-selected — user must choose Person 1/2/… before tools unlock. */
  const [activePerson, setActivePerson] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)
  /** Optional label on fillable text fields (e.g. "Date", "Printed name"). */
  const [textFieldLabel, setTextFieldLabel] = useState('')
  /**
   * Draft digits while typing the people count (null = show committed people.length).
   * Allows clearing the field mid-edit without snapping back to 1 immediately.
   */
  const [peopleCountDraft, setPeopleCountDraft] = useState<string | null>(null)
  const peopleCountInputRef = useRef<HTMLInputElement>(null)
  const [placing, setPlacing] = useState<{ type: Tool; x: number; y: number } | null>(null)
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
    moved: boolean
  } | null>(null)
  /**
   * Place tools wait for pointerup. On mobile, pointerdown alone would drop a box
   * while the user is still trying to pan/scroll the PDF stage.
   */
  const placeGestureRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    cancelled: boolean
  } | null>(null)
  /** Finger/mouse movement above this = pan/scroll, not a place tap. */
  const PLACE_TAP_SLOP_PX = 12
  const [dragTick, setDragTick] = useState(0)

  const people = plan.people.length > 0 ? plan.people : defaultPeople(1)
  const slots = plan.slots
  /** Placement tools stay off until a person chip is selected. */
  const toolsDisabled = editDisabled || activePerson == null

  // Drop selection if that person slot was removed (never auto-pick another).
  useEffect(() => {
    if (activePerson != null && !people.some(p => p.slotIndex === activePerson)) {
      setActivePerson(null)
      setTool('select')
      setPlacing(null)
    }
  }, [people, activePerson])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setPageNumber(1)
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
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not open document')
        }
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
        setPagePts({ width: rendered.pageWidthPts, height: rendered.pageHeightPts })
      })
      .catch(err => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not render page')
        }
      })
    return () => {
      cancelled = true
    }
  }, [surface, pageNumber, pageWidth])

  const pageSlots = useMemo(
    () => slots.filter(s => s.pageIndex === pageNumber - 1),
    [slots, pageNumber],
  )

  const defaultSize = useCallback((kind: PlacementKind) => {
    if (kind === 'signature') return { width: 0.28, height: 0.08 }
    // Initials: short box (about 1/3 signature width)
    if (kind === 'initial') return { width: 0.1, height: 0.055 }
    if (kind === 'name') return { width: 0.28, height: 0.045 }
    if (kind === 'text') return { width: 0.28, height: 0.045 }
    return { width: 0.045, height: 0.045 }
  }, [])

  const patchPlan = useCallback(
    (patch: Partial<ConstructionPlan> | ((p: ConstructionPlan) => ConstructionPlan)) => {
      if (locked) return
      onChange(typeof patch === 'function' ? patch(plan) : { ...plan, ...patch })
    },
    [locked, onChange, plan],
  )

  const setPeople = useCallback(
    (next: ConstructionPerson[]) => {
      patchPlan(p => {
        const indices = new Set(next.map(x => x.slotIndex))
        return {
          ...p,
          people: next,
          slots: p.slots.filter(s => indices.has(s.personSlotIndex) || s.lockedContent?.mark),
        }
      })
    },
    [patchPlan],
  )

  const setPeopleCount = useCallback(
    (n: number) => {
      // Only whole numbers; anything > max → max, anything < min → min.
      const raw = Number.isFinite(n) ? Math.trunc(n) : MIN_CONSTRUCTION_PEOPLE
      const count = Math.max(
        MIN_CONSTRUCTION_PEOPLE,
        Math.min(MAX_CONSTRUCTION_PEOPLE, raw),
      )
      setPeopleCountDraft(null)
      patchPlan(p => {
        const current = p.people.length > 0 ? p.people : defaultPeople(1)
        if (count === current.length) return p
        const next: ConstructionPerson[] = []
        for (let i = 1; i <= count; i++) {
          const existing = current.find(x => x.slotIndex === i)
          next.push(
            existing ?? {
              slotIndex: i,
              displayName: `Person ${i}`,
            },
          )
        }
        const cs = p.creatorSigningAs
        return {
          ...p,
          people: next,
          slots: p.slots.filter(s => next.some(x => x.slotIndex === s.personSlotIndex)),
          creatorSigningAs: cs != null && cs > count ? null : cs ?? null,
        }
      })
      setActivePerson(prev => {
        if (prev != null && prev > count) {
          setTool('select')
          setPlacing(null)
          return null
        }
        return prev
      })
    },
    [patchPlan],
  )

  const commitPeopleCountDraft = () => {
    if (peopleCountDraft == null) return
    const trimmed = peopleCountDraft.trim()
    if (trimmed === '') {
      setPeopleCount(MIN_CONSTRUCTION_PEOPLE)
      return
    }
    const n = Number.parseInt(trimmed, 10)
    setPeopleCount(Number.isFinite(n) ? n : MIN_CONSTRUCTION_PEOPLE)
  }

  const onPeopleCountInputChange = (raw: string) => {
    // Digits only (no signs, decimals, or letters).
    // Draft-only — do not commit plan until blur/Enter/+/-/wheel.
    // Live-committing each digit (e.g. typing "10") briefly set count=1 and
    // deleted persons 2–N and their placement boxes.
    let digits = raw.replace(/\D/g, '')
    if (digits !== '') {
      const n = Number.parseInt(digits, 10)
      if (Number.isFinite(n) && n > MAX_CONSTRUCTION_PEOPLE) {
        digits = String(MAX_CONSTRUCTION_PEOPLE)
      }
    }
    setPeopleCountDraft(digits)
  }

  // Wheel on the count field steps ±1. Use a non-passive listener so we can
  // preventDefault (React's onWheel is often passive and cannot block page scroll).
  useEffect(() => {
    const el = peopleCountInputRef.current
    if (!el || editDisabled || locked) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      const step = e.deltaY < 0 ? 1 : -1
      const draft = peopleCountDraft
      const base =
        draft != null && draft !== '' ? Number.parseInt(draft, 10) : people.length
      const current = Number.isFinite(base) ? base : people.length
      setPeopleCount(current + step)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [editDisabled, locked, people.length, peopleCountDraft, setPeopleCount])

  const renamePerson = (slotIndex: number, displayName: string) => {
    setPeople(
      people.map(p =>
        p.slotIndex === slotIndex
          ? { ...p, displayName: displayName.slice(0, 80) }
          : p,
      ),
    )
  }

  const setPersonWallet = (slotIndex: number, raw: string) => {
    const trimmed = raw.trim()
    setPeople(
      people.map(p => {
        if (p.slotIndex !== slotIndex) return p
        if (!trimmed) return { ...p, walletAddress: null }
        return { ...p, walletAddress: normalizeAddress(trimmed) }
      }),
    )
  }

  const removeSlot = useCallback(
    (id: string) => {
      if (locked) return
      patchPlan(p => ({ ...p, slots: p.slots.filter(s => s.id !== id) }))
      if (selectedId === id) setSelectedId(null)
    },
    [locked, patchPlan, selectedId],
  )

  // Delete selected / cancel place tool with keyboard
  useEffect(() => {
    if (editDisabled) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape' && tool !== 'select') {
        e.preventDefault()
        setTool('select')
        setPlacing(null)
        return
      }
      if (e.key !== 'Backspace' && e.key !== 'Delete') return
      if (!selectedId) return
      e.preventDefault()
      removeSlot(selectedId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editDisabled, selectedId, removeSlot, tool])

  const updateSlot = useCallback(
    (id: string, patch: Partial<PlacementSlot>) => {
      if (locked) return
      patchPlan(p => ({
        ...p,
        slots: p.slots.map(s => (s.id === id ? { ...s, ...patch } : s)),
      }))
    },
    [locked, patchPlan],
  )

  const pointerToLocal = (e: React.PointerEvent) => {
    const wrap = wrapRef.current
    if (!wrap) return { x: 0, y: 0 }
    const rect = wrap.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const activeName =
    activePerson == null
      ? 'a person'
      : people.find(p => p.slotIndex === activePerson)?.displayName?.trim() ||
        `Person ${activePerson}`

  const placeAt = (cssX: number, cssY: number) => {
    if (toolsDisabled || tool === 'select' || activePerson == null) return

    if (!people.some(p => p.slotIndex === activePerson)) {
      setPlaceError('Select a person first, then place their boxes.')
      return
    }

    const kind: PlacementKind =
      tool === 'signature'
        ? 'signature'
        : tool === 'initial'
          ? 'initial'
          : tool === 'name'
            ? 'name'
            : tool === 'text'
              ? 'text'
              : tool === 'checkmark'
                ? 'checkmark'
                : 'cross'

    if (kind === 'signature' || kind === 'initial' || kind === 'name') {
      const personSlots = slots.filter(
        s => s.personSlotIndex === activePerson && s.kind === kind,
      )
      const perPersonMax = kind === 'initial' ? 4 : 2
      if (personSlots.length >= perPersonMax) {
        setPlaceError(
          `${activeName} already has ${personSlots.length} ${kind} boxes (max ${perPersonMax}).`,
        )
        return
      }
      // Per person caps above; totals allow every person a full set (up to 10 people).
      if (kind === 'signature' && slots.filter(s => s.kind === 'signature').length >= 20) {
        setPlaceError('At most 20 signature lines on one agreement.')
        return
      }
      if (kind === 'initial' && slots.filter(s => s.kind === 'initial').length >= 40) {
        setPlaceError('At most 40 initial boxes on one agreement.')
        return
      }
      if (kind === 'name' && slots.filter(s => s.kind === 'name').length >= 20) {
        setPlaceError('At most 20 name lines on one agreement.')
        return
      }
    }
    if (kind === 'text') {
      const personText = slots.filter(
        s => s.personSlotIndex === activePerson && s.kind === 'text',
      )
      if (personText.length >= 4) {
        setPlaceError(`${activeName} already has ${personText.length} text fields (max 4).`)
        return
      }
      if (slots.filter(s => s.kind === 'text').length >= 40) {
        setPlaceError('At most 40 text fields on one agreement.')
        return
      }
    }
    if (
      (kind === 'checkmark' || kind === 'cross') &&
      slots.filter(s => s.kind === 'checkmark' || s.kind === 'cross').length >= 24
    ) {
      setPlaceError('Mark limit reached (24).')
      return
    }

    setPlaceError(null)
    const size = defaultSize(kind)
    const geo = canvasRectToNormalized(
      {
        left: cssX - (size.width * cssSize.width) / 2,
        top: cssY - (size.height * cssSize.height) / 2,
        width: size.width * cssSize.width,
        height: size.height * cssSize.height,
      },
      cssSize.width,
      cssSize.height,
      pageNumber - 1,
      pagePts.width,
      pagePts.height,
    )
    geo.x = Math.min(Math.max(0, geo.x), 1 - geo.width)
    geo.y = Math.min(Math.max(0, geo.y), 1 - geo.height)

    const label = textFieldLabel.trim().slice(0, 80)
    // Check / X start as empty squares; click the slot to toggle the mark on or off.
    const slot: PlacementSlot = {
      id: newSlotId(),
      personSlotIndex: activePerson,
      kind,
      pageIndex: geo.pageIndex,
      x: clamp01(geo.x),
      y: clamp01(geo.y),
      width: clamp01(geo.width),
      height: clamp01(geo.height),
      ...(kind === 'text' && label
        ? {
            // Field label only (e.g. "Date") — fill value comes later at sign time
            lockedContent: { text: label, fontSizeRatio: 0.018, color: '#64748b' },
          }
        : {}),
    }

    patchPlan(p => ({ ...p, slots: [...p.slots, slot] }))
    setSelectedId(slot.id)
    if (kind === 'signature' || kind === 'initial' || kind === 'name' || kind === 'text') {
      setTool('select')
    }
    setPlacing(null)
  }

  /** Toggle empty check/X square ↔ filled mark (select mode, click without drag). */
  const toggleMarkSlot = useCallback(
    (id: string) => {
      if (locked) return
      const slot = slots.find(s => s.id === id)
      if (!slot || (slot.kind !== 'checkmark' && slot.kind !== 'cross')) return
      const isOn = slot.lockedContent?.mark === slot.kind
      if (isOn) {
        updateSlot(id, { lockedContent: undefined })
      } else {
        updateSlot(id, {
          lockedContent: {
            mark: slot.kind,
            color: personColor(slot.personSlotIndex),
          },
        })
      }
    },
    [locked, slots, updateSlot],
  )

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (editDisabled) return
    if (tool !== 'select') {
      if (toolsDisabled) {
        setPlaceError('Select a person first, then place their boxes.')
        return
      }
      // Do not place or preventDefault here — mobile needs pointerdown+move to
      // scroll the stage. Place only on a short pointerup (see onStagePointerUp).
      const p = pointerToLocal(e)
      placeGestureRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        cancelled: false,
      }
      setPlacing({ type: tool, x: p.x, y: p.y })
      return
    }
    if (e.target === wrapRef.current || e.target === canvasRef.current) {
      setSelectedId(null)
    }
  }

  const onStagePointerMove = (e: React.PointerEvent) => {
    const placeGesture = placeGestureRef.current
    if (placeGesture && placeGesture.pointerId === e.pointerId) {
      const dist = Math.hypot(
        e.clientX - placeGesture.startClientX,
        e.clientY - placeGesture.startClientY,
      )
      if (dist > PLACE_TAP_SLOP_PX) {
        placeGesture.cancelled = true
        setPlacing(null)
      }
    }

    // Ghost follows pointer only for true hover / stationary tap preview — not while panning.
    if (!toolsDisabled && tool !== 'select' && !placeGesture?.cancelled) {
      const p = pointerToLocal(e)
      setPlacing({ type: tool, x: p.x, y: p.y })
    }
    const drag = dragRef.current
    if (!drag || editDisabled) return
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
    if (dist > 4) drag.moved = true
    if (!drag.moved) return
    const slot = slots.find(s => s.id === drag.id)
    if (!slot) return
    let nx = drag.origX + (e.clientX - drag.startX) / cssSize.width
    let ny = drag.origY + (e.clientY - drag.startY) / cssSize.height
    nx = Math.min(Math.max(0, nx), 1 - slot.width)
    ny = Math.min(Math.max(0, ny), 1 - slot.height)
    updateSlot(drag.id, { x: nx, y: ny })
    setDragTick(t => t + 1)
  }

  const endDrag = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag || drag.moved || editDisabled) return
    const slot = slots.find(s => s.id === drag.id)
    if (slot && (slot.kind === 'checkmark' || slot.kind === 'cross')) {
      toggleMarkSlot(drag.id)
    }
  }

  const onStagePointerUp = (e: React.PointerEvent) => {
    const placeGesture = placeGestureRef.current
    if (placeGesture && placeGesture.pointerId === e.pointerId) {
      placeGestureRef.current = null
      if (
        !placeGesture.cancelled &&
        !editDisabled &&
        !toolsDisabled &&
        tool !== 'select'
      ) {
        const p = pointerToLocal(e)
        placeAt(p.x, p.y)
      }
    }
    endDrag()
  }

  const onStagePointerCancel = (e: React.PointerEvent) => {
    const placeGesture = placeGestureRef.current
    if (placeGesture && placeGesture.pointerId === e.pointerId) {
      placeGestureRef.current = null
      setPlacing(null)
    }
    endDrag()
  }

  const startItemDrag = (e: React.PointerEvent, id: string) => {
    if (editDisabled || tool !== 'select') return
    e.stopPropagation()
    e.preventDefault()
    const slot = slots.find(s => s.id === id)
    if (!slot) return
    setSelectedId(id)
    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: slot.x,
      origY: slot.y,
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  void dragTick

  const ghostStyle = (): React.CSSProperties | undefined => {
    if (!placing || placing.type === 'select' || activePerson == null) return undefined
    const kind: PlacementKind =
      placing.type === 'signature'
        ? 'signature'
        : placing.type === 'initial'
          ? 'initial'
          : placing.type === 'name'
            ? 'name'
            : placing.type === 'text'
              ? 'text'
              : placing.type === 'checkmark'
                ? 'checkmark'
                : 'cross'
    const size = defaultSize(kind)
    const w = size.width * cssSize.width
    const h = size.height * cssSize.height
    const color = personColor(activePerson)
    return {
      left: placing.x - w / 2,
      top: placing.y - h / 2,
      width: w,
      height: h,
      borderColor: color,
      background: `${color}18`,
    }
  }

  const selectPerson = (slotIndex: number) => {
    setActivePerson(slotIndex)
    setPlaceError(null)
  }

  const activePersonColor = activePerson != null ? personColor(activePerson) : null

  const creatorSigningAs = plan.creatorSigningAs ?? null

  const setCreatorSigningAs = (value: number | null) => {
    if (locked) return
    patchPlan(p => ({ ...p, creatorSigningAs: value }))
  }

  return (
    <div className={`placement-editor pdf-annotator${editDisabled && !locked ? ' is-disabled' : ''}${locked ? ' is-locked' : ''}`}>
      <div className="placement-editor-people" role="tablist" aria-label="People">
        <div className="placement-editor-people-head">
          <UserRound size={16} strokeWidth={2.25} aria-hidden />
          <strong>People who sign</strong>
          {!locked && (
            <div className="placement-editor-count">
              <span className="placement-editor-count-label" id="placement-people-count-label">
                Signers
              </span>
              <div
                className="placement-people-stepper"
                role="group"
                aria-labelledby="placement-people-count-label"
              >
                <button
                  type="button"
                  className="placement-people-stepper-btn"
                  disabled={editDisabled || people.length <= MIN_CONSTRUCTION_PEOPLE}
                  onClick={() => setPeopleCount(people.length - 1)}
                  aria-label="Fewer signers"
                  title="Fewer signers"
                >
                  <Minus size={14} strokeWidth={2.5} aria-hidden />
                </button>
                <input
                  ref={peopleCountInputRef}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  spellCheck={false}
                  className="placement-people-stepper-input"
                  value={peopleCountDraft ?? String(people.length)}
                  disabled={editDisabled}
                  onChange={e => onPeopleCountInputChange(e.target.value)}
                  onBlur={commitPeopleCountDraft}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      ;(e.currentTarget as HTMLInputElement).blur()
                    }
                    if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      const base =
                        peopleCountDraft != null && peopleCountDraft !== ''
                          ? Number.parseInt(peopleCountDraft, 10)
                          : people.length
                      setPeopleCount((Number.isFinite(base) ? base : people.length) + 1)
                    }
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      const base =
                        peopleCountDraft != null && peopleCountDraft !== ''
                          ? Number.parseInt(peopleCountDraft, 10)
                          : people.length
                      setPeopleCount((Number.isFinite(base) ? base : people.length) - 1)
                    }
                  }}
                  aria-label={`Number of signers (${MIN_CONSTRUCTION_PEOPLE}–${MAX_CONSTRUCTION_PEOPLE})`}
                  title={`${MIN_CONSTRUCTION_PEOPLE}–${MAX_CONSTRUCTION_PEOPLE} people. Scroll or use + / −.`}
                />
                <button
                  type="button"
                  className="placement-people-stepper-btn"
                  disabled={editDisabled || people.length >= MAX_CONSTRUCTION_PEOPLE}
                  onClick={() => setPeopleCount(people.length + 1)}
                  aria-label="More signers"
                  title="More signers"
                >
                  <Plus size={14} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            </div>
          )}
        </div>

        <label className="placement-creator-role">
          <span className="field-label">You sign as</span>
          <select
            value={creatorSigningAs == null ? '' : String(creatorSigningAs)}
            disabled={editDisabled}
            onChange={e => {
              const v = e.target.value
              setCreatorSigningAs(v === '' ? null : Number(v))
            }}
          >
            <option value="">Organizing only</option>
            {people.map(p => (
              <option key={p.slotIndex} value={p.slotIndex}>
                Person {p.slotIndex}
                {p.displayName?.trim() ? ` · ${p.displayName.trim()}` : ''}
              </option>
            ))}
          </select>
        </label>

        <ul className="placement-editor-people-list">
          {people.map(p => {
            const color = personColor(p.slotIndex)
            const active = p.slotIndex === activePerson
            const nSig = slots.filter(
              s => s.personSlotIndex === p.slotIndex && s.kind === 'signature',
            ).length
            const nInit = slots.filter(
              s => s.personSlotIndex === p.slotIndex && s.kind === 'initial',
            ).length
            const nName = slots.filter(
              s => s.personSlotIndex === p.slotIndex && s.kind === 'name',
            ).length
            const nText = slots.filter(
              s => s.personSlotIndex === p.slotIndex && s.kind === 'text',
            ).length
            const walletRaw = p.walletAddress ?? ''
            const walletOk = !walletRaw || isValidNimiqAddress(walletRaw)
            return (
              <li key={p.slotIndex}>
                <div
                  className={`placement-person-chip${active ? ' is-active' : ''}`}
                  style={{ ['--person-color' as string]: color }}
                  role="tab"
                  aria-selected={active}
                  tabIndex={0}
                  onClick={() => selectPerson(p.slotIndex)}
                  onKeyDown={e => {
                    // Space/Enter activate the person tab for a11y — but must not steal
                    // keystrokes from nested name/wallet inputs (e.g. typing "Sam Harms").
                    const t = e.target as HTMLElement | null
                    if (
                      t &&
                      (t.tagName === 'INPUT' ||
                        t.tagName === 'TEXTAREA' ||
                        t.tagName === 'SELECT' ||
                        t.isContentEditable)
                    ) {
                      return
                    }
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectPerson(p.slotIndex)
                    }
                  }}
                >
                  {active && (
                    <span className="placement-person-active-tag" aria-hidden>
                      Active
                    </span>
                  )}
                  <span className="placement-person-swatch" aria-hidden />
                  <span className="placement-person-meta">
                    <span className="placement-person-label">Person {p.slotIndex}</span>
                    {!locked ? (
                      <>
                        <label
                          className="placement-person-name-wrap"
                          onClick={e => e.stopPropagation()}
                        >
                          <input
                            className={[
                              'placement-person-name',
                              /^Person\s+\d+$/i.test(p.displayName.trim())
                                ? 'is-placeholder-name'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            value={p.displayName}
                            disabled={editDisabled}
                            maxLength={80}
                            placeholder="Name"
                            onFocus={e => {
                              selectPerson(p.slotIndex)
                              // Default "Person 1" → select all so typing replaces immediately
                              if (/^Person\s+\d+$/i.test(p.displayName.trim())) {
                                e.currentTarget.select()
                              }
                            }}
                            onClick={e => {
                              e.stopPropagation()
                              selectPerson(p.slotIndex)
                            }}
                            onChange={e => {
                              selectPerson(p.slotIndex)
                              renamePerson(p.slotIndex, e.target.value)
                            }}
                            aria-label={`Rename person ${p.slotIndex}`}
                          />
                        </label>
                        <input
                          className="placement-person-wallet"
                          value={walletRaw}
                          disabled={editDisabled}
                          maxLength={48}
                          placeholder="Nimiq address (optional)"
                          spellCheck={false}
                          autoComplete="off"
                          onFocus={() => selectPerson(p.slotIndex)}
                          onClick={e => {
                            e.stopPropagation()
                            selectPerson(p.slotIndex)
                          }}
                          onChange={e => {
                            selectPerson(p.slotIndex)
                            setPersonWallet(p.slotIndex, e.target.value)
                          }}
                          aria-label={`Nimiq address for person ${p.slotIndex}`}
                          aria-invalid={walletOk ? undefined : true}
                        />
                        {!walletOk && (
                          <span className="placement-person-wallet-err">
                            Invalid Nimiq address
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="placement-person-name-static">
                          {p.displayName || `Person ${p.slotIndex}`}
                        </span>
                        {p.walletAddress && (
                          <span className="muted placement-person-counts">
                            {shortAddress(p.walletAddress)}
                          </span>
                        )}
                      </>
                    )}
                    <span className="muted placement-person-counts">
                      {[
                        nSig > 0 ? `${nSig} sig` : null,
                        nInit > 0 ? `${nInit} init` : null,
                        nName > 0 ? `${nName} name` : null,
                        nText > 0 ? `${nText} text` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'No fields yet'}
                    </span>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div
        className={[
          'pdf-annotator-toolbar',
          'placement-editor-toolbar',
          activePersonColor ? 'has-person' : '',
          toolsDisabled && !locked ? 'is-tools-disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          activePersonColor
            ? ({ ['--person-color' as string]: activePersonColor } as React.CSSProperties)
            : undefined
        }
        role="toolbar"
        aria-label="Placement tools"
        aria-disabled={toolsDisabled || undefined}
      >
        <button
          type="button"
          className={`placement-tool-btn${tool === 'signature' ? ' is-active' : ''}`}
          onClick={() => setTool('signature')}
          disabled={toolsDisabled}
          title={
            activePerson == null
              ? 'Select a person first'
              : `Place signature line for ${activeName}`
          }
          aria-label="Signature"
          aria-pressed={tool === 'signature'}
        >
          <SignatureToolIcon size={18} />
        </button>
        <button
          type="button"
          className={`placement-tool-btn${tool === 'initial' ? ' is-active' : ''}`}
          onClick={() => setTool('initial')}
          disabled={toolsDisabled}
          title={
            activePerson == null
              ? 'Select a person first'
              : `Place initials box for ${activeName}`
          }
          aria-label="Initials"
          aria-pressed={tool === 'initial'}
        >
          <InitialsToolIcon size={18} />
        </button>
        <button
          type="button"
          className={`placement-tool-btn${tool === 'name' ? ' is-active' : ''}`}
          onClick={() => setTool('name')}
          disabled={toolsDisabled}
          title={
            activePerson == null
              ? 'Select a person first'
              : `Place printed-name line for ${activeName}`
          }
          aria-label="Printed name"
          aria-pressed={tool === 'name'}
        >
          <Type size={18} strokeWidth={2.1} aria-hidden />
        </button>
        <button
          type="button"
          className={`placement-tool-btn${tool === 'text' ? ' is-active' : ''}`}
          onClick={() => setTool('text')}
          disabled={toolsDisabled}
          title={
            activePerson == null
              ? 'Select a person first'
              : `Place text field (date, etc.) for ${activeName}`
          }
          aria-label="Text field"
          aria-pressed={tool === 'text'}
        >
          <AlignLeft size={18} strokeWidth={2.1} aria-hidden />
        </button>
        <span className="placement-toolbar-sep" aria-hidden />
        <button
          type="button"
          className={`placement-tool-btn${tool === 'checkmark' ? ' is-active' : ''}`}
          onClick={() => setTool('checkmark')}
          disabled={toolsDisabled}
          title={
            activePerson == null
              ? 'Select a person first'
              : 'Place empty checkbox — click the box to toggle check on or off'
          }
          aria-label="Checkbox"
          aria-pressed={tool === 'checkmark'}
        >
          <Square size={17} strokeWidth={2.1} aria-hidden />
          <Check size={11} strokeWidth={2.75} className="placement-tool-check-overlay" aria-hidden />
        </button>
        <button
          type="button"
          className={`placement-tool-btn${tool === 'cross' ? ' is-active' : ''}`}
          onClick={() => setTool('cross')}
          disabled={toolsDisabled}
          title={
            activePerson == null
              ? 'Select a person first'
              : 'Place empty X box — click the box to toggle X on or off'
          }
          aria-label="X mark"
          aria-pressed={tool === 'cross'}
        >
          <Square size={17} strokeWidth={2.1} aria-hidden />
          <X size={11} strokeWidth={2.75} className="placement-tool-check-overlay" aria-hidden />
        </button>
        {selectedId && !locked && (
          <>
            <span className="placement-toolbar-sep" aria-hidden />
            <button
              type="button"
              className="placement-tool-btn placement-tool-btn--danger"
              onClick={() => removeSlot(selectedId)}
              disabled={editDisabled}
              title="Delete selected box"
              aria-label="Delete selected box"
            >
              <Trash2 size={17} strokeWidth={2.1} aria-hidden />
            </button>
          </>
        )}
        {tool === 'text' && !locked && (
          <label className="placement-text-label-field">
            <span className="visually-hidden">Text field label</span>
            <input
              type="text"
              value={textFieldLabel}
              onChange={e => setTextFieldLabel(e.target.value.slice(0, 80))}
              placeholder="Label (optional): Date, City…"
              maxLength={80}
              disabled={toolsDisabled}
            />
          </label>
        )}
        {pageCount > 1 && (
          <div className="pdf-annotator-pages placement-toolbar-pages">
            <button
              type="button"
              className="placement-tool-btn placement-tool-btn--sm"
              disabled={disabled || pageNumber <= 1}
              onClick={() => setPageNumber(p => Math.max(1, p - 1))}
              title="Previous page"
              aria-label="Previous page"
            >
              ‹
            </button>
            <span>
              {pageNumber} / {pageCount}
            </span>
            <button
              type="button"
              className="placement-tool-btn placement-tool-btn--sm"
              disabled={disabled || pageNumber >= pageCount}
              onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))}
              title="Next page"
              aria-label="Next page"
            >
              ›
            </button>
          </div>
        )}
      </div>

      {!locked && !reviewMode && activePerson == null && (
        <p className="placement-editor-hint placement-editor-hint--pick" role="status">
          <strong>Select a person</strong> above to unlock the toolbar and place fields for them.
        </p>
      )}
      {!locked && !reviewMode && activePerson != null && (
        <p className="placement-editor-hint placement-editor-hint--design" role="status">
          <strong>Designing, not signing.</strong> These boxes mark where people will sign later.
          No ink or wallet signature is collected on this step. Tap to place a field; drag to pan the
          page. Check and X boxes start empty — click a placed box to toggle the mark.
        </p>
      )}
      {reviewMode && (
        <p className="placement-editor-hint placement-editor-hint--locked" role="status">
          Field layout the organizer designed
          {filledSlotIds && filledSlotIds.size > 0
            ? ` · ${filledSlotIds.size} field${filledSlotIds.size === 1 ? '' : 's'} recorded as filled`
            : ''}
          . Signature images appear under Recorded signatures — not redrawn on this preview.
        </p>
      )}
      {locked && !reviewMode && (
        <p className="placement-editor-hint placement-editor-hint--locked">
          Layout is set for signing. Use Edit placements to change it before anyone signs.
        </p>
      )}
      {placeError && (
        <p className="placement-editor-error" role="alert">
          {placeError}
        </p>
      )}

      <div className="pdf-annotator-layout">
        <div className="pdf-annotator-stage">
          {loading && <p className="pdf-annotator-hint">Loading document…</p>}
          {loadError && <p className="pdf-annotator-hint">{loadError}</p>}
          <div
            ref={wrapRef}
            className={`pdf-annotator-page-wrap${tool !== 'select' ? ' is-tool-active' : ''}`}
            style={{ width: cssSize.width }}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerCancel}
            onPointerLeave={() => {
              // Clear hover ghost only; keep an in-flight place gesture until up/cancel
              // so a finger that briefly leaves the page wrap mid-tap still places.
              if (tool !== 'select' && !placeGestureRef.current) setPlacing(null)
            }}
          >
            <canvas ref={canvasRef} />
            <div className="pdf-annotator-layer">
              {pageSlots.map(slot => {
                const r = normalizedToCanvasRect(slot, cssSize.width, cssSize.height)
                const selected = selectedId === slot.id
                const color = personColor(slot.personSlotIndex)
                const person =
                  people.find(p => p.slotIndex === slot.personSlotIndex)?.displayName ||
                  `Person ${slot.personSlotIndex}`
                return (
                  <div
                    key={slot.id}
                    className={`placement-slot pdf-annotator-item${selected ? ' is-selected' : ''}${
                      dragRef.current?.id === slot.id ? ' is-dragging' : ''
                    }${locked ? ' is-locked' : ''}`}
                    style={{
                      left: r.left,
                      top: r.top,
                      width: r.width,
                      height: r.height,
                      ['--person-color' as string]: color,
                    }}
                    onPointerDown={e => startItemDrag(e, slot.id)}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {!locked && (
                      <button
                        type="button"
                        className="placement-slot-remove"
                        aria-label={`Remove ${kindLabel(slot.kind)} for ${person}`}
                        title="Remove"
                        onPointerDown={e => {
                          e.stopPropagation()
                          e.preventDefault()
                        }}
                        onClick={e => {
                          e.stopPropagation()
                          removeSlot(slot.id)
                        }}
                      >
                        <X size={10} strokeWidth={3} aria-hidden />
                      </button>
                    )}
                    {slot.kind === 'checkmark' || slot.kind === 'cross' ? (
                      <MarkPreview
                        kind={slot.kind}
                        checked={slot.lockedContent?.mark === slot.kind}
                        color={slot.lockedContent?.color ?? color}
                        width={r.width}
                        height={r.height}
                      />
                    ) : (
                      <div className="placement-slot-label">
                        <span className="placement-slot-person">{person}</span>
                        <span className="placement-slot-kind">
                          ·{' '}
                          {slot.kind === 'text' && slot.lockedContent?.text
                            ? slot.lockedContent.text
                            : kindLabel(slot.kind)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
              {placing && tool !== 'select' && activePerson != null && (
                <div className="pdf-annotator-ghost placement-ghost" style={ghostStyle()}>
                  {tool === 'checkmark' || tool === 'cross' ? (
                    <MarkPreview
                      kind={tool}
                      checked={false}
                      color={personColor(activePerson)}
                      width={defaultSize(tool).width * cssSize.width}
                      height={defaultSize(tool).height * cssSize.height}
                    />
                  ) : (
                    <div className="placement-slot-label">
                      <span className="placement-slot-person">{activeName}</span>
                      <span className="placement-slot-kind">
                        ·{' '}
                        {tool === 'text' && textFieldLabel.trim()
                          ? textFieldLabel.trim()
                          : kindLabel(
                              tool === 'signature'
                                ? 'signature'
                                : tool === 'initial'
                                  ? 'initial'
                                  : tool === 'name'
                                    ? 'name'
                                    : 'text',
                            )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

function MarkPreview({
  kind,
  checked,
  color,
  width,
  height,
}: {
  kind: 'checkmark' | 'cross'
  /** When false, draws an empty square the user can click to fill. */
  checked: boolean
  color: string
  width: number
  height: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    c.width = Math.max(1, Math.round(width * dpr))
    c.height = Math.max(1, Math.round(height * dpr))
    c.style.width = `${width}px`
    c.style.height = `${height}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    // Empty checkbox frame (always)
    const inset = Math.max(1, Math.min(width, height) * 0.08)
    const lw = Math.max(1.5, Math.min(width, height) * 0.08)
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.lineJoin = 'miter'
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2)
    ctx.restore()
    if (checked) {
      paintMark(ctx, kind, { left: 0, top: 0, width, height }, color)
    }
  }, [kind, checked, color, width, height])
  return (
    <canvas
      ref={ref}
      className={`placement-mark-preview${checked ? ' is-checked' : ' is-empty'}`}
      aria-hidden
    />
  )
}
