import { FilePlus } from 'lucide-react'
import { shortHash } from './pdf/hashPdf'
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  countActionable,
  getAgreementView,
  groupAgreements,
  isDocumentCreator,
} from './agreements'
import type { SealDocument } from './types'
import './AgreementsPanel.css'

interface AgreementsPanelProps {
  documents: SealDocument[]
  address: string | null
  activeDocId?: string | null
  compact?: boolean
  onOpen: (slug: string) => void
  onSeal?: (slug: string) => void
  onCreateNew?: () => void
}

function statusClass(bucket: string): string {
  if (bucket === 'locked') return 'status-signed'
  if (bucket === 'ready_to_seal') return 'status-ready'
  if (bucket === 'needs_you') return 'status-pending'
  return 'status-pending'
}

export function AgreementsPanel({
  documents,
  address,
  activeDocId,
  compact,
  onOpen,
  onSeal,
  onCreateNew,
}: AgreementsPanelProps) {
  const groups = groupAgreements(documents, address)
  const actionable = countActionable(documents, address)
  const visibleBuckets = compact
    ? BUCKET_ORDER.filter(bucket => bucket === 'needs_you' || bucket === 'ready_to_seal')
    : BUCKET_ORDER

  const renderItem = (doc: SealDocument) => {
    const view = getAgreementView(doc, address)
    const creator = isDocumentCreator(doc, address)
    const isActive = doc.id === activeDocId

    const showSealButton = view.cta === 'Seal now' && onSeal && creator

    return (
      <div
        key={doc.id}
        className={`agreement-item${isActive ? ' agreement-item--active' : ''}`}
      >
        <button type="button" className="agreement-item-open" onClick={() => onOpen(doc.slug)}>
          <div className="agreement-item-main">
            <strong>{doc.title}</strong>
            {doc.originalFilename && (
              <span className="agreement-item-filename">{doc.originalFilename}</span>
            )}
            <span className="muted agreement-item-meta">
              {creator ? 'You created' : 'You\'re a signer'} · {shortHash(doc.originalSha256)}
            </span>
          </div>
          <div className="agreement-item-side">
            <span className={`status-badge ${statusClass(view.bucket)}`}>{view.headline}</span>
            <span className="muted agreement-item-detail">{view.detail}</span>
            {!showSealButton && <span className="agreement-item-cta">{view.cta} →</span>}
          </div>
        </button>
        {showSealButton && (
          <button
            type="button"
            className="btn btn-primary agreement-seal-btn"
            onClick={() => onSeal(doc.slug)}
          >
            Seal now
          </button>
        )}
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="card agreements-panel">
        <div className="agreements-panel-header">
          <h2>Your agreements</h2>
          {onCreateNew && (
            <button type="button" className="btn btn-primary" onClick={onCreateNew}>
              <FilePlus size={16} strokeWidth={2.25} aria-hidden />
              New agreement
            </button>
          )}
        </div>
        <p className="muted">
          No agreements yet — create one by fingerprinting a PDF on your computer and collecting signatures.
        </p>
      </div>
    )
  }

  return (
    <div className={`card agreements-panel${compact ? ' agreements-panel--compact' : ''}`}>
      <div className="agreements-panel-header">
        <div>
          <h2>{compact ? 'Continue an agreement' : 'Your agreements'}</h2>
          {!compact && (
            <p className="muted agreements-panel-subtitle">
              {documents.length} total
              {actionable > 0 ? ` · ${actionable} need${actionable === 1 ? 's' : ''} your action` : ''}
            </p>
          )}
        </div>
        {onCreateNew && (
          <button type="button" className="btn btn-primary" onClick={onCreateNew}>
            <FilePlus size={16} strokeWidth={2.25} aria-hidden />
            {compact ? 'New' : 'New agreement'}
          </button>
        )}
      </div>

      {compact && actionable === 0 && (
        <p className="muted">No pending actions — pick an agreement below or start a new one.</p>
      )}

      {visibleBuckets.map(bucket => {
        const items = groups[bucket]
        if (items.length === 0) return null
        const limit = compact ? 4 : undefined
        const shown = limit ? items.slice(0, limit) : items
        const hidden = limit ? Math.max(0, items.length - shown.length) : 0

        return (
          <section key={bucket} className="agreement-group">
            <h3 className="agreement-group-title">
              {BUCKET_LABELS[bucket]}
              <span className="agreement-group-count">{items.length}</span>
            </h3>
            <ul className="agreement-list">
              {shown.map(doc => (
                <li key={doc.id}>{renderItem(doc)}</li>
              ))}
            </ul>
            {hidden > 0 && <p className="muted agreement-group-more">+{hidden} more in this section on Home</p>}
          </section>
        )
      })}
    </div>
  )
}