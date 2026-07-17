/**
 * Construction-phase placement editor: name people, place empty signature/name
 * slots on a local PDF, drag/delete until Lock. No ink payloads here.
 */
import {
  Check,
  Lock,
  PenLine,
  Trash2,
  Type,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { isValidNimiqAddress, normalizeAddress, shortAddress } from '../addresses'
import {
  type ConstructionPerson,
  type ConstructionPlan,
  type PlacementKind,
  type PlacementSlot,
  clamp01,
  defaultPeople,
  newSlotId,
} from './placements'
import {
  canvasRectToNormalized,
  normalizedToCanvasRect,
  paintMark,
} from './annotations'
import { loadPdfFromFile, renderPageToCanvas } from './pdfDocument'
import './PdfAnnotator.css'
import './PlacementEditor.css'

const PERSON_COLORS = ['#0f766e', '#b45309', '#1d4ed8', '#7c3aed'] as const

type Tool = 'select' | 'signature' | 'initial' | 'name' | 'text' | 'checkmark' | 'cross'

export interface PlacementEditorProps {
  file: File
  plan: ConstructionPlan
  onChange: (next: ConstructionPlan) => void
  /** Called when user confirms lock (parent computes planRoot + persists). */
  onLockRequest?: () => void | Promise<void>
  disabled?: boolean
  lockBusy?: boolean
  pageWidth?: number
}

function personColor(slotIndex: number): string {
  return PERSON_COLORS[(Math.max(1, slotIndex) - 1) % PERSON_COLORS.length]!
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
  onLockRequest,
  disabled = false,
  lockBusy = false,
  pageWidth = 560,
}: PlacementEditorProps) {
  const locked = plan.status === 'locked'
  const editDisabled = disabled || locked || lockBusy

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [cssSize, setCssSize] = useState({ width: pageWidth, height: pageWidth * 1.3 })
  const [pagePts, setPagePts] = useState({ width: 612, height: 792 })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  const [activePerson, setActivePerson] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)
  /** Optional label on fillable text fields (e.g. "Date", "Printed name"). */
  const [textFieldLabel, setTextFieldLabel] = useState('')
  const [placing, setPlacing] = useState<{ type: Tool; x: number; y: number } | null>(null)
  const [confirmLock, setConfirmLock] = useState(false)
  const dragRef = useRef<{
    id: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)
  const [dragTick, setDragTick] = useState(0)

  const people = plan.people.length > 0 ? plan.people : defaultPeople(1)
  const slots = plan.slots

  useEffect(() => {
    if (!people.some(p => p.slotIndex === activePerson) && people[0]) {
      setActivePerson(people[0].slotIndex)
    }
  }, [people, activePerson])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setDoc(null)
    setPageNumber(1)
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
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not open PDF')
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
    if (!doc || !canvasRef.current) return
    let cancelled = false
    const canvas = canvasRef.current
    renderPageToCanvas(doc, pageNumber, pageWidth, canvas)
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
  }, [doc, pageNumber, pageWidth])

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

  const setPeopleCount = (n: number) => {
    const count = Math.max(1, Math.min(4, n))
    const next: ConstructionPerson[] = []
    for (let i = 1; i <= count; i++) {
      const existing = people.find(p => p.slotIndex === i)
      next.push(
        existing ?? {
          slotIndex: i,
          displayName: `Person ${i}`,
        },
      )
    }
    const cs = plan.creatorSigningAs
    patchPlan(p => ({
      ...p,
      people: next,
      slots: p.slots.filter(s => next.some(x => x.slotIndex === s.personSlotIndex)),
      creatorSigningAs: cs != null && cs > count ? null : cs ?? null,
    }))
    if (activePerson > count) setActivePerson(count)
  }

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
    people.find(p => p.slotIndex === activePerson)?.displayName?.trim() ||
    `Person ${activePerson}`

  const placeAt = (cssX: number, cssY: number) => {
    if (editDisabled || tool === 'select') return

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
      if (kind === 'signature' && slots.filter(s => s.kind === 'signature').length >= 8) {
        setPlaceError('At most 8 signature lines on one agreement.')
        return
      }
      if (kind === 'initial' && slots.filter(s => s.kind === 'initial').length >= 12) {
        setPlaceError('At most 12 initial boxes on one agreement.')
        return
      }
      if (kind === 'name' && slots.filter(s => s.kind === 'name').length >= 8) {
        setPlaceError('At most 8 name lines on one agreement.')
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
      if (slots.filter(s => s.kind === 'text').length >= 12) {
        setPlaceError('At most 12 text fields on one agreement.')
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
    const slot: PlacementSlot = {
      id: newSlotId(),
      personSlotIndex: activePerson,
      kind,
      pageIndex: geo.pageIndex,
      x: clamp01(geo.x),
      y: clamp01(geo.y),
      width: clamp01(geo.width),
      height: clamp01(geo.height),
      ...(kind === 'checkmark' || kind === 'cross'
        ? {
            lockedContent: {
              mark: kind,
              color: kind === 'checkmark' ? '#0f766e' : '#b91c1c',
            },
          }
        : kind === 'text' && label
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

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (editDisabled) return
    if (tool !== 'select') {
      e.preventDefault()
      const p = pointerToLocal(e)
      placeAt(p.x, p.y)
      return
    }
    if (e.target === wrapRef.current || e.target === canvasRef.current) {
      setSelectedId(null)
    }
  }

  const onStagePointerMove = (e: React.PointerEvent) => {
    if (!editDisabled && tool !== 'select') {
      const p = pointerToLocal(e)
      setPlacing({ type: tool, x: p.x, y: p.y })
    }
    const drag = dragRef.current
    if (!drag || editDisabled) return
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
    dragRef.current = null
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
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  void dragTick

  const canLock =
    !locked &&
    slots.some(
      s =>
        s.kind === 'signature' ||
        s.kind === 'initial' ||
        s.kind === 'name' ||
        s.kind === 'text',
    ) &&
    people.length >= 1 &&
    Boolean(onLockRequest)

  const ghostStyle = (): React.CSSProperties | undefined => {
    if (!placing || placing.type === 'select') return undefined
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
    return {
      left: placing.x - w / 2,
      top: placing.y - h / 2,
      width: w,
      height: h,
      borderColor: personColor(activePerson),
      background: `${personColor(activePerson)}18`,
    }
  }

  const selectPerson = (slotIndex: number) => {
    setActivePerson(slotIndex)
    setPlaceError(null)
  }

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
            <label className="placement-editor-count">
              <span className="visually-hidden">How many people</span>
              <select
                value={people.length}
                disabled={editDisabled}
                onChange={e => setPeopleCount(Number(e.target.value))}
              >
                {[1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? 'person' : 'people'}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <label className="placement-creator-role">
          <span className="field-label">You (the organizer) will sign as</span>
          <select
            value={creatorSigningAs == null ? '' : String(creatorSigningAs)}
            disabled={editDisabled}
            onChange={e => {
              const v = e.target.value
              setCreatorSigningAs(v === '' ? null : Number(v))
            }}
          >
            <option value="">Not signing — organizing only</option>
            {people.map(p => (
              <option key={p.slotIndex} value={p.slotIndex}>
                Person {p.slotIndex}
                {p.displayName?.trim() ? ` · ${p.displayName.trim()}` : ''}
              </option>
            ))}
          </select>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            You do not have to be Person 1. Pick who you are, or none if others will sign.
          </span>
        </label>

        <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.78rem' }}>
          <strong>Name people now</strong> (click each person card and type e.g. Tom). Optional{' '}
          <strong>Nimiq address</strong> locks that wallet to that person. After you lock
          placements, names freeze — you only invite next. Name-only people pick themselves (or
          open a personal link).
        </p>

        <p className="placement-editor-active-banner" style={{ ['--person-color' as string]: personColor(activePerson) }}>
          Placing fields for <strong>{activeName}</strong>
          <span className="muted"> — click another person to place their boxes</span>
        </p>
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
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      selectPerson(p.slotIndex)
                    }
                  }}
                >
                  <span className="placement-person-swatch" aria-hidden />
                  <span className="placement-person-meta">
                    <span className="placement-person-label">Person {p.slotIndex}</span>
                    {!locked ? (
                      <>
                        <input
                          className="placement-person-name"
                          value={p.displayName}
                          disabled={editDisabled}
                          maxLength={80}
                          placeholder={`Name (e.g. Tom)`}
                          onFocus={() => selectPerson(p.slotIndex)}
                          onClick={e => {
                            e.stopPropagation()
                            selectPerson(p.slotIndex)
                          }}
                          onChange={e => {
                            selectPerson(p.slotIndex)
                            renamePerson(p.slotIndex, e.target.value)
                          }}
                          aria-label={`Name for person ${p.slotIndex}`}
                        />
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
                            Address should look like NQ… (36 characters)
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="placement-person-name-static">
                          {p.displayName || `Person ${p.slotIndex}`}
                        </span>
                        <span className="muted placement-person-counts">
                          {p.walletAddress
                            ? `Wallet ${shortAddress(p.walletAddress)} (required)`
                            : 'Name only — invitee picks this person'}
                        </span>
                      </>
                    )}
                    <span className="muted placement-person-counts">
                      {nSig} sig · {nInit} init · {nName} name · {nText} text
                    </span>
                  </span>
                  {active && <span className="placement-person-active-tag">Active</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="pdf-annotator-toolbar">
        <button
          type="button"
          className={`btn btn-ghost${tool === 'signature' ? ' is-active' : ''}`}
          onClick={() => {
            selectPerson(activePerson)
            setTool('signature')
          }}
          disabled={editDisabled}
          title={`Place signature line for ${activeName}`}
        >
          <PenLine size={14} strokeWidth={2.25} aria-hidden />
          Signature
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'initial' ? ' is-active' : ''}`}
          onClick={() => {
            selectPerson(activePerson)
            setTool('initial')
          }}
          disabled={editDisabled}
          title={`Place short initials box for ${activeName}`}
        >
          <PenLine size={14} strokeWidth={2.25} aria-hidden />
          Initial
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'name' ? ' is-active' : ''}`}
          onClick={() => {
            selectPerson(activePerson)
            setTool('name')
          }}
          disabled={editDisabled}
          title={`Place printed-name line for ${activeName}`}
        >
          <Type size={14} strokeWidth={2.25} aria-hidden />
          Name
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'text' ? ' is-active' : ''}`}
          onClick={() => {
            selectPerson(activePerson)
            setTool('text')
          }}
          disabled={editDisabled}
          title={`Place text field (date, etc.) for ${activeName}`}
        >
          <Type size={14} strokeWidth={2.25} aria-hidden />
          Text field
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'checkmark' ? ' is-active' : ''}`}
          onClick={() => setTool('checkmark')}
          disabled={editDisabled}
          title="Place a fixed checkmark (locked with plan)"
        >
          <Check size={14} strokeWidth={2.5} aria-hidden />
          Check
        </button>
        <button
          type="button"
          className={`btn btn-ghost${tool === 'cross' ? ' is-active' : ''}`}
          onClick={() => setTool('cross')}
          disabled={editDisabled}
          title="Place a fixed X (locked with plan)"
        >
          <X size={14} strokeWidth={2.5} aria-hidden />
          X
        </button>
        {selectedId && !locked && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => removeSlot(selectedId)}
            disabled={editDisabled}
          >
            <Trash2 size={14} strokeWidth={2.25} aria-hidden />
            Delete
          </button>
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
              disabled={editDisabled}
            />
          </label>
        )}
        <div className="pdf-annotator-pages">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || pageNumber <= 1}
            onClick={() => setPageNumber(p => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span>
            Page {pageNumber} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || pageNumber >= pageCount}
            onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {!locked && (
        <p className="placement-editor-hint muted">
          Click a person card so it is <strong>Active</strong>, then place signature / initial / name / text
          boxes (color-coded). Click a box to drag or delete it; Esc cancels place mode. Lock when
          the layout is right — boxes cannot move after that.
        </p>
      )}
      {locked && (
        <p className="placement-editor-hint placement-editor-hint--locked">
          <Lock size={14} strokeWidth={2.25} aria-hidden /> Placements locked
          {plan.planRoot ? (
            <>
              {' '}
              · root <code>{plan.planRoot.slice(0, 8)}…</code>
            </>
          ) : null}
        </p>
      )}
      {placeError && (
        <p className="placement-editor-error" role="alert">
          {placeError}
        </p>
      )}

      <div className="pdf-annotator-layout">
        <div className="pdf-annotator-stage">
          {loading && <p className="pdf-annotator-hint">Loading PDF…</p>}
          {loadError && <p className="pdf-annotator-hint">{loadError}</p>}
          <div
            ref={wrapRef}
            className="pdf-annotator-page-wrap"
            style={{ width: cssSize.width }}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              if (tool !== 'select') setPlacing(null)
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
                  >
                    {slot.kind === 'checkmark' || slot.kind === 'cross' ? (
                      <MarkPreview
                        kind={slot.lockedContent?.mark ?? slot.kind}
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
              {placing && tool !== 'select' && (
                <div className="pdf-annotator-ghost placement-ghost" style={ghostStyle()}>
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
                                  : tool === 'text'
                                    ? 'text'
                                    : tool === 'checkmark'
                                      ? 'checkmark'
                                      : 'cross',
                          )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside className="pdf-annotator-side placement-editor-side">
          <h4>Slots on this page</h4>
          {pageSlots.length === 0 ? (
            <p className="pdf-annotator-hint">No boxes on this page yet.</p>
          ) : (
            <ul className="placement-slot-list">
              {pageSlots.map(slot => {
                const person =
                  people.find(p => p.slotIndex === slot.personSlotIndex)?.displayName ||
                  `Person ${slot.personSlotIndex}`
                return (
                  <li key={slot.id}>
                    <button
                      type="button"
                      className={`placement-slot-list-item${selectedId === slot.id ? ' is-selected' : ''}`}
                      style={{ borderLeftColor: personColor(slot.personSlotIndex) }}
                      onClick={() => setSelectedId(slot.id)}
                    >
                      <span>
                        {person} · {kindLabel(slot.kind)}
                      </span>
                      {!locked && (
                        <span
                          role="button"
                          tabIndex={0}
                          className="placement-slot-list-del"
                          onClick={e => {
                            e.stopPropagation()
                            removeSlot(slot.id)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              removeSlot(slot.id)
                            }
                          }}
                        >
                          <Trash2 size={12} />
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="pdf-annotator-hint">
            Total: {slots.length} box{slots.length === 1 ? '' : 'es'} ·{' '}
            {slots.filter(s => s.kind === 'signature').length} sig ·{' '}
            {slots.filter(s => s.kind === 'initial').length} initial
            {slots.filter(s => s.kind === 'initial').length === 1 ? '' : 's'}
          </p>
        </aside>
      </div>

      {!locked && onLockRequest && (
        <div className="placement-editor-lock">
          {!confirmLock ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canLock || lockBusy || disabled}
              onClick={() => setConfirmLock(true)}
            >
              <Lock size={16} strokeWidth={2.25} aria-hidden />
              Lock placements
            </button>
          ) : (
            <div className="placement-editor-confirm">
              <p>
                Lock <strong>{slots.length}</strong> box
                {slots.length === 1 ? '' : 'es'} for{' '}
                <strong>{people.map(p => p.displayName || `Person ${p.slotIndex}`).join(', ')}</strong>
                ? You will not be able to move or delete them after this.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-primary${lockBusy ? ' btn--busy' : ''}`}
                  disabled={lockBusy || disabled}
                  onClick={() => {
                    void Promise.resolve(onLockRequest()).finally(() => setConfirmLock(false))
                  }}
                >
                  {lockBusy ? 'Locking…' : 'Yes, lock placements'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={lockBusy}
                  onClick={() => setConfirmLock(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MarkPreview({
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
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    c.width = Math.max(1, Math.round(width * dpr))
    c.height = Math.max(1, Math.round(height * dpr))
    c.style.width = `${width}px`
    c.style.height = `${height}px`
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    paintMark(ctx, kind, { left: 0, top: 0, width, height }, color)
  }, [kind, color, width, height])
  return <canvas ref={ref} className="placement-mark-preview" aria-hidden />
}
