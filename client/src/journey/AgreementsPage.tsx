import {
  Database,
  FilePlus,
  LoaderCircle,
  Lock,
  PenLine,
  Files,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { shortAddress } from '../addresses'
import { NimiqHexagonIcon } from '../NimiqHexagonIcon'
import {
  BUCKET_LABELS,
  BUCKET_ORDER,
  canDeleteDocument,
  canPurgeServerCopy,
  countActionable,
  filterAgreements,
  getAgreementView,
  groupAgreements,
  isDocumentCreator,
  isFullyOnChain,
  type AgreementBucket,
} from '../agreements'
import { api } from '../api'
import { writeCreditsBalanceCache } from '../creditsBalanceCache'
import { formatDataArchiveCredits } from '../dataArchivePricing'
import { shortHash } from '../pdf/hashPdf'
import { documentTypeLabel, type SealDocument } from '../types'
import { CancelAgreementModal, type CancelAgreementMode } from './CancelAgreementModal'
import { DataArchiveModal } from './DataArchiveModal'
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
  /** Optional: send user to pricing when they need credits for data archive. */
  onGetCredits?: () => void
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
  onGetCredits,
}: AgreementsPageProps) {
  const [documents, setDocuments] = useState<SealDocument[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [pendingCancel, setPendingCancel] = useState<SealDocument | null>(null)
  const [cancelMode, setCancelMode] = useState<CancelAgreementMode>('cancel')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [pendingArchive, setPendingArchive] = useState<SealDocument | null>(null)
  const [archiveFrameCount, setArchiveFrameCount] = useState(0)
  const [archiveCredits, setArchiveCredits] = useState(0)
  const [archiveBalance, setArchiveBalance] = useState<number | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveDone, setArchiveDone] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveEmailAvailable, setArchiveEmailAvailable] = useState(false)
  /** Sync guard — React state alone can miss double-clicks before re-render. */
  const archiveInFlightRef = useRef(false)
  /** Doc id being archived so background completion still updates the list. */
  const archiveDocIdRef = useRef<string | null>(null)
  /** False when user dismissed the modal while work continues in background. */
  const archiveModalOpenRef = useRef(false)
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

  useEffect(() => {
    let cancelled = false
    void api
      .features()
      .then(f => {
        if (cancelled) return
        setArchiveEmailAvailable(
          Boolean(f.emailNotifySendEnabled || f.emailNotifyConfigured || f.emailNotifyUi),
        )
      })
      .catch(() => {
        if (!cancelled) setArchiveEmailAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Reset progressive reveal when search or status filter changes.
  useEffect(() => {
    setVisibleByBucket({})
  }, [query, bucketFilter])

  const requestCancel = (doc: SealDocument) => {
    if (!token || !canDeleteDocument(doc, address)) return
    setCancelError(null)
    setCancelMode('cancel')
    setPendingCancel(doc)
  }

  const requestPurgeServer = (doc: SealDocument) => {
    if (!token || !canPurgeServerCopy(doc, address)) return
    setCancelError(null)
    setCancelMode('purge')
    setPendingCancel(doc)
  }

  const closeCancelModal = () => {
    if (cancellingId) return
    setPendingCancel(null)
    setCancelError(null)
    setCancelMode('cancel')
  }

  const confirmCancelAgreement = async () => {
    if (!token || !pendingCancel) return
    const allowed =
      cancelMode === 'purge'
        ? canPurgeServerCopy(pendingCancel, address)
        : canDeleteDocument(pendingCancel, address)
    if (!allowed) return
    setCancellingId(pendingCancel.id)
    setCancelError(null)
    setError(null)
    try {
      await api.deleteDocument(token, pendingCancel.id)
      setDocuments(prev => prev.filter(d => d.id !== pendingCancel.id))
      setPendingCancel(null)
      setCancelMode('cancel')
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : cancelMode === 'purge'
            ? 'Could not remove agreement from VeriLock'
            : 'Could not cancel agreement'
      setCancelError(message)
      setError(message)
    } finally {
      setCancellingId(null)
    }
  }

  const requestArchive = async (doc: SealDocument) => {
    if (!token || !isDocumentCreator(doc, address)) return
    if (archiveInFlightRef.current) return
    setArchiveError(null)
    setArchiveDone(false)
    setPendingArchive(doc)
    archiveModalOpenRef.current = true
    // Prefer list summary; refresh quote for live balance + frame count.
    const summary = doc.dataArchive
    setArchiveFrameCount(summary?.frameCount ?? 0)
    setArchiveCredits(summary?.credits ?? 0)
    setArchiveBalance(null)
    try {
      const quote = await api.getOnChainDataQuote(token, doc.id)
      setArchiveFrameCount(quote.frameCount)
      // alreadyPaid → show free resume in the modal (credits already held).
      setArchiveCredits(quote.alreadyPaid ? 0 : quote.credits)
      setArchiveBalance(quote.balance)
      if (quote.jobStatus === 'processing') {
        // Job still running (e.g. after a prior 524) — show progress and poll.
        setPendingArchive(doc)
        setArchiveBusy(true)
        setArchiveDone(false)
        archiveModalOpenRef.current = true
        void confirmArchive()
        return
      }
      if (quote.onChain) {
        setDocuments(prev =>
          prev.map(d =>
            d.id === doc.id
              ? {
                  ...d,
                  dataArchive: {
                    onChain: true,
                    eligible: false,
                    frameCount: quote.frameCount,
                    credits: quote.credits,
                    reason: quote.reason,
                  },
                }
              : d,
          ),
        )
        archiveModalOpenRef.current = false
        setPendingArchive(null)
      } else if (!quote.eligible && quote.reason) {
        setArchiveError(quote.reason)
      }
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Could not load archive quote')
    }
  }

  const closeArchiveModal = () => {
    archiveModalOpenRef.current = false
    setPendingArchive(null)
    if (!archiveInFlightRef.current) {
      setArchiveError(null)
      setArchiveDone(false)
      setArchiveBusy(false)
    }
  }

  const applyArchiveQuoteToDocs = useCallback(
    (
      docId: string,
      quote: {
        onChain: boolean
        eligible: boolean
        frameCount: number
        credits: number
        reason?: string
      },
    ) => {
      setDocuments(prev =>
        prev.map(d =>
          d.id === docId
            ? {
                ...d,
                dataArchive: {
                  onChain: quote.onChain,
                  eligible: quote.eligible,
                  frameCount: quote.frameCount,
                  credits: quote.credits,
                  reason: quote.reason,
                },
              }
            : d,
        ),
      )
    },
    [],
  )

  const confirmArchive = async (options?: { notifyEmail?: string | null }) => {
    if (!token || !pendingArchive) return
    if (archiveInFlightRef.current) return
    const docId = pendingArchive.id
    const docSnapshot = pendingArchive
    archiveInFlightRef.current = true
    archiveDocIdRef.current = docId
    archiveModalOpenRef.current = true
    setArchiveBusy(true)
    setArchiveDone(false)
    setArchiveError(null)
    try {
      // Starts background job and returns quickly (avoids Cloudflare 524 on multi-tx).
      const started = await api.archiveOnChainData(token, docId, {
        notifyEmail: options?.notifyEmail ?? null,
      })
      if (typeof started.balance === 'number') {
        writeCreditsBalanceCache(token, started.balance)
        setArchiveBalance(started.balance)
      }
      setArchiveFrameCount(started.frameCount || archiveFrameCount)
      setArchiveCredits(started.alreadyPaid ? 0 : started.credits || archiveCredits)

      if (started.onChain) {
        applyArchiveQuoteToDocs(docId, started)
        setArchiveBusy(false)
        if (archiveModalOpenRef.current) {
          setArchiveDone(true)
          setPendingArchive(docSnapshot)
        }
        return
      }

      // Poll until complete / failed (or max ~8 minutes for large streams).
      const deadline = Date.now() + 8 * 60_000
      let last: typeof started | null = started
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000))
        const quote = await api.getOnChainDataQuote(token, docId)
        last = quote as typeof started
        setArchiveFrameCount(quote.frameCount || archiveFrameCount)
        if (typeof quote.balance === 'number') {
          writeCreditsBalanceCache(token, quote.balance)
          setArchiveBalance(quote.balance)
        }
        if (quote.onChain || quote.jobStatus === 'complete') {
          applyArchiveQuoteToDocs(docId, quote)
          setArchiveBusy(false)
          if (archiveModalOpenRef.current) {
            setArchiveDone(true)
            setPendingArchive(docSnapshot)
          }
          return
        }
        if (quote.jobStatus === 'failed' && !quote.alreadyPaid) {
          // Failed and refunded — show error.
          applyArchiveQuoteToDocs(docId, quote)
          setArchiveBusy(false)
          setArchiveError(
            quote.error ||
              quote.reason ||
              'Could not write data to the Nimiq blockchain (credits refunded if nothing was written)',
          )
          if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
          return
        }
        if (quote.jobStatus === 'failed' && quote.alreadyPaid) {
          // Partial — can resume free; stop busy and show resume message.
          applyArchiveQuoteToDocs(docId, { ...quote, eligible: true })
          setArchiveBusy(false)
          setArchiveError(
            quote.error ||
              quote.reason ||
              'Partial write saved. Click Store forever again to resume (no extra charge).',
          )
          if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
          return
        }
        // Still processing — keep UI busy
      }

      // Timed out polling (job may still be running server-side).
      applyArchiveQuoteToDocs(docId, last ?? started)
      setArchiveBusy(false)
      setArchiveError(
        'Still writing in the background. Close this window and reopen Store forever later — if credits were charged, resume is free.',
      )
      if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
    } catch (err) {
      setArchiveBusy(false)
      // 524 / network: job may still be running or already paid — refresh quote.
      try {
        const quote = await api.getOnChainDataQuote(token, docId)
        if (typeof quote.balance === 'number') {
          writeCreditsBalanceCache(token, quote.balance)
          setArchiveBalance(quote.balance)
        }
        applyArchiveQuoteToDocs(docId, quote)
        if (quote.onChain) {
          if (archiveModalOpenRef.current) {
            setArchiveDone(true)
            setPendingArchive(docSnapshot)
          }
          return
        }
        if (quote.alreadyPaid || quote.jobStatus === 'processing') {
          setArchiveError(
            quote.jobStatus === 'processing'
              ? 'Connection dropped while writing — work may still be running. Wait a minute, then open Store forever again (resume is free if already paid).'
              : 'Request interrupted after credits were reserved. Click Store forever again to resume free of charge.',
          )
          if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
          return
        }
      } catch {
        /* ignore secondary failure */
      }
      setArchiveError(
        err instanceof Error
          ? err.message
          : 'Could not start blockchain storage — check My agreements and try again',
      )
      if (archiveModalOpenRef.current) {
        setPendingArchive(docSnapshot)
      }
    } finally {
      archiveInFlightRef.current = false
      if (archiveDocIdRef.current === docId) {
        archiveDocIdRef.current = null
      }
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
                  const canPurge = canPurgeServerCopy(doc, address)
                  const cancelling = cancellingId === doc.id
                  const archive = creator ? doc.dataArchive : null
                  const fullyOnChain = isFullyOnChain(doc)
                  const fingerprintLocked =
                    bucket === 'locked' ||
                    doc.status === 'locked' ||
                    doc.attestation?.status === 'confirmed'
                  const showArchiveUpsell =
                    creator &&
                    bucket === 'locked' &&
                    archive &&
                    !archive.onChain &&
                    archive.eligible
                  return (
                    <li
                      key={doc.id}
                      className={[
                        'agreements-page-item',
                        bucket === 'ready_to_seal' ? 'agreements-page-item--seal' : '',
                        showArchiveUpsell ? 'agreements-page-item--archive' : '',
                        fullyOnChain ? 'agreements-page-item--backed-up' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        type="button"
                        className="agreements-page-main"
                        onClick={() => onOpen(doc, preferSeal)}
                      >
                        <span className="agreements-page-title-row">
                          {fullyOnChain && (
                            <span
                              className="agreements-page-backed-icon"
                              title="Fingerprint and data stored on the Nimiq blockchain"
                            >
                              <ShieldCheck size={16} strokeWidth={2.25} aria-hidden />
                            </span>
                          )}
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
                        {fingerprintLocked && (
                          <span className="agreements-page-tags">
                            <span className="agreements-page-archive-badge agreements-page-archive-badge--lock">
                              <Lock size={12} strokeWidth={2.5} aria-hidden />
                              Fingerprint locked
                            </span>
                            {fullyOnChain && (
                              <span className="agreements-page-archive-badge agreements-page-archive-badge--data">
                                <Database size={12} strokeWidth={2.5} aria-hidden />
                                Data on blockchain
                              </span>
                            )}
                          </span>
                        )}
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
                        {showArchiveUpsell && (
                          <button
                            type="button"
                            className="btn btn-primary agreements-page-archive-btn"
                            onClick={() => void requestArchive(doc)}
                            title={
                              archive.credits > 0
                                ? `Store signatures & fields on the Nimiq blockchain (${formatDataArchiveCredits(archive.credits)})`
                                : 'Store signatures & fields on the Nimiq blockchain'
                            }
                          >
                            <Database size={15} strokeWidth={2.25} aria-hidden />
                            {archive.credits > 0
                              ? `Store forever · ${formatDataArchiveCredits(archive.credits)}`
                              : 'Store forever'}
                          </button>
                        )}
                        {canPurge && (
                          <button
                            type="button"
                            className={`btn btn-ghost agreements-page-purge${cancelling ? ' btn--busy' : ''}`}
                            disabled={Boolean(cancellingId)}
                            onClick={() => requestPurgeServer(doc)}
                            title="Removes the agreement from VeriLock’s server list. On-chain fingerprint and multi-tx data stay on Nimiq."
                          >
                            {cancelling ? (
                              <>
                                <LoaderCircle
                                  className="btn-spinner"
                                  size={15}
                                  strokeWidth={2.5}
                                  aria-hidden
                                />
                                Removing…
                              </>
                            ) : (
                              <>
                                <Trash2 size={15} strokeWidth={2.25} aria-hidden />
                                Remove from VeriLock
                              </>
                            )}
                          </button>
                        )}
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
        mode={cancelMode}
        busy={Boolean(pendingCancel && cancellingId === pendingCancel.id)}
        error={cancelError}
        onClose={closeCancelModal}
        onConfirm={() => void confirmCancelAgreement()}
      />

      <DataArchiveModal
        document={pendingArchive}
        frameCount={archiveFrameCount}
        credits={archiveCredits}
        balance={archiveBalance}
        busy={archiveBusy}
        done={archiveDone}
        error={archiveError}
        emailNotifyAvailable={archiveEmailAvailable}
        onClose={closeArchiveModal}
        onConfirm={opts => void confirmArchive(opts)}
        onGetCredits={
          onGetCredits
            ? () => {
                closeArchiveModal()
                onGetCredits()
              }
            : undefined
        }
      />
    </section>
  )
}
