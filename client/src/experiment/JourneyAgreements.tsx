import { Bell, LoaderCircle, Lock, PenLine } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  countActionable,
  getAgreementView,
  groupAgreements,
  isDocumentCreator,
} from '../agreements'
import { api } from '../api'
import type { SealDocument } from '../types'

interface JourneyAgreementsProps {
  token: string | null
  address: string | null
  /** Bump to force a refresh (e.g. after seal or sign). */
  refreshKey?: number
  onOpen: (doc: SealDocument) => void
  onSeal: (doc: SealDocument) => void
}

export function JourneyAgreements({
  token,
  address,
  refreshKey = 0,
  onOpen,
  onSeal,
}: JourneyAgreementsProps) {
  const [documents, setDocuments] = useState<SealDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) {
      setDocuments([])
      setError(null)
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
  }, [load, refreshKey])

  // Quiet refresh while the creator may be waiting on signers
  useEffect(() => {
    if (!token) return
    const id = window.setInterval(() => void load(), 45_000)
    return () => window.clearInterval(id)
  }, [token, load])

  if (!token || !address) return null

  const groups = groupAgreements(documents, address)
  const actionable = countActionable(documents, address)
  const ready = groups.ready_to_seal
  const needsYou = groups.needs_you

  if (loading && documents.length === 0) {
    return (
      <section className="journey-agreements journey-agreements--loading" aria-busy="true">
        <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
        <span className="muted">Checking your agreements…</span>
      </section>
    )
  }

  if (error && documents.length === 0) {
    return (
      <section className="journey-agreements journey-agreements--error" role="status">
        <p className="muted" style={{ margin: 0 }}>
          {error}
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => void load()}>
          Retry
        </button>
      </section>
    )
  }

  if (actionable === 0) {
    if (documents.length === 0) return null
    return (
      <section className="journey-agreements journey-agreements--quiet" aria-label="Your agreements">
        <p className="muted" style={{ margin: 0 }}>
          {documents.length} agreement{documents.length === 1 ? '' : 's'} for this wallet — nothing
          needs action right now.
        </p>
      </section>
    )
  }

  return (
    <section className="journey-agreements" aria-label="Agreements that need you">
      <header className="journey-agreements-head">
        <Bell size={18} strokeWidth={2.25} aria-hidden />
        <div>
          <strong>
            {actionable} agreement{actionable === 1 ? '' : 's'} need
            {actionable === 1 ? 's' : ''} your action
          </strong>
          <p className="muted" style={{ margin: '0.15rem 0 0' }}>
            {ready.length > 0
              ? 'All signatures are in — seal on Nimiq when you are ready.'
              : 'Open an agreement below to continue.'}
          </p>
        </div>
      </header>

      {ready.length > 0 && (
        <div className="journey-agreements-group">
          <h3 className="journey-agreements-label">Ready to seal</h3>
          <ul className="journey-agreements-list">
            {ready.map(doc => {
              const view = getAgreementView(doc, address)
              return (
                <li key={doc.id} className="journey-agreement-item journey-agreement-item--seal">
                  <button
                    type="button"
                    className="journey-agreement-main"
                    onClick={() => onOpen(doc)}
                  >
                    <span className="journey-agreement-title">{doc.title}</span>
                    <span className="muted journey-agreement-meta">
                      {view.detail}
                      {doc.originalFilename ? ` · ${doc.originalFilename}` : ''}
                    </span>
                    <span className="journey-agreement-headline">{view.headline}</span>
                  </button>
                  {isDocumentCreator(doc, address) && (
                    <button
                      type="button"
                      className="btn btn-primary journey-agreement-cta"
                      onClick={() => onSeal(doc)}
                    >
                      <Lock size={15} strokeWidth={2.25} aria-hidden />
                      Seal now
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {needsYou.length > 0 && (
        <div className="journey-agreements-group">
          <h3 className="journey-agreements-label">Your signature needed</h3>
          <ul className="journey-agreements-list">
            {needsYou.map(doc => {
              const view = getAgreementView(doc, address)
              return (
                <li key={doc.id} className="journey-agreement-item">
                  <button
                    type="button"
                    className="journey-agreement-main"
                    onClick={() => onOpen(doc)}
                  >
                    <span className="journey-agreement-title">{doc.title}</span>
                    <span className="muted journey-agreement-meta">
                      {view.detail}
                      {doc.originalFilename ? ` · ${doc.originalFilename}` : ''}
                    </span>
                    <span className="journey-agreement-headline">{view.headline}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary journey-agreement-cta"
                    onClick={() => onOpen(doc)}
                  >
                    <PenLine size={15} strokeWidth={2.25} aria-hidden />
                    Sign now
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
