import { Trash2 } from 'lucide-react'
import { canDeleteDocument, canRevealParticipantDetails } from './agreements'
import { DocumentNotesPanel } from './DocumentNotesPanel'
import { SignaturesPanel } from './SignaturesPanel'
import { documentTypeUsesNotes, type VerifyResult } from './types'
import './VerifyMatchesPanel.css'

function formatTimestamp(value: number | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function formatStatus(status: string): string {
  return status === 'locked' ? 'Locked on-chain' : status.replace(/_/g, ' ')
}

interface VerifyMatchesPanelProps {
  matches: VerifyResult[]
  appUrl: string
  highlightSlug?: string | null
  walletAddress?: string | null
  authToken?: string | null
  deletingId?: string | null
  onDelete?: (match: VerifyResult) => void
}

export function VerifyMatchesPanel({
  matches,
  appUrl,
  highlightSlug,
  walletAddress = null,
  authToken = null,
  deletingId = null,
  onDelete,
}: VerifyMatchesPanelProps) {
  if (matches.length === 0) return null

  return (
    <div className="verify-matches">
      {matches.length > 1 && (
        <p className="verify-matches-intro muted">
          This fingerprint matches {matches.length} agreements on VeriLock. Compare dates and IDs below
          {matches.some(match => match.status === 'locked')
            ? ' — prefer a locked on-chain record when one exists.'
            : '.'}
        </p>
      )}
      <ul className="verify-matches-list">
        {matches.map(match => {
          const highlighted = highlightSlug === match.slug
          const deletable = canDeleteDocument(match, walletAddress)
          return (
            <li
              key={match.id}
              className={`verify-match-card${highlighted ? ' verify-match-card--highlighted' : ''}`}
            >
              <div className="verify-match-lead">
                <span className={`verify-match-status verify-match-status--${match.status}`}>
                  {formatStatus(match.status)}
                </span>
                {match.originalFilename && (
                  <p className="document-filename verify-match-filename">
                    <span className="document-filename-label">File</span>
                    <span className="document-filename-value">{match.originalFilename}</span>
                  </p>
                )}
              </div>
              <h3 className="verify-match-title">{match.title}</h3>
              {documentTypeUsesNotes(match.type) &&
                typeof match.metadata?.notes === 'string' && (
                  <DocumentNotesPanel notes={match.metadata.notes} compact />
                )}
              <dl className="verify-match-meta">
                <div>
                  <dt>Document ID</dt>
                  <dd className="hash-chip">{match.slug}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatTimestamp(match.createdAt)}</dd>
                </div>
                <div>
                  <dt>{match.status === 'locked' ? 'Locked' : 'Last updated'}</dt>
                  <dd>{formatTimestamp(match.lockedAt ?? match.createdAt)}</dd>
                </div>
                <div>
                  <dt>Verify link</dt>
                  <dd>
                    <a className="hash-chip text-link" href={`${appUrl}/v/${match.slug}`}>
                      {appUrl}/v/{match.slug}
                    </a>
                  </dd>
                </div>
              </dl>
              {match.signatures.length > 0 && (
                <SignaturesPanel
                  signatures={match.signatures}
                  parties={match.parties}
                  compact
                  revealPrivate={canRevealParticipantDetails(match, walletAddress)}
                  authToken={authToken}
                />
              )}
              {deletable && onDelete && (
                <div className="verify-match-actions">
                  <button
                    type="button"
                    className={`btn btn-danger verify-match-delete${deletingId === match.id ? ' btn--busy' : ''}`}
                    disabled={Boolean(deletingId)}
                    aria-busy={deletingId === match.id}
                    onClick={() => onDelete(match)}
                  >
                    {deletingId === match.id ? (
                      'Deleting…'
                    ) : (
                      <>
                        <Trash2 size={16} strokeWidth={2.25} aria-hidden />
                        Delete agreement
                      </>
                    )}
                  </button>
                  <p className="muted verify-match-delete-hint">
                    You created this agreement and it is not locked yet. Deletion cannot be undone.
                  </p>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}