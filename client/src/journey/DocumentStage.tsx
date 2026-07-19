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
import {
  DOCUMENT_ACCEPT,
  isSupportedDocumentFile,
  unsupportedDocumentMessage,
} from '../pdf/documentKinds'
import { formatFileSize } from './PdfDropZone'
import { signedCount, type JourneyDoc, type JourneyStepId } from './types'

interface DocumentStageProps {
  step: JourneyStepId
  doc: JourneyDoc | null
  file: File | null
  onFileChange?: (file: File | null) => void
  /** When true, the whole stage is a click + drag-and-drop target */
  accepting?: boolean
  sealing?: boolean
  disabled?: boolean
  /**
   * Sign / verify-match mode: agreement metadata may exist, but the user must
   * still drop their own local file. Do not show the agreement filename as if
   * a file is already loaded.
   */
  localCopyRequired?: boolean
  /** When localCopyRequired + file selected, whether hash matches the agreement */
  localCopyMatches?: boolean | null
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
  localCopyRequired = false,
  localCopyMatches = null,
}: DocumentStageProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only treat a local File as "loaded" when the user must re-prove the document
  const hasLocalFile = Boolean(file)
  const displayName = localCopyRequired
    ? file?.name ?? null
    : doc?.fileName ?? file?.name ?? null
  const hasFile = localCopyRequired ? hasLocalFile : Boolean(displayName)
  const fingerprinted = localCopyRequired
    ? hasLocalFile && localCopyMatches === true
    : Boolean(doc)
  const signed =
    !localCopyRequired && Boolean(doc && (doc.directSeal || signedCount(doc) > 0))
  const sealed = !localCopyRequired && (Boolean(doc?.sealed) || step === 'done')
  const verifying = step === 'verify' || step === 'done'
  const canInteract = accepting && !disabled && Boolean(onFileChange)
  const needsLocalCopy = localCopyRequired && canInteract && !hasLocalFile

  const applyFiles = useCallback(
    (list: FileList | File[] | null) => {
      if (!onFileChange || !list?.length) return
      const docs = Array.from(list).filter(isSupportedDocumentFile)
      if (docs.length === 0) {
        setError(unsupportedDocumentMessage())
        return
      }
      setError(null)
      onFileChange(docs[0]!)
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
  else if (needsLocalCopy) {
    caption = doc?.fileName
      ? `Action required: drop your local copy of “${doc.fileName}”`
      : 'Action required: drop your local copy of the file'
  } else if (localCopyRequired && hasLocalFile && localCopyMatches === false) {
    caption = 'This file does not match the agreement fingerprint — try the original file'
  } else if (localCopyRequired && hasLocalFile && localCopyMatches === true) {
    caption = 'Local copy matches - fingerprint verified on this device'
  } else if (localCopyRequired && hasLocalFile) {
    caption = 'Checking fingerprint…'
  } else if (step === 'fingerprint' && canInteract)
    caption = 'Step 2 - drop a document here, or browse'
  else if (fingerprinted && !canInteract) caption = 'Fingerprint lives here - file stays on device'
  else if (canInteract) caption = 'Drop a document here, or browse'
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
        needsLocalCopy ? 'doc-stage--needs-local' : '',
        dragging ? 'doc-stage--dragging' : '',
        localCopyRequired && localCopyMatches === false ? 'doc-stage--mismatch' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role={canInteract ? 'button' : undefined}
      tabIndex={canInteract ? 0 : undefined}
      aria-label={
        canInteract
          ? hasFile
            ? `Selected ${displayName}. Click to choose a different file, or drop a new one.`
            : needsLocalCopy
              ? `Upload required. Drop your local copy of ${doc?.fileName ?? 'the file'} or press Enter to browse.`
              : 'Drop a document here or press Enter to browse'
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
          accept={DOCUMENT_ACCEPT}
          disabled={disabled}
          onChange={onInputChange}
          tabIndex={-1}
          onClick={e => e.stopPropagation()}
        />
      )}

      {needsLocalCopy && doc && (
        <div className="doc-stage-expect" role="note">
          <span className="doc-stage-expect-label">Agreement on record</span>
          <strong className="doc-stage-expect-title">{doc.title}</strong>
          <span className="doc-stage-expect-file">
            Expected file name: <code className="mono">{doc.fileName}</code>
          </span>
          <span className="doc-stage-expect-hint">
            The server never has your file — drop the same file from your device to prove the
            fingerprint.
          </span>
        </div>
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
              <span>
                {needsLocalCopy
                  ? 'Drop your file copy here'
                  : canInteract
                    ? 'Drop document here'
                    : 'Your document'}
              </span>
              {needsLocalCopy && (
                <span className="doc-card-empty-sub">Not uploaded yet - required to sign</span>
              )}
            </div>
          ) : (
            <div className="doc-card-filled">
              <FileText size={28} strokeWidth={2} />
              <strong className="doc-card-name">{displayName}</strong>
              {file && (
                <span className="doc-card-hash">{formatFileSize(file.size)}</span>
              )}
              {fingerprinted && doc && (
                <span className="doc-card-hash">{doc.fingerprintPreview}</span>
              )}
              {localCopyRequired && localCopyMatches === true && (
                <span className="doc-card-match-badge">
                  <ShieldCheck size={14} strokeWidth={2.5} aria-hidden />
                  Match
                </span>
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

          {verifying && fingerprinted && !localCopyRequired && (
            <div className="doc-verify-badge">
              <ShieldCheck size={16} strokeWidth={2.5} />
              Integrity check
            </div>
          )}
        </div>
      </div>

      <div className="doc-stage-caption">
        {sealed || fingerprinted ? <Sparkles size={14} strokeWidth={2.25} aria-hidden /> : null}
        <span>{caption}</span>
      </div>

      {canInteract && (
        <div className="doc-stage-actions" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            className={`pdf-drop-browse doc-stage-browse${needsLocalCopy ? ' doc-stage-browse--primary' : ''}`}
            disabled={disabled}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              openPicker()
            }}
          >
            <Upload size={15} strokeWidth={2.25} aria-hidden />
            {needsLocalCopy ? 'Choose file on this device' : 'Browse files'}
          </button>
          {file && (
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
