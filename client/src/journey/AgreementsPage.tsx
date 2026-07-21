import {
  FilePlus,
  LoaderCircle,
  Lock,
  PenLine,
  Files,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { shortAddress } from '../addresses'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  canDeleteDocument,
  countActionable,
  filterAgreements,
  getAgreementView,
  groupAgreements,
  isDocumentCreator,
  type AgreementBucket,
} from '../agreements'
import { api } from '../api'
import { shortHash } from '../pdf/hashPdf'
import { documentTypeLabel, type SealDocument } from '../types'
import { CancelAgreementModal } from './CancelAgreementModal'
import {
  journeyLoginEntryLabels,
  journeyLoginNeedsSheet,
  type JourneyConnectMode,
  type JourneyConnectRequest,
} from './journeyConnectUi'
import { LoginSheet } from './LoginSheet'

const PAGE_SIZE = 8
const SERVER_LIST_CAP = 100

type BucketFilter = 'all' | AgreementBucket

/** Compact chip copy — section headings still use BUCKET_LABELS. */
const CHIP_OPTIONS: Array<{ key: BucketFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'needs_you', label: 'Needs you' },
  { key: 'ready_to_seal', label: 'Ready to lock' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'locked', label: 'Locked' },
]

interface AgreementsPageProps {
  token: string | null
  address: string | null
  connecting: boolean
  connectMode: JourneyConnectMode
  onConnect: (options?: JourneyConnectRequest) => void
  onOpen: (doc: SealDocument, preferSeal?: boolean) => void
  onCreate: () => void
}

function sortBucket(docs: SealDocument[], bucket: AgreementBucket): SealDocument[] {
  const copy = [...docs]
  if (bucket === 'locked') {
    copy.sort((a, b) => (b.lockedAt ?? b.createdAt) - (a.lockedAt ?? a.createdAt))
  } else {
    copy.sort((a, b) => b.createdAt - a.createdAt)
  }
  return copy
}

function AgreementsLoginGate({
  connectMode,
  connecting,
  onConnect,
  entry,
}: {
  connectMode: JourneyConnectMode
  connecting: boolean
  onConnect: (options?: JourneyConnectRequest) => void
  entry: { idle: string; busy: string }
}) {
  const [loginOpen, setLoginOpen] = useState(false)
  const needsSheet = journeyLoginNeedsSheet(connectMode)

  return (
    <section className="agreements-page card" aria-label="Your agreements">
      <header className="agreements-page-header">
        <div>
          <h2>Your agreements</h2>
          <p className="muted agreements-page-subtitle">
            Agreements are tied to your Nimiq wallet. Login to see everything you created or signed.
          </p>
        </div>
      </header>
      {!needsSheet || !loginOpen ? (
        <button
          type="button"
          data-login-trigger
          className={`btn btn-primary${connecting ? ' btn--busy' : ''}`}
          disabled={connecting}
          onClick={() => {
            if (!needsSheet) {
              onConnect()
              return
            }
            setLoginOpen(true)
          }}
        >
          {connecting ? (
            <>
              <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
              {entry.busy}
            </>
          ) : (
            <>
              <NimiqHexagonIcon size={16} />
              {entry.idle}
            </>
          )}
        </button>
      ) : (
        <LoginSheet
          open
          connectMode={connectMode}
          connecting={connecting}
          onClose={() => setLoginOpen(false)}
          onProceed={onConnect}
          placement="inline"
        />
      )}
    </section>
  )
}

export function AgreementsPage({
  token,
  address,
  connecting,
  connectMode,
  onConnect,
  onOpen,
  onCreate,
}: AgreementsPageProps) {
  const [documents, setDocuments] = useState<SealDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [pendingCancel, setPendingCancel] = useState<SealDocument | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all')
  const [visibleByBucket, setVisibleByBucket] = useState<Partial<Record<AgreementBucket, number>>>(
    {},
  )

  const load = useCallback(async () => {
    if (!token) {
      setDocuments([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const me = await api.me(token)
      setDocuments(me.documents)
    } catch (err) {
      setDocuments([])
      setError(err instanceof Error ? err.message : 'Could not load agreements')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  // Reset progressive reveal when search or status filter changes.
  useEffect(() => {
    setVisibleByBucket({})
  }, [query, bucketFilter])

  const requestCancel = (doc: SealDocument) => {
    if (!token || !canDeleteDocument(doc, address)) return
    setCancelError(null)
    setPendingCancel(doc)
  }

  const closeCancelModal = () => {
    if (cancellingId) return
    setPendingCancel(null)
    setCancelError(null)
  }

  const confirmCancelAgreement = async () => {
    if (!token || !pendingCancel || !canDeleteDocument(pendingCancel, address)) return
    setCancellingId(pendingCancel.id)
    setCancelError(null)
    setError(null)
    try {
      await api.deleteDocument(token, pendingCancel.id)
      setDocuments(prev => prev.filter(d => d.id !== pendingCancel.id))
      setPendingCancel(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not cancel agreement'
      setCancelError(message)
      setError(message)
    } finally {
      setCancellingId(null)
    }
  }

  const filtered = useMemo(() => filterAgreements(documents, query), [documents, query])
  const groups = useMemo(() => groupAgreements(filtered, address), [filtered, address])
  const actionable = useMemo(() => countActionable(filtered, address), [filtered, address])
  const sealedCount = groups.locked.length
  const queryTrimmed = query.trim()
  const hasActiveFilters = queryTrimmed.length > 0 || bucketFilter !== 'all'

  const visibleBuckets = useMemo((): AgreementBucket[] => {
    if (bucketFilter === 'all') return BUCKET_ORDER
    return [bucketFilter]
  }, [bucketFilter])

  const chipCounts = useMemo(() => {
    const counts: Record<BucketFilter, number> = {
      all: filtered.length,
      needs_you: groups.needs_you.length,
      ready_to_seal: groups.ready_to_seal.length,
      waiting: groups.waiting.length,
      locked: groups.locked.length,
    }
    return counts
  }, [filtered.length, groups])

  const showMore = (bucket: AgreementBucket, total: number) => {
    setVisibleByBucket(prev => {
      const current = prev[bucket] ?? PAGE_SIZE
      return { ...prev, [bucket]: Math.min(current + PAGE_SIZE, total) }
    })
  }

  const clearFilters = () => {
    setQuery('')
    setBucketFilter('all')
  }

  if (!token || !address) {
    const entry = journeyLoginEntryLabels()
    return (
      <AgreementsLoginGate
        connectMode={connectMode}
        connecting={connecting}
        onConnect={onConnect}
        entry={entry}
      />
    )
  }

  if (loading && documents.length === 0) {
    return (
      <section className="agreements-page card agreements-page--loading" aria-busy="true">
        <LoaderCircle className="btn-spinner" size={18} strokeWidth={2.5} aria-hidden />
        <span className="muted">Loading your agreements…</span>
      </section>
    )
  }

  if (error && documents.length === 0) {
    return (
      <section className="agreements-page card" role="alert">
        <header className="agreements-page-header">
          <h2>Your agreements</h2>
        </header>
        <p className="muted" style={{ margin: '0 0 0.75rem' }}>
          {error}
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Retry
        </button>
      </section>
    )
  }

  if (documents.length === 0) {
    return (
      <section className="agreements-page card" aria-label="Your agreements">
        <header className="agreements-page-header">
          <div>
            <h2>Your agreements</h2>
            <p className="muted agreements-page-subtitle">
              No agreements yet for <span className="agreements-page-wallet">{shortAddress(address)}</span>.
              When you create or sign, they show up here — even years later.
            </p>
          </div>
        </header>
        <div className="agreements-page-empty">
          <Files size={28} strokeWidth={1.75} className="agreements-page-empty-icon" aria-hidden />
          <p className="muted" style={{ margin: 0 }}>
            Ready to fingerprint a document and seal it on Nimiq?
          </p>
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            <FilePlus size={16} strokeWidth={2.25} aria-hidden />
            Create &amp; seal
          </button>
        </div>
      </section>
    )
  }

  const subtitleParts: string[] = []
  if (queryTrimmed) {
    subtitleParts.push(
      `${filtered.length} of ${documents.length} match “${queryTrimmed.length > 32 ? `${queryTrimmed.slice(0, 32)}…` : queryTrimmed}”`,
    )
  } else {
    subtitleParts.push(`${documents.length} total`)
  }
  if (actionable > 0) {
    subtitleParts.push(`${actionable} need${actionable === 1 ? 's' : ''} your action`)
  }
  if (sealedCount > 0 && !queryTrimmed) {
    subtitleParts.push(`${sealedCount} sealed`)
  }

  const anyVisibleItems = visibleBuckets.some(b => groups[b].length > 0)

  return (
    <section className="agreements-page card" aria-label="Your agreements">
      <header className="agreements-page-header">
        <div>
          <h2>Your agreements</h2>
          <p className="muted agreements-page-subtitle">
            {subtitleParts.join(' · ')}
            {' · '}
            <span className="agreements-page-wallet">{shortAddress(address)}</span>
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          <FilePlus size={16} strokeWidth={2.25} aria-hidden />
          New agreement
        </button>
      </header>

      <div className="agreements-page-toolbar">
        <div className="agreements-page-search" role="search">
          <Search className="agreements-page-search-icon" size={16} strokeWidth={2.25} aria-hidden />
          <label htmlFor="agreements-search" className="visually-hidden">
            Search agreements
          </label>
          <input
            id="agreements-search"
            type="search"
            className="agreements-page-search-input"
            placeholder="Search title, file, or hash…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="agreements-page-search-clear"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X size={15} strokeWidth={2.25} aria-hidden />
            </button>
          )}
        </div>

        <div className="agreements-page-chips" role="group" aria-label="Filter by status">
          {CHIP_OPTIONS.map(({ key, label }) => {
            const count = chipCounts[key]
            const pressed = bucketFilter === key
            return (
              <button
                key={key}
                type="button"
                className={`agreements-page-chip${pressed ? ' agreements-page-chip--active' : ''}`}
                aria-pressed={pressed}
                onClick={() => setBucketFilter(key)}
              >
                <span className="agreements-page-chip-label">{label}</span>
                <span className="agreements-page-chip-count">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {!anyVisibleItems ? (
        <div className="agreements-page-no-match">
          <p className="muted" style={{ margin: 0 }}>
            {queryTrimmed
              ? `No agreements match “${queryTrimmed.length > 40 ? `${queryTrimmed.slice(0, 40)}…` : queryTrimmed}”.`
              : 'No agreements in this status.'}
          </p>
          {hasActiveFilters && (
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        visibleBuckets.map(bucket => {
          const items = sortBucket(groups[bucket], bucket)
          if (items.length === 0) return null
          const limit = visibleByBucket[bucket] ?? PAGE_SIZE
          const shown = items.slice(0, limit)
          const remaining = items.length - shown.length

          return (
            <div key={bucket} className="agreements-page-group">
              <h3 className="agreements-page-label">
                {BUCKET_LABELS[bucket]}
                <span className="agreements-page-count">{items.length}</span>
              </h3>
              <ul className="agreements-page-list">
                {shown.map(doc => {
                  const view = getAgreementView(doc, address)
                  const creator = isDocumentCreator(doc, address)
                  const preferSeal = view.cta === 'Lock now' && creator
                  const canCancel = canDeleteDocument(doc, address)
                  const cancelling = cancellingId === doc.id
                  return (
                    <li
                      key={doc.id}
                      className={`agreements-page-item${
                        bucket === 'ready_to_seal' ? ' agreements-page-item--seal' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="agreements-page-main"
                        onClick={() => onOpen(doc, preferSeal)}
                      >
                        <span className="agreements-page-title-row">
                          <strong className="agreements-page-title">{doc.title}</strong>
                          <span className="agreements-page-type">{documentTypeLabel(doc.type)}</span>
                        </span>
                        {doc.originalFilename && (
                          <span className="muted agreements-page-filename">{doc.originalFilename}</span>
                        )}
                        <span className="muted agreements-page-meta">
                          {creator ? 'You created' : "You're a signer"}
                          {' · '}
                          {view.detail}
                          {' · '}
                          <code className="mono">{shortHash(doc.originalSha256)}</code>
                        </span>
                        <span className="agreements-page-headline">{view.headline}</span>
                      </button>
                      <div className="agreements-page-actions">
                        <button
                          type="button"
                          className={`btn ${preferSeal ? 'btn-primary' : 'btn-secondary'} agreements-page-cta`}
                          onClick={() => onOpen(doc, preferSeal)}
                        >
                          {preferSeal ? (
                            <>
                              <Lock size={15} strokeWidth={2.25} aria-hidden />
                              Lock now
                            </>
                          ) : view.cta === 'Sign now' ? (
                            <>
                              <PenLine size={15} strokeWidth={2.25} aria-hidden />
                              Sign now
                            </>
                          ) : (
                            view.cta
                          )}
                        </button>
                        {canCancel && (
                          <button
                            type="button"
                            className={`btn btn-ghost agreements-page-cancel${cancelling ? ' btn--busy' : ''}`}
                            disabled={Boolean(cancellingId)}
                            onClick={() => requestCancel(doc)}
                          >
                            {cancelling ? (
                              <>
                                <LoaderCircle
                                  className="btn-spinner"
                                  size={15}
                                  strokeWidth={2.5}
                                  aria-hidden
                                />
                                Cancelling…
                              </>
                            ) : (
                              <>
                                <Trash2 size={15} strokeWidth={2.25} aria-hidden />
                                Cancel
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {remaining > 0 && (
                <div className="agreements-page-more">
                  <p className="muted agreements-page-more-meta">
                    Showing {shown.length} of {items.length}
                  </p>
                  <button
                    type="button"
                    className="btn btn-secondary agreements-page-more-btn"
                    onClick={() => showMore(bucket, items.length)}
                  >
                    Show {Math.min(PAGE_SIZE, remaining)} more
                  </button>
                </div>
              )}
            </div>
          )
        })
      )}

      {documents.length >= SERVER_LIST_CAP && (
        <p className="muted agreements-page-cap-note">
          Showing the latest {SERVER_LIST_CAP} agreements for this wallet.
        </p>
      )}

      <CancelAgreementModal
        document={pendingCancel}
        busy={Boolean(pendingCancel && cancellingId === pendingCancel.id)}
        error={cancelError}
        onClose={closeCancelModal}
        onConfirm={() => void confirmCancelAgreement()}
      />
    </section>
  )
}
