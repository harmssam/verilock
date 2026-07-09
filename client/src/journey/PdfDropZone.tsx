import { FileText, Upload } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'

export interface PdfDropZoneProps {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
  label?: string
  hint?: string
  accept?: string
  multiple?: boolean
  onFiles?: (files: File[]) => void
  /** larger hero drop target */
  size?: 'default' | 'hero'
}

function isPdf(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return true
  // Some browsers report empty type for dropped files
  return file.type === 'application/pdf' || file.type === 'application/x-pdf'
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function filesFromDataTransfer(dt: DataTransfer): File[] {
  if (dt.files?.length) return Array.from(dt.files)
  // Fallback for browsers that only populate items
  const out: File[] = []
  if (dt.items) {
    for (const item of Array.from(dt.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) out.push(f)
      }
    }
  }
  return out
}

export function PdfDropZone({
  file,
  onChange,
  disabled,
  label = 'Drop PDF here',
  hint = 'or click to browse - never leaves this device',
  accept = 'application/pdf,.pdf',
  multiple = false,
  onFiles,
  size = 'default',
}: PdfDropZoneProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const zoneRef = useRef<HTMLDivElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applyFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!list || list.length === 0) return
      const files = Array.from(list)
      const pdfs = files.filter(isPdf)
      if (pdfs.length === 0) {
        setError('Please choose a PDF file')
        return
      }
      setError(null)
      if (multiple && onFiles) {
        onFiles(pdfs)
        onChange(pdfs[0] ?? null)
      } else {
        onChange(pdfs[0] ?? null)
      }
    },
    [multiple, onChange, onFiles],
  )

  // Prevent the browser from navigating to a dropped file anywhere on the page
  // while this zone is mounted and active (fixes many "drop does nothing" cases).
  useEffect(() => {
    if (disabled) return

    const allow = (e: globalThis.DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      e.preventDefault()
    }

    window.addEventListener('dragover', allow)
    window.addEventListener('drop', allow)
    return () => {
      window.removeEventListener('dragover', allow)
      window.removeEventListener('drop', allow)
    }
  }, [disabled])

  const openPicker = () => {
    if (disabled) return
    const input = inputRef.current
    if (!input) return
    // Reset so selecting the same file again still fires onChange
    input.value = ''
    input.click()
  }

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
    setDragging(true)
  }

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragDepth.current = 0
    setDragging(false)
    if (disabled) return
    applyFiles(filesFromDataTransfer(e.dataTransfer))
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyFiles(e.target.files)
    // Keep value clear so re-picking works; applyFiles already ran
    e.target.value = ''
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  return (
    <div className={`pdf-drop-wrap${size === 'hero' ? ' pdf-drop-wrap--hero' : ''}`}>
      {/* Hidden input - opened via explicit click; not a wrapping <label> (more reliable DnD) */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        className="pdf-drop-input"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={onInputChange}
        tabIndex={-1}
      />

      <div
        ref={zoneRef}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-label={file ? `Selected ${file.name}. Click to replace, or drop a new PDF.` : label}
        className={[
          'pdf-drop',
          size === 'hero' ? 'pdf-drop--hero' : '',
          dragging ? 'pdf-drop--dragging' : '',
          file ? 'pdf-drop--has-file' : '',
          disabled ? 'pdf-drop--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => {
          if (!disabled && !file) openPicker()
        }}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {file ? (
          <div className="pdf-drop-file">
            <span className="pdf-drop-icon pdf-drop-icon--file" aria-hidden>
              <FileText size={size === 'hero' ? 28 : 22} strokeWidth={2.25} />
            </span>
            <div className="pdf-drop-file-meta">
              <strong className="pdf-drop-file-name">{file.name}</strong>
              <span className="pdf-drop-file-size muted">{formatFileSize(file.size)}</span>
            </div>
            <button
              type="button"
              className="pdf-drop-change"
              disabled={disabled}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                openPicker()
              }}
            >
              Change
            </button>
            <button
              type="button"
              className="pdf-drop-change"
              disabled={disabled}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                onChange(null)
                setError(null)
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="pdf-drop-empty">
            <span className="pdf-drop-icon" aria-hidden>
              <Upload size={size === 'hero' ? 28 : 22} strokeWidth={2.25} />
            </span>
            <strong className="pdf-drop-label">{label}</strong>
            <span className="pdf-drop-hint muted">{hint}</span>
            <button
              type="button"
              className="pdf-drop-browse"
              disabled={disabled}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                openPicker()
              }}
            >
              Browse files
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="pdf-drop-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
