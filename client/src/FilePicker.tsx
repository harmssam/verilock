import { FileText, FolderOpen } from 'lucide-react'
import { useId, useRef } from 'react'

interface FilePickerProps {
  accept?: string
  disabled?: boolean
  emptyLabel?: string
  file: File | null
  onChange: (file: File | null) => void
}

export function FilePicker({
  accept,
  disabled,
  emptyLabel = 'Load PDF',
  file,
  onChange,
}: FilePickerProps) {
  // Avoid bare React useId (":r0:") in htmlFor — some browsers flag those labels.
  const reactId = useId().replace(/:/g, '')
  const id = `file-picker-${reactId}`
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={`file-picker${file ? ' file-picker--has-file' : ''}`}>
      <div className="file-picker-row">
        <input
          ref={inputRef}
          id={id}
          type="file"
          className="file-picker-input"
          accept={accept}
          disabled={disabled}
          onChange={e => onChange(e.target.files?.[0] ?? null)}
        />
        <label
          htmlFor={id}
          className={`file-picker-btn${disabled ? ' file-picker-btn--disabled' : ''}`}
          onClick={() => {
            if (!disabled && inputRef.current) {
              inputRef.current.value = ''
            }
          }}
        >
          <FolderOpen size={16} strokeWidth={2.25} aria-hidden />
          {file ? 'Change file' : emptyLabel}
        </label>
        {file ? (
          <div className="file-picker-meta">
            <FileText size={15} strokeWidth={2.25} className="file-picker-meta-icon" aria-hidden />
            <span className="file-picker-name">{file.name}</span>
            <button
              type="button"
              className="file-picker-clear"
              disabled={disabled}
              onClick={() => {
                onChange(null)
                if (inputRef.current) inputRef.current.value = ''
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <span className="file-picker-hint muted">PDF only</span>
        )}
      </div>
      <p className="file-picker-privacy muted" role="note">
        Your PDF never leaves your computer — only the fingerprint is saved on our servers.
      </p>
    </div>
  )
}