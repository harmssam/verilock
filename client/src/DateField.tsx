import { useEffect, useId, useRef, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import './DateField.css'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y!, m! - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== m! - 1 || date.getDate() !== d) return null
  return date
}

function formatDisplay(value: string): string {
  const date = parseIsoDate(value)
  if (!date) return ''
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function compareIso(a: string, b: string): number {
  return a.localeCompare(b)
}

function yearRange(min?: string, max?: string, anchorYear?: number): number[] {
  const current = new Date().getFullYear()
  let start = current - 10
  let end = current + 20

  const minDate = min ? parseIsoDate(min) : null
  const maxDate = max ? parseIsoDate(max) : null
  if (minDate) start = Math.min(start, minDate.getFullYear())
  if (maxDate) end = Math.max(end, maxDate.getFullYear())
  if (anchorYear !== undefined) {
    start = Math.min(start, anchorYear)
    end = Math.max(end, anchorYear)
  }

  const years: number[] = []
  for (let year = end; year >= start; year--) {
    years.push(year)
  }
  return years
}

interface DateFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  min?: string
  max?: string
  disabled?: boolean
}

export function DateField({
  value,
  onChange,
  placeholder = 'Select date',
  min,
  max,
  disabled,
}: DateFieldProps) {
  const fieldId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const selected = parseIsoDate(value)
  const todayIso = toIsoDate(new Date())
  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? new Date().getMonth())

  useEffect(() => {
    if (!open) return
    const selectedDate = parseIsoDate(value)
    if (selectedDate) {
      setViewYear(selectedDate.getFullYear())
      setViewMonth(selectedDate.getMonth())
    }
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
  const cells: Array<{ iso: string; day: number; inMonth: boolean }> = []

  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ iso: '', day: 0, inMonth: false })
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toIsoDate(new Date(viewYear, viewMonth, day))
    cells.push({ iso, day, inMonth: true })
  }
  while (cells.length % 7 !== 0) {
    cells.push({ iso: '', day: 0, inMonth: false })
  }

  const shiftMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1)
    setViewYear(next.getFullYear())
    setViewMonth(next.getMonth())
  }

  const isDisabledDay = (iso: string) => {
    if (!iso) return true
    if (min && compareIso(iso, min) < 0) return true
    if (max && compareIso(iso, max) > 0) return true
    return false
  }

  const pickDay = (iso: string) => {
    if (isDisabledDay(iso)) return
    onChange(iso)
    setOpen(false)
  }

  const years = yearRange(min, max, viewYear)

  return (
    <div ref={rootRef} className={`date-field${open ? ' date-field--open' : ''}`}>
      <button
        id={fieldId}
        type="button"
        className="date-field-trigger"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <Calendar className="date-field-icon" size={18} strokeWidth={2} aria-hidden />
        <span className={value ? 'date-field-value' : 'date-field-placeholder'}>
          {value ? formatDisplay(value) : placeholder}
        </span>
      </button>

      {open && (
        <div className="date-field-popover" role="dialog" aria-labelledby={fieldId}>
          <div className="date-field-header">
            <button
              type="button"
              className="date-field-nav"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={18} strokeWidth={2.25} aria-hidden />
            </button>

            <div className="date-field-header-picks">
              <label className="date-field-pick">
                <span className="visually-hidden">Month</span>
                <select
                  className="date-field-select"
                  value={viewMonth}
                  onChange={e => setViewMonth(Number(e.target.value))}
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index}>
                      {month}
                    </option>
                  ))}
                </select>
              </label>
              <label className="date-field-pick date-field-pick--year">
                <span className="visually-hidden">Year</span>
                <select
                  className="date-field-select date-field-select--year"
                  value={viewYear}
                  onChange={e => setViewYear(Number(e.target.value))}
                >
                  {years.map(year => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="button"
              className="date-field-nav"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={18} strokeWidth={2.25} aria-hidden />
            </button>
          </div>

          <div className="date-field-weekdays" aria-hidden>
            {WEEKDAYS.map(day => (
              <span key={day} className="date-field-weekday">
                {day}
              </span>
            ))}
          </div>

          <div className="date-field-grid">
            {cells.map((cell, index) => {
              if (!cell.inMonth) {
                return <span key={`pad-${index}`} className="date-field-day date-field-day--empty" />
              }

              const selectedDay = value === cell.iso
              const today = todayIso === cell.iso
              const disabledDay = isDisabledDay(cell.iso)

              return (
                <button
                  key={cell.iso}
                  type="button"
                  className={[
                    'date-field-day',
                    selectedDay ? 'date-field-day--selected' : '',
                    today ? 'date-field-day--today' : '',
                    disabledDay ? 'date-field-day--disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={disabledDay}
                  onClick={() => pickDay(cell.iso)}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>

          <div className="date-field-footer">
            <button
              type="button"
              className="date-field-footer-btn"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="date-field-footer-btn date-field-footer-btn--primary"
              disabled={isDisabledDay(todayIso)}
              onClick={() => pickDay(todayIso)}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  )
}