import {
  FilePlus,
  LoaderCircle,
  Lock,
  PenLine,
  Files,
  Wallet,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { shortAddress } from '../addresses'
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  countActionable,
  getAgreementView,
  groupAgreements,
  isDocumentCreator,
  type AgreementBucket,
} from '../agreements'
import { api } from '../api'
import { shortHash } from '../pdf/hashPdf'
import { documentTypeLabel, type SealDocument } from '../types'
import { journeyConnectLabels, type JourneyConnectMode } from './journeyConnectUi'

interface AgreementsPageProps {
  token: string | null
  address: string | null
  connecting: boolean
  connectMode: JourneyConnectMode
  onConnect: () => void
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

  const groups = useMemo(() => groupAgreements(documents, address), [documents, address])
  const actionable = useMemo(() => countActionable(documents, address), [documents, address])
  const sealedCount = groups.locked.length

  if (!token || !address) {
    const labels = journeyConnectLabels(connectMode)
    return (
      <section className="agreements-page card" aria-label="Your agreements">
        <header className="agreements-page-header">
          <div>
            <h2>Your agreements</h2>
            <p className="muted agreements-page-subtitle">
              Agreements are tied to your Nimiq wallet. Connect to see everything you created or
              signed.
            </p>
          </div>
        </header>
        <button
          type="button"
          className={`btn btn-primary${connecting ? ' btn--busy' : ''}`}
          onClick={onConnect}
          disabled={connecting}
        >
          {connecting ? (
            <>
              <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
              {labels.busy}
            </>
          ) : (
            <>
              <Wallet size={16} strokeWidth={2.25} aria-hidden />
              {labels.idle}
            </>
          )}
        </button>
      </section>
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
            Ready to fingerprint a PDF and seal it on Nimiq?
          </p>
          <button type="button" className="btn btn-primary" onClick={onCreate}>
            <FilePlus size={16} strokeWidth={2.25} aria-hidden />
            Create &amp; seal
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="agreements-page card" aria-label="Your agreements">
      <header className="agreements-page-header">
        <div>
          <h2>Your agreements</h2>
          <p className="muted agreements-page-subtitle">
            {documents.length} total
            {actionable > 0
              ? ` · ${actionable} need${actionable === 1 ? 's' : ''} your action`
              : ''}
            {sealedCount > 0 ? ` · ${sealedCount} sealed` : ''}
            {' · '}
            <span className="agreements-page-wallet">{shortAddress(address)}</span>
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={onCreate}>
          <FilePlus size={16} strokeWidth={2.25} aria-hidden />
          New agreement
        </button>
      </header>

      {BUCKET_ORDER.map(bucket => {
        const items = sortBucket(groups[bucket], bucket)
        if (items.length === 0) return null
        return (
          <div key={bucket} className="agreements-page-group">
            <h3 className="agreements-page-label">
              {BUCKET_LABELS[bucket]}
              <span className="agreements-page-count">{items.length}</span>
            </h3>
            <ul className="agreements-page-list">
              {items.map(doc => {
                const view = getAgreementView(doc, address)
                const creator = isDocumentCreator(doc, address)
                const preferSeal = view.cta === 'Seal now' && creator
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
                    <button
                      type="button"
                      className={`btn ${preferSeal ? 'btn-primary' : 'btn-secondary'} agreements-page-cta`}
                      onClick={() => onOpen(doc, preferSeal)}
                    >
                      {preferSeal ? (
                        <>
                          <Lock size={15} strokeWidth={2.25} aria-hidden />
                          Seal now
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
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </section>
  )
}
