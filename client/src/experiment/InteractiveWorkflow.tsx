import {
  Check,
  Copy,
  Fingerprint,
  Link2,
  LoaderCircle,
  Lock,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PdfDropZone } from './PdfDropZone'
import {
  CREATOR_STEPS,
  type CreatorStepId,
  type DemoDoc,
  type StepStatus,
  type WorkflowStepDef,
} from './types'
import './InteractiveWorkflow.css'

function stepStatus(stepId: CreatorStepId, current: CreatorStepId): StepStatus {
  const order = CREATOR_STEPS.map(s => s.id)
  const i = order.indexOf(stepId)
  const c = order.indexOf(current)
  if (i < c) return 'done'
  if (i === c) return 'current'
  return 'upcoming'
}

function shortHash(name: string, size: number): string {
  // Demo-only fingerprint placeholder (not real SHA-256)
  let h = size
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0') + '…'
}

/** Whether the step's controls can be used (prerequisites), independent of "current" highlight. */
function canInteract(stepId: CreatorStepId, walletConnected: boolean, doc: DemoDoc | null): boolean {
  switch (stepId) {
    case 'connect':
      return true
    case 'create':
      return walletConnected
    case 'share':
      return Boolean(doc)
    case 'sign':
      return Boolean(doc && !doc.directSeal && !doc.sealed)
    case 'lock':
      return Boolean(
        doc && !doc.sealed && (doc.directSeal || doc.signed >= doc.required),
      )
    case 'verify':
      return Boolean(doc?.sealed)
    default:
      return false
  }
}

export function InteractiveWorkflow() {
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletBusy, setWalletBusy] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [directSeal, setDirectSeal] = useState(false)
  const [requiredSigners, setRequiredSigners] = useState(2)
  const [creating, setCreating] = useState(false)
  const [doc, setDoc] = useState<DemoDoc | null>(null)
  const [sharedAck, setSharedAck] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [signFile, setSignFile] = useState<File | null>(null)
  const [signerName, setSignerName] = useState('')
  const [signing, setSigning] = useState(false)
  const [sealing, setSealing] = useState(false)
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const [verifyResult, setVerifyResult] = useState<'idle' | 'match' | 'mismatch'>('idle')
  const [expandedId, setExpandedId] = useState<CreatorStepId | null>('connect')

  const currentStep = useMemo<CreatorStepId>(() => {
    if (!walletConnected) return 'connect'
    if (!doc) return 'create'
    if (doc.sealed) return 'verify'
    if (doc.directSeal || doc.signed >= doc.required) return 'lock'
    if (doc.signed > 0 || sharedAck) return 'sign'
    return 'share'
  }, [walletConnected, doc, sharedAck])

  useEffect(() => {
    setExpandedId(currentStep)
  }, [currentStep])

  const connectWallet = async () => {
    setWalletBusy(true)
    await new Promise(r => setTimeout(r, 700))
    setWalletConnected(true)
    setWalletBusy(false)
  }

  const createDoc = async () => {
    if (!pdfFile) return
    setCreating(true)
    await new Promise(r => setTimeout(r, 650))
    const id = `demo-${Date.now().toString(36)}`
    const docTitle = title.trim() || pdfFile.name.replace(/\.pdf$/i, '')
    setDoc({
      id,
      title: docTitle,
      fileName: pdfFile.name,
      fileSize: pdfFile.size,
      shareUrl: `${window.location.origin}/d/${id}`,
      signed: 0,
      required: directSeal ? 0 : Math.max(1, requiredSigners),
      sealed: false,
      directSeal,
    })
    setSharedAck(false)
    setCreating(false)
  }

  const copyShareLink = async () => {
    if (!doc) return
    try {
      await navigator.clipboard.writeText(doc.shareUrl)
      setLinkCopied(true)
      setSharedAck(true)
      window.setTimeout(() => setLinkCopied(false), 2000)
    } catch {
      setSharedAck(true)
    }
  }

  const signDoc = async () => {
    if (!doc || !signFile || !signerName.trim()) return
    setSigning(true)
    await new Promise(r => setTimeout(r, 600))
    setDoc(prev =>
      prev
        ? {
            ...prev,
            signed: Math.min(prev.required, prev.signed + 1),
          }
        : prev,
    )
    setSigning(false)
    setSignFile(null)
    setSignerName('')
  }

  const sealDoc = async () => {
    if (!doc) return
    setSealing(true)
    await new Promise(r => setTimeout(r, 900))
    setDoc(prev => (prev ? { ...prev, sealed: true } : prev))
    setSealing(false)
  }

  const runVerify = useCallback(() => {
    if (!verifyFile || !doc) {
      setVerifyResult('idle')
      return
    }
    const match =
      verifyFile.name === doc.fileName || Math.abs(verifyFile.size - doc.fileSize) < 1
    setVerifyResult(match ? 'match' : 'mismatch')
  }, [verifyFile, doc])

  useEffect(() => {
    if (verifyFile && doc?.sealed) runVerify()
    else setVerifyResult('idle')
  }, [verifyFile, doc, runVerify])

  const startOver = () => {
    setWalletConnected(false)
    setPdfFile(null)
    setTitle('')
    setDirectSeal(false)
    setRequiredSigners(2)
    setDoc(null)
    setSharedAck(false)
    setSignFile(null)
    setSignerName('')
    setVerifyFile(null)
    setVerifyResult('idle')
    setExpandedId('connect')
  }

  const toggleExpand = (id: CreatorStepId) => {
    setExpandedId(prev => (prev === id ? null : id))
  }

  return (
    <section className="iw" aria-labelledby="iw-title">
      <header className="iw-header">
        <h2 id="iw-title" className="iw-title">
          <Sparkles className="iw-title-icon" size={18} strokeWidth={2.25} aria-hidden />
          How it works
        </h2>
        <p className="iw-intro muted">
          Complete each step here — no jumping away to another tab.
        </p>
      </header>

      <div className="iw-now" role="status">
        <p>
          You&apos;re on{' '}
          <strong>step {CREATOR_STEPS.findIndex(s => s.id === currentStep) + 1}</strong>
          {' — '}
          {CREATOR_STEPS.find(s => s.id === currentStep)?.title}
        </p>
        {(doc || walletConnected) && (
          <button type="button" className="btn btn-secondary iw-start-over" onClick={startOver}>
            <RotateCcw size={14} strokeWidth={2.25} aria-hidden />
            Start over
          </button>
        )}
      </div>

      <ol className="iw-timeline" aria-label="Signing workflow">
        {CREATOR_STEPS.map((step, index) => {
          const status = stepStatus(step.id, currentStep)
          const expanded = expandedId === step.id
          const isLast = index === CREATOR_STEPS.length - 1
          const interactive = canInteract(step.id, walletConnected, doc)
          return (
            <li
              key={step.id}
              className={`iw-item iw-item--${status}${expanded ? ' iw-item--expanded' : ''}`}
            >
              <div className="iw-rail" aria-hidden>
                <span className="iw-num">
                  {status === 'done' ? <Check size={14} strokeWidth={2.5} /> : step.number}
                </span>
                {!isLast && <span className="iw-line" />}
              </div>

              <div className="iw-body">
                <button
                  type="button"
                  className="iw-step-head"
                  onClick={() => toggleExpand(step.id)}
                  aria-expanded={expanded}
                >
                  <div className="iw-step-head-text">
                    <strong>{step.title}</strong>
                    <span className="muted">{step.short}</span>
                  </div>
                  <span className={`iw-chevron${expanded ? ' iw-chevron--open' : ''}`} aria-hidden />
                </button>

                <div
                  className={`iw-panel${expanded ? ' iw-panel--open' : ''}`}
                  {...(!expanded ? { inert: true } : {})}
                >
                  <div className="iw-panel-inner">
                    <p className="iw-detail muted">{step.detail}</p>
                    <StepPanel
                      step={step}
                      interactive={interactive}
                      walletConnected={walletConnected}
                      walletBusy={walletBusy}
                      onConnect={() => void connectWallet()}
                      pdfFile={pdfFile}
                      onPdfChange={setPdfFile}
                      title={title}
                      onTitleChange={setTitle}
                      directSeal={directSeal}
                      onDirectSealChange={setDirectSeal}
                      requiredSigners={requiredSigners}
                      onRequiredSignersChange={setRequiredSigners}
                      creating={creating}
                      onCreate={() => void createDoc()}
                      doc={doc}
                      linkCopied={linkCopied}
                      onCopyLink={() => void copyShareLink()}
                      onSharedAck={() => setSharedAck(true)}
                      signFile={signFile}
                      onSignFileChange={setSignFile}
                      signerName={signerName}
                      onSignerNameChange={setSignerName}
                      signing={signing}
                      onSign={() => void signDoc()}
                      sealing={sealing}
                      onSeal={() => void sealDoc()}
                      verifyFile={verifyFile}
                      onVerifyFileChange={setVerifyFile}
                      verifyResult={verifyResult}
                    />
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <p className="iw-footnote muted">
        Experiment UI — demo state only. Drag-and-drop is PDF-first; multi-file can plug into the same
        drop zone later.
      </p>
    </section>
  )
}

interface StepPanelProps {
  step: WorkflowStepDef
  interactive: boolean
  walletConnected: boolean
  walletBusy: boolean
  onConnect: () => void
  pdfFile: File | null
  onPdfChange: (f: File | null) => void
  title: string
  onTitleChange: (v: string) => void
  directSeal: boolean
  onDirectSealChange: (v: boolean) => void
  requiredSigners: number
  onRequiredSignersChange: (n: number) => void
  creating: boolean
  onCreate: () => void
  doc: DemoDoc | null
  linkCopied: boolean
  onCopyLink: () => void
  onSharedAck: () => void
  signFile: File | null
  onSignFileChange: (f: File | null) => void
  signerName: string
  onSignerNameChange: (v: string) => void
  signing: boolean
  onSign: () => void
  sealing: boolean
  onSeal: () => void
  verifyFile: File | null
  onVerifyFileChange: (f: File | null) => void
  verifyResult: 'idle' | 'match' | 'mismatch'
}

function StepPanel(props: StepPanelProps) {
  const disabled = !props.interactive

  switch (props.step.id) {
    case 'connect':
      return (
        <div className="iw-actions">
          {props.walletConnected ? (
            <div className="iw-success-banner">
              <Check size={16} strokeWidth={2.5} aria-hidden />
              Wallet connected (demo)
            </div>
          ) : (
            <button
              type="button"
              className={`btn btn-primary${props.walletBusy ? ' btn--busy' : ''}`}
              onClick={props.onConnect}
              disabled={props.walletBusy}
            >
              {props.walletBusy ? (
                <>
                  <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                  Connecting…
                </>
              ) : (
                <>
                  <Wallet size={16} strokeWidth={2.25} aria-hidden />
                  Connect wallet
                </>
              )}
            </button>
          )}
        </div>
      )

    case 'create':
      if (props.doc) {
        return (
          <div className="iw-success-banner">
            <Fingerprint size={16} strokeWidth={2.25} aria-hidden />
            <span>
              Fingerprinted <strong>{props.doc.fileName}</strong>
              <span className="iw-mono">
                {' '}
                · {shortHash(props.doc.fileName, props.doc.fileSize)}
              </span>
            </span>
          </div>
        )
      }
      return (
        <div className="iw-actions iw-form">
          {!props.walletConnected && (
            <p className="iw-placeholder muted">Connect your wallet in step 1 to unlock this form.</p>
          )}
          <PdfDropZone
            file={props.pdfFile}
            onChange={props.onPdfChange}
            disabled={disabled}
            label="Drop PDF to fingerprint"
            hint="or click to browse — never uploaded"
          />
          <label className="iw-field">
            <span className="iw-field-label">Title (optional)</span>
            <input
              type="text"
              value={props.title}
              onChange={e => props.onTitleChange(e.target.value)}
              placeholder="e.g. Lease — 12 Maple St"
              disabled={disabled}
            />
          </label>
          <label className="iw-check">
            <input
              type="checkbox"
              checked={props.directSeal}
              onChange={e => props.onDirectSealChange(e.target.checked)}
              disabled={disabled}
            />
            <span>Seal directly (no co-signers)</span>
          </label>
          {!props.directSeal && (
            <label className="iw-field">
              <span className="iw-field-label">Required signers</span>
              <select
                value={props.requiredSigners}
                onChange={e => props.onRequiredSignersChange(Number(e.target.value))}
                disabled={disabled}
              >
                {[1, 2, 3, 4].map(n => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className={`btn btn-primary${props.creating ? ' btn--busy' : ''}`}
            onClick={props.onCreate}
            disabled={disabled || !props.pdfFile || props.creating}
          >
            {props.creating ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                Fingerprinting…
              </>
            ) : (
              <>
                <Fingerprint size={16} strokeWidth={2.25} aria-hidden />
                Create agreement
              </>
            )}
          </button>
        </div>
      )

    case 'share':
      if (!props.doc) {
        return (
          <p className="iw-placeholder muted">Create an agreement first — share tools appear here.</p>
        )
      }
      if (props.doc.directSeal) {
        return (
          <p className="muted">
            Direct seal selected — no co-signers. Continue to lock when ready.
          </p>
        )
      }
      return (
        <div className="iw-actions">
          <div className="iw-share-row">
            <div className="iw-share-url">
              <Link2 size={15} strokeWidth={2.25} aria-hidden />
              <code>{props.doc.shareUrl}</code>
            </div>
            <button type="button" className="btn btn-secondary" onClick={props.onCopyLink}>
              <Copy size={15} strokeWidth={2.25} aria-hidden />
              {props.linkCopied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
          <p className="iw-share-tip muted">
            <Share2 size={14} strokeWidth={2.25} aria-hidden />
            Also send the PDF file itself — signers verify it matches on their device.
          </p>
          <button type="button" className="btn btn-primary" onClick={props.onSharedAck}>
            I&apos;ve shared — continue to sign
          </button>
        </div>
      )

    case 'sign':
      if (!props.doc) {
        return <p className="iw-placeholder muted">Signing opens after you create and share.</p>
      }
      if (props.doc.directSeal) {
        return <p className="muted">Direct seal — signatures not required.</p>
      }
      if (props.doc.signed >= props.doc.required) {
        return (
          <div className="iw-success-banner">
            <Check size={16} strokeWidth={2.5} aria-hidden />
            All signatures collected ({props.doc.signed}/{props.doc.required})
          </div>
        )
      }
      return (
        <div className="iw-actions iw-form">
          <p className="muted" style={{ margin: 0 }}>
            Progress: <strong>
              {props.doc.signed}/{props.doc.required}
            </strong>{' '}
            signed
          </p>
          <PdfDropZone
            file={props.signFile}
            onChange={props.onSignFileChange}
            disabled={disabled}
            label="Drop the same PDF to verify"
            hint="must match the original fingerprint"
          />
          <label className="iw-field">
            <span className="iw-field-label">Your name</span>
            <input
              type="text"
              value={props.signerName}
              onChange={e => props.onSignerNameChange(e.target.value)}
              placeholder="Display name"
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            className={`btn btn-primary${props.signing ? ' btn--busy' : ''}`}
            onClick={props.onSign}
            disabled={disabled || !props.signFile || !props.signerName.trim() || props.signing}
          >
            {props.signing ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                Signing…
              </>
            ) : (
              'Sign agreement'
            )}
          </button>
        </div>
      )

    case 'lock':
      if (!props.doc) {
        return <p className="iw-placeholder muted">Seal appears when the document is ready.</p>
      }
      if (props.doc.sealed) {
        return (
          <div className="iw-success-banner">
            <Lock size={16} strokeWidth={2.25} aria-hidden />
            Sealed on-chain (demo)
          </div>
        )
      }
      if (!props.doc.directSeal && props.doc.signed < props.doc.required) {
        return (
          <p className="muted">
            Waiting for signatures ({props.doc.signed}/{props.doc.required}) before sealing.
          </p>
        )
      }
      return (
        <div className="iw-actions">
          <p className="muted" style={{ margin: 0 }}>
            Approve one Nimiq transaction to permanently record the fingerprint.
          </p>
          <button
            type="button"
            className={`btn btn-primary${props.sealing ? ' btn--busy' : ''}`}
            onClick={props.onSeal}
            disabled={disabled || props.sealing}
          >
            {props.sealing ? (
              <>
                <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
                Sealing…
              </>
            ) : (
              <>
                <Lock size={16} strokeWidth={2.25} aria-hidden />
                Seal on-chain
              </>
            )}
          </button>
        </div>
      )

    case 'verify':
      return (
        <div className="iw-actions iw-form">
          {!props.doc?.sealed && (
            <p className="muted" style={{ margin: 0 }}>
              After sealing, drop any copy of the PDF here to confirm integrity.
            </p>
          )}
          <PdfDropZone
            file={props.verifyFile}
            onChange={props.onVerifyFileChange}
            disabled={disabled}
            label="Drop PDF to verify"
            hint={props.doc?.sealed ? 'fingerprints locally' : 'available after seal'}
          />
          {props.verifyResult === 'match' && (
            <div className="iw-success-banner">
              <ShieldCheck size={16} strokeWidth={2.25} aria-hidden />
              Match — this copy matches the sealed fingerprint
            </div>
          )}
          {props.verifyResult === 'mismatch' && (
            <div className="iw-warn-banner">
              Mismatch — this file does not match the sealed document
            </div>
          )}
        </div>
      )

    default:
      return null
  }
}
