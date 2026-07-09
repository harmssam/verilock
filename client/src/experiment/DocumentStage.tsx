import { FileText, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import type { DemoDoc, JourneyStepId } from './types'

interface DocumentStageProps {
  step: JourneyStepId
  doc: DemoDoc | null
  pdfName: string | null
  sealing?: boolean
}

/**
 * Visual metaphor: a document object that gains fingerprint, signatures, and a seal.
 * Pure presentation — no form controls.
 */
export function DocumentStage({ step, doc, pdfName, sealing }: DocumentStageProps) {
  const hasFile = Boolean(pdfName || doc)
  const fingerprinted = Boolean(doc)
  const signed = Boolean(doc && (doc.directSeal || doc.signed > 0))
  const sealed = Boolean(doc?.sealed) || step === 'done'
  const verifying = step === 'verify'

  return (
    <div
      className={[
        'doc-stage',
        hasFile ? 'doc-stage--has-file' : '',
        fingerprinted ? 'doc-stage--fingerprinted' : '',
        sealed ? 'doc-stage--sealed' : '',
        sealing ? 'doc-stage--sealing' : '',
        verifying ? 'doc-stage--verify' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-hidden
    >
      <div className="doc-stage-glow" />
      <div className="doc-stage-orbit doc-stage-orbit--a" />
      <div className="doc-stage-orbit doc-stage-orbit--b" />

      <div className="doc-card">
        <div className="doc-card-spine" />
        <div className="doc-card-body">
          <div className="doc-card-lines" />
          {!hasFile ? (
            <div className="doc-card-empty">
              <FileText size={36} strokeWidth={1.75} />
              <span>Your PDF</span>
            </div>
          ) : (
            <div className="doc-card-filled">
              <FileText size={28} strokeWidth={2} />
              <strong className="doc-card-name">{doc?.fileName ?? pdfName}</strong>
              {fingerprinted && (
                <span className="doc-card-hash">{doc?.fingerprintPreview}</span>
              )}
            </div>
          )}

          {signed && !sealed && (
            <div className="doc-card-sigs">
              {Array.from({ length: doc?.required || 1 }).map((_, i) => (
                <span
                  key={i}
                  className={`doc-sig${doc && i < doc.signed ? ' doc-sig--done' : ''}`}
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
        {sealed ? (
          <>
            <Sparkles size={14} strokeWidth={2.25} />
            Anchored on Nimiq
          </>
        ) : fingerprinted ? (
          'Fingerprint lives here — file stays on device'
        ) : (
          'Drop a PDF to begin the journey'
        )}
      </div>
    </div>
  )
}
