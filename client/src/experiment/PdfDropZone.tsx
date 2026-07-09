import { FileText, Upload } from 'lucide-react'
import { useCallback, useId, useState, type ChangeEvent, type DragEvent } from 'react'

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
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PdfDropZone({
  file,
  onChange,
  disabled,
  label = 'Drop PDF here',
  hint = 'or click to browse — never leaves this device',
  accept = 'application/pdf,.pdf',
  multiple = false,
  onFiles,
  size = 'default',
}: PdfDropZoneProps) {
  const inputId = useId()
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

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setDragging(true)
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setDragging(true)
  }

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setDragging(false)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    if (!disabled) applyFiles(e.dataTransfer.files)
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyFiles(e.target.files)
    e.target.value = ''
  }

  return (
    <div className={`pdf-drop-wrap${size === 'hero' ? ' pdf-drop-wrap--hero' : ''}`}>
      <label
        htmlFor={inputId}
        className={[
          'pdf-drop',
          size === 'hero' ? 'pdf-drop--hero' : '',
          dragging ? 'pdf-drop--dragging' : '',
          file ? 'pdf-drop--has-file' : '',
          disabled ? 'pdf-drop--disabled' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          id={inputId}
          type="file"
          className="pdf-drop-input"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onInputChange}
        />

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
          </div>
        )}
      </label>
      {error && (
        <p className="pdf-drop-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
