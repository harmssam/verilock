/**
 * Construction-phase placement editor: name people, place empty signature/name
 * slots on a local document (PDF or image). Parent freezes geometry when continuing
 * to the next step (and can re-open until someone signs). No ink payloads here.
 */
import {
  Calendar,
  Check,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Square,
  UserRound,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { isValidNimiqAddress, normalizeAddress, shortAddress } from '../addresses'
import {
  type ConstructionPerson,
  type ConstructionPlan,
  type PlacementKind,
  type PlacementSlot,
  DEFAULT_LABEL_FONT_RATIO,
  MAX_CONSTRUCTION_PEOPLE,
  MIN_CONSTRUCTION_PEOPLE,
  PLACEMENT_SCALE_DEFAULT_PCT,
  PLACEMENT_SCALE_MAX_PCT,
  PLACEMENT_SCALE_MIN_PCT,
  PLACEMENT_SCALE_STEP_PCT,
  applyPlacementScale,
  clamp01,
  defaultPeople,
  defaultSizeForKind,
  fontSizeRatioAtScale,
  newSlotId,
  personColor,
  scalePercentFromSlot,
} from './placements'
import {
  canvasRectToNormalized,
  normalizedToCanvasRect,
  paintMark,
} from './annotations'
import { loadDocumentSurface, type DocumentSurface } from './documentSurface'
import './PdfAnnotator.css'
import './PlacementEditor.css'

type Tool =
  | 'select'
  | 'signature'
  | 'initial'
  | 'name'
  | 'text'
  | 'date'
  | 'checkmark'
  | 'cross'

/** View-only zoom for placement (not stored on the plan). */
const ZOOM_MIN_PCT = 50
const ZOOM_MAX_PCT = 200
const ZOOM_STEP_PCT = 25

/**
 * Signature tool mark (from signature-svgrepo-com.svg).
 * Fills with currentColor so it stays black on white tool buttons.
 */
function SignatureToolIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="placement-tool-svg"
    >
      <path d="M 1.1883 43.4869 L 13.6935 43.4869 C 13.4483 44.4300 13.3162 45.3542 13.3162 46.2030 C 13.3162 49.2397 15.0138 51.4088 18.5786 51.4088 C 22.9168 51.4088 26.4250 48.3532 28.6884 43.4869 L 54.8118 43.4869 C 55.4719 43.4869 56 42.9777 56 42.3175 C 56 41.6574 55.4719 41.1670 54.8118 41.1670 L 29.6315 41.1670 C 30.6877 38.0737 31.3290 34.4523 31.4611 30.5290 C 32.6494 30.2650 33.8941 30.1329 35.1769 30.1329 C 35.8371 30.1329 36.2141 30.4159 36.2141 30.9063 C 36.2141 32.5472 35.3276 33.8298 35.3276 35.4708 C 35.3276 36.9043 36.3841 37.7719 37.7608 37.7719 C 41.5896 37.7719 46.2108 31.2269 47.7385 31.2269 C 49.1342 31.2269 47.3990 37.1117 52.1522 37.1117 C 52.9256 37.1117 53.9253 36.9043 54.6986 36.4139 C 55.1513 36.0932 55.4719 35.6405 55.4719 35.0558 C 55.4719 34.3391 55.0192 33.7544 54.2648 33.7544 C 53.6046 33.7544 53.0577 34.3013 52.4164 34.3013 C 50.3792 34.3013 52.3218 28.0393 48.5687 28.0393 C 45.2868 28.0393 40.1561 34.4145 38.8548 34.4145 C 38.6852 34.4145 38.5531 34.3202 38.5531 34.0939 C 38.5531 33.4149 39.4017 31.8871 39.4017 30.3593 C 39.4017 28.4732 37.8361 27.2660 35.3844 27.2660 C 34.0451 27.2660 32.7248 27.3980 31.4611 27.6432 C 31.0461 17.7032 26.3307 9.8756 19.1256 9.8756 C 14.2782 9.8756 10.5436 14.0063 10.5436 19.2687 C 10.5436 25.4176 14.5423 30.6799 19.5217 34.1693 C 17.3149 36.3384 15.5985 38.8093 14.5423 41.1670 L 1.1883 41.1670 C .5281 41.1670 0 41.6574 0 42.3175 C 0 42.9777 .5281 43.4869 1.1883 43.4869 Z M 13.4106 19.2687 C 13.4106 15.5907 15.9003 12.7426 19.1256 12.7426 C 24.7841 12.7426 28.4432 19.7780 28.6130 28.4166 C 26.0101 29.3219 23.6335 30.6988 21.5776 32.3397 C 17.6544 29.6237 13.4106 25.1347 13.4106 19.2687 Z M .6413 37.1495 C 1.1317 37.6399 1.8673 37.6210 2.3765 37.1495 L 4.7342 34.7918 L 7.0919 37.1495 C 7.5823 37.6399 8.3368 37.6399 8.8272 37.1495 C 9.3176 36.6591 9.3176 35.9046 8.8272 35.4142 L 6.4695 33.0754 L 8.8272 30.7177 C 9.3176 30.2273 9.3176 29.4917 8.8272 29.0012 C 8.3368 28.4920 7.5823 28.5109 7.0919 29.0012 L 4.7342 31.3401 L 2.3765 29.0012 C 1.8673 28.4920 1.1317 28.4920 .6413 29.0012 C .1509 29.4917 .1509 30.2461 .6413 30.7177 L 2.9990 33.0754 L .6413 35.4142 C .1509 35.9235 .1509 36.6591 .6413 37.1495 Z M 23.6335 36.5459 C 23.8787 36.6591 24.1051 36.7156 24.3314 36.7156 C 25.1047 36.7156 25.6517 36.1121 25.6517 35.4708 C 25.6517 34.9992 25.4254 34.5466 24.8784 34.2825 C 24.6143 34.1505 24.3503 34.0184 24.0674 33.8675 C 25.4254 32.9056 26.9343 32.0568 28.5564 31.4155 C 28.3300 35.0558 27.6322 38.4132 26.5571 41.1670 L 17.5790 41.1670 C 18.5597 39.3185 20.0309 37.3758 21.8982 35.6594 C 22.4641 35.9800 23.0488 36.2630 23.6335 36.5459 Z M 16.2586 45.6560 C 16.2586 44.9959 16.3718 44.2603 16.6170 43.4869 L 25.4820 43.4869 C 23.7844 46.6180 21.5022 48.5418 18.8993 48.5418 C 17.0886 48.5418 16.2586 47.3536 16.2586 45.6560 Z" />
    </svg>
  )
}

/** Clean monogram for the initials placement tool (sans, not script). */
function InitialsToolIcon() {
  return (
    <span className="placement-tool-initials" aria-hidden>
      S.H.
    </span>
  )
}

/** Text label icons for name / text tools (reads as the field type). */
function BracketToolLabel({ children }: { children: string }) {
  return (
    <span className="placement-tool-bracket" aria-hidden>
      {children}
    </span>
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
   * copy that explains boxes were designed earlier - not for filling now.
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
  /** Scrollable PDF stage (used for edge auto-scroll while dragging). */
  const stageRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<DocumentSurface | null>(null)
  const [surface, setSurface] = useState<DocumentSurface | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [cssSize, setCssSize] = useState({ width: pageWidth, height: pageWidth * 1.3 })
  const [pagePts, setPagePts] = useState({ width: 612, height: 792 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  /** Person 1 starts selected so tools are ready immediately. */
  const [activePerson, setActivePerson] = useState<number | null>(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)
  /** Optional label on fillable text fields (e.g. "Date", "Printed name"). */
  const [textFieldLabel, setTextFieldLabel] = useState('')
  /** Which person chip is showing the Nimiq address help tip (slotIndex). */
  const [walletHelpPerson, setWalletHelpPerson] = useState<number | null>(null)
  const walletHelpRootRef = useRef<HTMLDivElement | null>(null)
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
    /** Stage scroll at drag start — needed so auto-scroll maps pointer → page coords. */
    startScrollLeft: number
    startScrollTop: number
    slotWidth: number
    slotHeight: number
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
  /** Last pointer position during a slot drag (for continuous edge auto-scroll). */
  const lastDragPointerRef = useRef<{ x: number; y: number } | null>(null)
  const autoScrollRafRef = useRef<number | null>(null)
  /** Full-viewport stage workspace (toolbar + PDF) for dense placement work. */
  const [stageFullscreen, setStageFullscreen] = useState(false)
  /** Inner width of the stage frame — used to render a wider page in fullscreen. */
  const [stageInnerWidth, setStageInnerWidth] = useState(0)
  /** View zoom % applied on top of fit/base page width (placement only; not stored). */
  const [zoomPct, setZoomPct] = useState(100)
  const cssSizeRef = useRef(cssSize)
  cssSizeRef.current = cssSize
  const updateSlotRef = useRef<(id: string, patch: Partial<PlacementSlot>) => void>(() => {})

  /**
   * Undock placement tools to a fixed bar under the shell header while the user
   * scrolls the PDF (mobile + desktop). Scroll back up to the natural slot →
   * auto-dock. Portaled to body because .lr-view-blend transform + .action-dock
   * overflow break position:sticky/fixed in-tree. Disabled in stage fullscreen
   * (tools live in the fullscreen chrome).
   */
  const toolbarSlotRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const toolbarUndockedRef = useRef(false)
  const [toolbarUndocked, setToolbarUndocked] = useState(false)
  const [toolbarHeight, setToolbarHeight] = useState(0)
  const [toolbarUndockTop, setToolbarUndockTop] = useState(0)

  const people = plan.people.length > 0 ? plan.people : defaultPeople(1)
  const slots = plan.slots
  /** Placement tools need an active person (Person 1 is pre-selected). */
  const toolsDisabled = editDisabled || activePerson == null

  // Dismiss wallet address help when clicking outside or pressing Escape.
  useEffect(() => {
    if (walletHelpPerson == null) return
    const onPointerDown = (e: PointerEvent) => {
      const root = walletHelpRootRef.current
      if (root && e.target instanceof Node && root.contains(e.target)) return
      setWalletHelpPerson(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWalletHelpPerson(null)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [walletHelpPerson])

  // Preserve layout height when the bar is portaled out (avoids jump).
  useLayoutEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const measure = () => {
      const h = el.getBoundingClientRect().height
      if (h > 0) setToolbarHeight(h)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [toolbarUndocked, selectedId, tool, pageCount, activePerson, stageFullscreen])

  // Undock when the dock slot scrolls under the sticky shell header; re-dock on scroll up.
  // Works on desktop and mobile (not only narrow viewports).
  useEffect(() => {
    if (typeof window === 'undefined' || stageFullscreen) {
      toolbarUndockedRef.current = false
      setToolbarUndocked(false)
      return
    }

    const DOCK_SLACK_PX = 4
    let lastUndockTop = -1

    const update = () => {
      const slot = toolbarSlotRef.current
      if (!slot) return
      const header = document.querySelector('.lr-header')
      const headerBottom = header?.getBoundingClientRect().bottom ?? 0
      const undockTop = Math.max(0, Math.round(headerBottom + 6))
      // Only re-render when the sticky header height actually changes.
      if (undockTop !== lastUndockTop) {
        lastUndockTop = undockTop
        setToolbarUndockTop(undockTop)
      }

      const slotTop = slot.getBoundingClientRect().top
      if (toolbarUndockedRef.current) {
        // Scroll up far enough that the natural dock is back under the header line.
        if (slotTop >= headerBottom + DOCK_SLACK_PX) {
          toolbarUndockedRef.current = false
          setToolbarUndocked(false)
        }
      } else if (slotTop < headerBottom - DOCK_SLACK_PX) {
        toolbarUndockedRef.current = true
        setToolbarUndocked(true)
      }
    }

    update()
    window.addEventListener('scroll', update, { passive: true, capture: true })
    window.addEventListener('resize', update)
    // Visual viewport changes (mobile URL bar) move the sticky header.
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
    }
  }, [stageFullscreen])

  // If the active person was removed, fall back to the first remaining person.
  useEffect(() => {
    if (activePerson != null && !people.some(p => p.slotIndex === activePerson)) {
      setActivePerson(people[0]?.slotIndex ?? 1)
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

  /**
   * Base page width: docked prop size, or (in fullscreen) fit to stage.
   * Zoom multiplies this so placement boxes stay in normalized coords.
   */
  const basePageWidth = useMemo(() => {
    if (!stageFullscreen) return pageWidth
    const available = stageInnerWidth > 0 ? stageInnerWidth - 32 : 0
    if (available <= 0) return Math.max(pageWidth, 720)
    return Math.max(pageWidth, Math.min(available, 1100))
  }, [stageFullscreen, stageInnerWidth, pageWidth])

  const effectivePageWidth = useMemo(
    () => Math.max(160, Math.round(basePageWidth * (zoomPct / 100))),
    [basePageWidth, zoomPct],
  )

  const nudgeZoom = useCallback((delta: number) => {
    setZoomPct(prev =>
      Math.max(ZOOM_MIN_PCT, Math.min(ZOOM_MAX_PCT, prev + delta)),
    )
  }, [])

  useEffect(() => {
    if (!surface || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    surface
      .renderPage(pageNumber, effectivePageWidth, canvas)
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
    // stageFullscreen: portal remounts the canvas; re-paint after enter/exit.
  }, [surface, pageNumber, effectivePageWidth, stageFullscreen])

  // Measure stage content width for fullscreen page scaling.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const w = stage.clientWidth
      if (w > 0) setStageInnerWidth(w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [stageFullscreen])

  // Fullscreen: lock body scroll; Escape exits (after place-tool cancel is handled elsewhere).
  useEffect(() => {
    if (!stageFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Let the place-tool handler cancel an active tool first.
      if (tool !== 'select') return
      e.preventDefault()
      setStageFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [stageFullscreen, tool])

  const pageSlots = useMemo(
    () => slots.filter(s => s.pageIndex === pageNumber - 1),
    [slots, pageNumber],
  )

  const selectedSlot = useMemo(
    () => (selectedId ? slots.find(s => s.id === selectedId) ?? null : null),
    [selectedId, slots],
  )
  const selectedScalePercent = selectedSlot
    ? scalePercentFromSlot(selectedSlot)
    : PLACEMENT_SCALE_DEFAULT_PCT

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
          return 1
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
    // Draft-only - do not commit plan until blur/Enter/+/-/wheel.
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
  updateSlotRef.current = updateSlot

  const stopDragAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current)
      autoScrollRafRef.current = null
    }
    lastDragPointerRef.current = null
  }, [])

  /**
   * Map pointer + stage scroll delta to normalized slot origin and write it.
   * Scroll is included so edge auto-scroll keeps the box under the cursor.
   */
  const applyDragPosition = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current
    const stage = stageRef.current
    if (!drag || !stage) return
    const { width: pageW, height: pageH } = cssSizeRef.current
    if (pageW <= 0 || pageH <= 0) return
    const scrollDx = stage.scrollLeft - drag.startScrollLeft
    const scrollDy = stage.scrollTop - drag.startScrollTop
    let nx = drag.origX + (clientX - drag.startX + scrollDx) / pageW
    let ny = drag.origY + (clientY - drag.startY + scrollDy) / pageH
    nx = Math.min(Math.max(0, nx), 1 - drag.slotWidth)
    ny = Math.min(Math.max(0, ny), 1 - drag.slotHeight)
    updateSlotRef.current(drag.id, { x: nx, y: ny })
    setDragTick(t => t + 1)
  }, [])

  /**
   * While dragging near the stage edge, keep scrolling so long pages stay reachable.
   * Speed ramps with how deep the pointer sits in the edge band.
   */
  const tickDragAutoScroll = useCallback(() => {
    autoScrollRafRef.current = null
    const drag = dragRef.current
    const stage = stageRef.current
    const ptr = lastDragPointerRef.current
    if (!drag?.moved || !stage || !ptr) return

    const rect = stage.getBoundingClientRect()
    const EDGE = 52
    const MAX_SPEED = 18

    let vx = 0
    let vy = 0
    const distLeft = ptr.x - rect.left
    const distRight = rect.right - ptr.x
    const distTop = ptr.y - rect.top
    const distBottom = rect.bottom - ptr.y

    if (distLeft < EDGE) {
      vx = -MAX_SPEED * (1 - Math.max(0, distLeft) / EDGE)
    } else if (distRight < EDGE) {
      vx = MAX_SPEED * (1 - Math.max(0, distRight) / EDGE)
    }
    if (distTop < EDGE) {
      vy = -MAX_SPEED * (1 - Math.max(0, distTop) / EDGE)
    } else if (distBottom < EDGE) {
      vy = MAX_SPEED * (1 - Math.max(0, distBottom) / EDGE)
    }

    const maxScrollLeft = Math.max(0, stage.scrollWidth - stage.clientWidth)
    const maxScrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight)
    if (vx < 0 && stage.scrollLeft <= 0) vx = 0
    if (vx > 0 && stage.scrollLeft >= maxScrollLeft - 0.5) vx = 0
    if (vy < 0 && stage.scrollTop <= 0) vy = 0
    if (vy > 0 && stage.scrollTop >= maxScrollTop - 0.5) vy = 0

    if (vx === 0 && vy === 0) return

    stage.scrollLeft = Math.min(maxScrollLeft, Math.max(0, stage.scrollLeft + vx))
    stage.scrollTop = Math.min(maxScrollTop, Math.max(0, stage.scrollTop + vy))
    applyDragPosition(ptr.x, ptr.y)
    autoScrollRafRef.current = requestAnimationFrame(tickDragAutoScroll)
  }, [applyDragPosition])

  const ensureDragAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current != null) return
    autoScrollRafRef.current = requestAnimationFrame(tickDragAutoScroll)
  }, [tickDragAutoScroll])

  const setSelectedScalePercent = useCallback(
    (pct: number) => {
      if (!selectedSlot || locked) return
      updateSlot(selectedSlot.id, applyPlacementScale(selectedSlot, pct))
    },
    [selectedSlot, locked, updateSlot],
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
            : tool === 'text' || tool === 'date'
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
    const size = defaultSizeForKind(kind)
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

    // Date tool always labels the field "Date" (opens calendar picker at sign time).
    const label =
      tool === 'date' ? 'Date' : textFieldLabel.trim().slice(0, 80)
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
            // Field label only (e.g. "Date") - fill value comes later at sign time
            lockedContent: {
              text: label,
              fontSizeRatio: fontSizeRatioAtScale(
                DEFAULT_LABEL_FONT_RATIO,
                PLACEMENT_SCALE_DEFAULT_PCT,
              ),
              color: '#64748b',
            },
          }
        : {}),
    }

    patchPlan(p => ({ ...p, slots: [...p.slots, slot] }))
    setSelectedId(slot.id)
    if (
      kind === 'signature' ||
      kind === 'initial' ||
      kind === 'name' ||
      kind === 'text'
    ) {
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
      // Do not place or preventDefault here - mobile needs pointerdown+move to
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

    // Ghost follows pointer only for true hover / stationary tap preview - not while panning.
    if (!toolsDisabled && tool !== 'select' && !placeGesture?.cancelled) {
      const p = pointerToLocal(e)
      setPlacing({ type: tool, x: p.x, y: p.y })
    }
    const drag = dragRef.current
    if (!drag || editDisabled) return
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY)
    if (dist > 4) drag.moved = true
    if (!drag.moved) return
    lastDragPointerRef.current = { x: e.clientX, y: e.clientY }
    applyDragPosition(e.clientX, e.clientY)
    ensureDragAutoScroll()
  }

  const endDrag = () => {
    const drag = dragRef.current
    dragRef.current = null
    stopDragAutoScroll()
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
    const stage = stageRef.current
    dragRef.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX: slot.x,
      origY: slot.y,
      moved: false,
      startScrollLeft: stage?.scrollLeft ?? 0,
      startScrollTop: stage?.scrollTop ?? 0,
      slotWidth: slot.width,
      slotHeight: slot.height,
    }
    lastDragPointerRef.current = { x: e.clientX, y: e.clientY }
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
            : placing.type === 'text' || placing.type === 'date'
              ? 'text'
              : placing.type === 'checkmark'
                ? 'checkmark'
                : 'cross'
    const size = defaultSizeForKind(kind)
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

  // Fullscreen keeps tools in the panel chrome; undock only for page scroll dock.
  const toolbarUndockedActive = toolbarUndocked && !stageFullscreen
  const toolbarStyle: CSSProperties | undefined = (() => {
    const style: CSSProperties = {}
    if (activePersonColor) {
      ;(style as Record<string, string>)['--person-color'] = activePersonColor
    }
    if (toolbarUndockedActive) {
      ;(style as Record<string, string>)['--placement-toolbar-undock-top'] =
        `${toolbarUndockTop}px`
    }
    return Object.keys(style).length > 0 ? style : undefined
  })()

  /** Compact person switcher for fullscreen (full chips stay on the main layout). */
  const fullscreenPeopleNode = (
    <div
      className="placement-fullscreen-people"
      role="tablist"
      aria-label="Select person for placements"
    >
      <span className="placement-fullscreen-people-label">
        <UserRound size={14} strokeWidth={2.25} aria-hidden />
        Placing for
      </span>
      <div className="placement-fullscreen-people-chips">
        {people.map(p => {
          const color = personColor(p.slotIndex)
          const active = p.slotIndex === activePerson
          const label = p.displayName?.trim() || `Person ${p.slotIndex}`
          return (
            <button
              key={p.slotIndex}
              type="button"
              role="tab"
              aria-selected={active}
              className={`placement-fullscreen-person${active ? ' is-active' : ''}`}
              style={{ ['--person-color' as string]: color }}
              onClick={() => selectPerson(p.slotIndex)}
              disabled={editDisabled}
              title={label}
            >
              <span className="placement-fullscreen-person-swatch" aria-hidden />
              <span className="placement-fullscreen-person-name">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  useEffect(() => {
    return () => stopDragAutoScroll()
  }, [stopDragAutoScroll])

  const toolbarNode = (
    <div
      ref={toolbarRef}
      className={[
        'pdf-annotator-toolbar',
        'placement-editor-toolbar',
        activePersonColor ? 'has-person' : '',
        toolsDisabled && !locked ? 'is-tools-disabled' : '',
        toolbarUndockedActive ? 'is-undocked' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={toolbarStyle}
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
        <InitialsToolIcon />
      </button>
      <button
        type="button"
        className={`placement-tool-btn placement-tool-btn--label${tool === 'name' ? ' is-active' : ''}`}
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
        <BracketToolLabel>name</BracketToolLabel>
      </button>
      <button
        type="button"
        className={`placement-tool-btn placement-tool-btn--label${tool === 'text' ? ' is-active' : ''}`}
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
        <BracketToolLabel>text</BracketToolLabel>
      </button>
      <button
        type="button"
        className={`placement-tool-btn${tool === 'date' ? ' is-active' : ''}`}
        onClick={() => setTool('date')}
        disabled={toolsDisabled}
        title={
          activePerson == null
            ? 'Select a person first'
            : `Place date field for ${activeName}`
        }
        aria-label="Date"
        aria-pressed={tool === 'date'}
      >
        <Calendar size={17} strokeWidth={2.1} aria-hidden />
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
            : 'Place empty checkbox - click the box to toggle check on or off'
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
            : 'Place empty X box - click the box to toggle X on or off'
        }
        aria-label="X mark"
        aria-pressed={tool === 'cross'}
      >
        <Square size={17} strokeWidth={2.1} aria-hidden />
        <X size={11} strokeWidth={2.75} className="placement-tool-check-overlay" aria-hidden />
      </button>
      {selectedId && selectedSlot && !locked && (
        <>
          <span className="placement-toolbar-sep" aria-hidden />
          <label
            className="placement-scale-control"
            title={`Size ${selectedScalePercent}% (40%–140%)`}
          >
            <span className="placement-scale-label">Size</span>
            <input
              type="range"
              className="placement-scale-slider"
              min={PLACEMENT_SCALE_MIN_PCT}
              max={PLACEMENT_SCALE_MAX_PCT}
              step={PLACEMENT_SCALE_STEP_PCT}
              value={selectedScalePercent}
              onChange={e => setSelectedScalePercent(Number(e.target.value))}
              disabled={editDisabled}
              aria-label="Field size"
              aria-valuemin={PLACEMENT_SCALE_MIN_PCT}
              aria-valuemax={PLACEMENT_SCALE_MAX_PCT}
              aria-valuenow={selectedScalePercent}
              aria-valuetext={`${selectedScalePercent} percent`}
            />
            <span className="placement-scale-value" aria-hidden>
              {selectedScalePercent}%
            </span>
          </label>
        </>
      )}
      {tool === 'text' && !locked && (
        <label className="placement-text-label-field">
          <span className="visually-hidden">Text field label</span>
          <input
            type="text"
            value={textFieldLabel}
            onChange={e => setTextFieldLabel(e.target.value.slice(0, 80))}
            placeholder="Label (optional): City, Title…"
            maxLength={80}
            disabled={toolsDisabled}
          />
        </label>
      )}
      <span className="placement-toolbar-sep" aria-hidden />
      <div className="placement-toolbar-zoom" role="group" aria-label="Zoom">
        <button
          type="button"
          className="placement-tool-btn placement-tool-btn--sm"
          disabled={disabled || zoomPct <= ZOOM_MIN_PCT}
          onClick={() => nudgeZoom(-ZOOM_STEP_PCT)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={14} strokeWidth={2.25} aria-hidden />
        </button>
        <button
          type="button"
          className="placement-zoom-value"
          disabled={disabled || zoomPct === 100}
          onClick={() => setZoomPct(100)}
          title={zoomPct === 100 ? 'Zoom 100%' : 'Reset zoom to 100%'}
          aria-label={zoomPct === 100 ? `Zoom ${zoomPct} percent` : 'Reset zoom to 100 percent'}
        >
          {zoomPct}%
        </button>
        <button
          type="button"
          className="placement-tool-btn placement-tool-btn--sm"
          disabled={disabled || zoomPct >= ZOOM_MAX_PCT}
          onClick={() => nudgeZoom(ZOOM_STEP_PCT)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={14} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
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
  )

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
        {!locked && !reviewMode && (
          <p className="placement-editor-hint placement-editor-hint--design" role="status">
            <strong>Designing, not signing.</strong> These boxes mark where people will sign later.
            Tap to place a field; drag to pan the page.
          </p>
        )}

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
            const nMark = slots.filter(
              s =>
                s.personSlotIndex === p.slotIndex &&
                (s.kind === 'checkmark' || s.kind === 'cross'),
            ).length
            const hasAnySlot = nSig + nInit + nName + nText + nMark > 0
            const fieldSummary =
              [
                nSig > 0 ? `${nSig} sig` : null,
                nInit > 0 ? `${nInit} init` : null,
                nName > 0 ? `${nName} name` : null,
                nText > 0 ? `${nText} text` : null,
                nMark > 0 ? `${nMark} mark` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No fields yet'
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
                    // Space/Enter activate the person tab for a11y - but must not steal
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
                  <span className="placement-person-swatch" aria-hidden />
                  <span className="placement-person-meta">
                    <span className="placement-person-label-row">
                      <span className="placement-person-label">Person {p.slotIndex}</span>
                      {active && (
                        <span className="placement-person-active-tag" aria-hidden>
                          Active
                        </span>
                      )}
                    </span>
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
                        <div
                          className="placement-person-wallet-block"
                          ref={
                            walletHelpPerson === p.slotIndex
                              ? walletHelpRootRef
                              : undefined
                          }
                          onClick={e => e.stopPropagation()}
                        >
                          <div className="placement-person-wallet-row">
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
                              aria-describedby={
                                walletHelpPerson === p.slotIndex
                                  ? `placement-wallet-help-${p.slotIndex}`
                                  : undefined
                              }
                            />
                            <button
                              type="button"
                              className={`placement-person-wallet-help${
                                walletHelpPerson === p.slotIndex ? ' is-open' : ''
                              }`}
                              title="If set, only this Nimiq wallet can sign as this person"
                              aria-label="Explain Nimiq address lock"
                              aria-expanded={walletHelpPerson === p.slotIndex}
                              aria-controls={`placement-wallet-help-${p.slotIndex}`}
                              onClick={e => {
                                e.stopPropagation()
                                selectPerson(p.slotIndex)
                                setWalletHelpPerson(cur =>
                                  cur === p.slotIndex ? null : p.slotIndex,
                                )
                              }}
                            >
                              ?
                            </button>
                          </div>
                          {walletHelpPerson === p.slotIndex && (
                            <p
                              id={`placement-wallet-help-${p.slotIndex}`}
                              className="placement-person-wallet-tip"
                              role="note"
                            >
                              Optional. If you enter an address, only that Nimiq wallet
                              can sign as this person. Leave blank so any invited signer
                              can claim the role.
                            </p>
                          )}
                        </div>
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
                    <span
                      className={
                        hasAnySlot
                          ? 'muted placement-person-counts'
                          : 'placement-person-counts placement-person-counts--empty'
                      }
                    >
                      {fieldSummary}
                    </span>
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {reviewMode && !stageFullscreen && (
        <p className="placement-editor-hint placement-editor-hint--locked" role="status">
          Field layout the organizer designed
          {filledSlotIds && filledSlotIds.size > 0
            ? ` · ${filledSlotIds.size} field${filledSlotIds.size === 1 ? '' : 's'} recorded as filled`
            : ''}
          . Signature images appear under Recorded signatures - not redrawn on this preview.
        </p>
      )}
      {locked && !reviewMode && !stageFullscreen && (
        <p className="placement-editor-hint placement-editor-hint--locked">
          Layout is set for signing. Use Back to edit placements to change it before anyone signs.
        </p>
      )}
      {placeError && !stageFullscreen && (
        <p className="placement-editor-error" role="alert">
          {placeError}
        </p>
      )}

      {(() => {
        /*
         * Fullscreen is portaled to document.body so journey transforms
         * (.lr-view-blend) and .action-dock overflow cannot trap position:fixed.
         * Canvas re-paints via the render effect (deps include stageFullscreen).
         */
        const stagePanel = (
          <div
            className={`placement-stage-panel${stageFullscreen ? ' is-fullscreen' : ''}`}
            role={stageFullscreen ? 'dialog' : undefined}
            aria-modal={stageFullscreen || undefined}
            aria-label={stageFullscreen ? 'Document placement full screen' : undefined}
          >
            {stageFullscreen && (
              <div className="placement-fullscreen-bar">
                <span className="placement-fullscreen-bar-title">Design the document</span>
                <button
                  type="button"
                  className="placement-tool-btn placement-stage-fullscreen-btn placement-stage-fullscreen-btn--bar"
                  onClick={() => setStageFullscreen(false)}
                  title="Exit full screen (Esc)"
                  aria-label="Exit full screen"
                >
                  <Minimize2 size={16} strokeWidth={2.25} aria-hidden />
                </button>
              </div>
            )}

            {stageFullscreen && fullscreenPeopleNode}

            <div ref={toolbarSlotRef} className="placement-editor-toolbar-slot">
              {toolbarUndockedActive && (
                <div
                  className="placement-editor-toolbar-spacer"
                  style={{ height: toolbarHeight > 0 ? toolbarHeight : undefined }}
                  aria-hidden
                />
              )}
              {toolbarUndockedActive && typeof document !== 'undefined'
                ? createPortal(toolbarNode, document.body)
                : toolbarNode}
            </div>

            {stageFullscreen && placeError && (
              <p className="placement-editor-error" role="alert">
                {placeError}
              </p>
            )}

            <div className="pdf-annotator-layout placement-stage-layout">
              <div className="placement-stage-frame">
                {!stageFullscreen && (
                  <button
                    type="button"
                    className="placement-tool-btn placement-stage-fullscreen-btn"
                    onClick={() => setStageFullscreen(true)}
                    title="Full screen"
                    aria-label="Open document full screen"
                  >
                    <Maximize2 size={16} strokeWidth={2.25} aria-hidden />
                  </button>
                )}
                <div
                  ref={stageRef}
                  className={`pdf-annotator-stage${stageFullscreen ? ' is-fullscreen' : ''}`}
                >
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
                              width={defaultSizeForKind(tool).width * cssSize.width}
                              height={defaultSizeForKind(tool).height * cssSize.height}
                            />
                          ) : (
                            <div className="placement-slot-label">
                              <span className="placement-slot-person">{activeName}</span>
                              <span className="placement-slot-kind">
                                ·{' '}
                                {tool === 'date'
                                  ? 'Date'
                                  : tool === 'text' && textFieldLabel.trim()
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
          </div>
        )

        if (stageFullscreen && typeof document !== 'undefined') {
          return createPortal(stagePanel, document.body)
        }
        return stagePanel
      })()}

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
