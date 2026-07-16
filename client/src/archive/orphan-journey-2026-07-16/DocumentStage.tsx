import { FileText, Lock, ShieldCheck, Sparkles, Upload } from 'lucide-react'
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
import { formatFileSize } from './PdfDropZone'
import { signedCount, type DemoDoc, type JourneyStepId } from './types'

interface DocumentStageProps {
  step: JourneyStepId
  doc: DemoDoc | null
  file: File | null
  onFileChange?: (file: File | null) => void
  /** When true, the whole stage is a click + drag-and-drop target */
  accepting?: boolean
  sealing?: boolean
  disabled?: boolean
}

function isPdf(file: File): boolean {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return true
  return file.type === 'application/pdf' || file.type === 'application/x-pdf'
}

function filesFromDataTransfer(dt: DataTransfer): File[] {
  if (dt.files?.length) return Array.from(dt.files)
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

/**
 * Visual document card that doubles as the primary PDF drop/browse target
 * when `accepting` is true.
 */
export function DocumentStage({
  step,
  doc,
  file,
  onFileChange,
  accepting = false,
  sealing,
  disabled = false,
}: DocumentStageProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const displayName = doc?.fileName ?? file?.name ?? null
  const hasFile = Boolean(displayName)
  const fingerprinted = Boolean(doc)
  const signed = Boolean(doc && (doc.directSeal || signedCount(doc) > 0))
  const sealed = Boolean(doc?.sealed) || step === 'done'
  const verifying = step === 'verify' || step === 'done'
  const canInteract = accepting && !disabled && Boolean(onFileChange)

  const applyFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!onFileChange || !list?.length) return
      const pdfs = Array.from(list).filter(isPdf)
      if (pdfs.length === 0) {
        setError('Please choose a PDF file')
        return
      }
      setError(null)
      onFileChange(pdfs[0]!)
    },
    [onFileChange],
  )

  useEffect(() => {
    if (!canInteract) return
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
  }, [canInteract])

  const openPicker = () => {
    if (!canInteract) return
    const input = inputRef.current
    if (!input) return
    input.value = ''
    input.click()
  }

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!canInteract) return
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!canInteract) return
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
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
    if (!canInteract) return
    applyFiles(filesFromDataTransfer(e.dataTransfer))
  }

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    applyFiles(e.target.files)
    e.target.value = ''
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (!canInteract) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  let caption: string
  if (sealed) caption = 'Anchored on Nimiq'
  else if (step === 'fingerprint' && canInteract) caption = 'Step 2 - drop a PDF here, or browse'
  else if (fingerprinted && !canInteract) caption = 'Fingerprint lives here - file stays on device'
  else if (canInteract) caption = 'Drop a PDF here, or browse'
  else caption = 'Your document will appear here'

  return (
    <div
      className={[
        'doc-stage',
        hasFile ? 'doc-stage--has-file' : '',
        fingerprinted ? 'doc-stage--fingerprinted' : '',
        sealed ? 'doc-stage--sealed' : '',
        sealing ? 'doc-stage--sealing' : '',
        verifying ? 'doc-stage--verify' : '',
        canInteract ? 'doc-stage--accepting' : '',
        dragging ? 'doc-stage--dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={canInteract ? 'button' : undefined}
      tabIndex={canInteract ? 0 : undefined}
      aria-label={
        canInteract
          ? hasFile
            ? `Selected ${displayName}. Click to choose a different PDF, or drop a new one.`
            : 'Drop a PDF here or press Enter to browse'
          : undefined
      }
      onClick={() => {
        if (canInteract && !hasFile) openPicker()
      }}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {canInteract && (
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="pdf-drop-input"
          accept="application/pdf,.pdf"
          disabled={disabled}
          onChange={onInputChange}
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
        />
      )}

      <div className="doc-stage-glow" aria-hidden />
      <div className="doc-stage-orbit doc-stage-orbit--a" aria-hidden />
      <div className="doc-stage-orbit doc-stage-orbit--b" aria-hidden />

      <div className="doc-card" aria-hidden={!canInteract}>
        <div className="doc-card-spine" />
        <div className="doc-card-body">
          <div className="doc-card-lines" />
          {!hasFile ? (
            <div className="doc-card-empty">
              {canInteract ? (
                <Upload size={36} strokeWidth={1.75} />
              ) : (
                <FileText size={36} strokeWidth={1.75} />
              )}
              <span>{canInteract ? 'Drop PDF here' : 'Your PDF'}</span>
            </div>
          ) : (
            <div className="doc-card-filled">
              <FileText size={28} strokeWidth={2} />
              <strong className="doc-card-name">{displayName}</strong>
              {file && !fingerprinted && (
                <span className="doc-card-hash">{formatFileSize(file.size)}</span>
              )}
              {fingerprinted && doc && (
                <span className="doc-card-hash">{doc.fingerprintPreview}</span>
              )}
            </div>
          )}

          {signed && !sealed && doc && (
            <div className="doc-card-sigs">
              {doc.parties.map(p => (
                <span
                  key={p.id}
                  className={`doc-sig${p.signed ? ' doc-sig--done' : ''}`}
                  title={p.roleLabel}
                />
              ))}
            </div>
          )}

          {sealed && (
            <div className="doc-seal-stamp">
              <Lock size={18} strokeWidth={2.5} />
              <span>SEALED</span>
            </div>
          )}

          {verifying && fingerprinted && (
            <div className="doc-verify-badge">
              <ShieldCheck size={16} strokeWidth={2.5} />
              Integrity check
            </div>
          )}
        </div>
      </div>

      <div className="doc-stage-caption">
        {sealed ? <Sparkles size={14} strokeWidth={2.25} aria-hidden /> : null}
        <span>{caption}</span>
      </div>

      {canInteract && (
        <div className="doc-stage-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className="pdf-drop-browse doc-stage-browse"
            disabled={disabled}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              openPicker()
            }}
          >
            <Upload size={15} strokeWidth={2.25} aria-hidden />
            Browse files
          </button>
          {file && !fingerprinted && (
            <button
              type="button"
              className="pdf-drop-change"
              disabled={disabled}
              onClick={e => {
                e.preventDefault()
                e.stopPropagation()
                onFileChange?.(null)
                setError(null)
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="pdf-drop-error doc-stage-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
