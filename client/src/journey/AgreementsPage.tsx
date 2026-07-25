import {
  Archive,
  ArchiveRestore,
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
  BUCKET_PILL_LABELS,
  LIST_MODE_LABELS,
  LIST_MODE_ORDER,
  canDeleteDocument,
  canPurgeServerCopy,
  countActionable,
  filterAgreements,
  getAgreementView,
  isDocumentCreator,
  isFullyOnChain,
  isListArchived,
  isLockCta,
  partitionByListMode,
  sortAgreementsForMode,
  type AgreementListMode,
} from '../agreements'
import { api } from '../api'
import { publishCreditsBalance, writeCreditsBalanceCache } from '../creditsBalanceCache'
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

const MODE_OPTIONS: Array<{ key: AgreementListMode; label: string }> = LIST_MODE_ORDER.map(
  key => ({ key, label: LIST_MODE_LABELS[key] }),
)

/** Title with file extension (drops the separate filename line). */
function agreementListTitle(doc: SealDocument): string {
  const title = doc.title?.trim() || 'Untitled'
  const filename = doc.originalFilename?.trim()
  if (!filename) return title
  const extMatch = filename.match(/(\.[A-Za-z0-9]{1,10})$/)
  if (!extMatch) return title
  const ext = extMatch[1]
  if (title.toLowerCase().endsWith(ext.toLowerCase())) return title
  return `${title}${ext}`
}

/** When the agreement finished (lock, or last signature if all signed). */
function agreementCompletedAt(doc: SealDocument): number | null {
  if (doc.lockedAt) return doc.lockedAt
  const locked =
    doc.status === 'locked' ||
    doc.attestation?.status === 'confirmed' ||
    doc.signingProgress.readyToLock ||
    doc.status === 'ready_to_lock' ||
    (doc.signingProgress.required > 0 &&
      doc.signingProgress.signed >= doc.signingProgress.required)
  if (!locked) return null
  const times: number[] = []
  for (const s of doc.signatures) {
    if (typeof s.signedAt === 'number') times.push(s.signedAt)
  }
  for (const p of doc.parties) {
    if (typeof p.signedAt === 'number') times.push(p.signedAt)
  }
  if (times.length === 0) return null
  return Math.max(...times)
}

/** Compact list date — e.g. "Jul 24, 3:42 PM" (locale-aware). */
function formatAgreementWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatAgreementWhenFull(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

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
  /** Real broadcast progress (tx hashes recorded on server). */
  const [archiveFramesDone, setArchiveFramesDone] = useState(0)
  const [archiveJobPhase, setArchiveJobPhase] = useState<
    'write' | 'confirm' | 'done' | 'failed' | null
  >(null)
  const [archiveCredits, setArchiveCredits] = useState(0)
  const [archiveBalance, setArchiveBalance] = useState<number | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveDone, setArchiveDone] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveEmailAvailable, setArchiveEmailAvailable] = useState(false)
  const [recoveryBusy, setRecoveryBusy] = useState(false)

  const applyArchiveProgressFromQuote = useCallback(
    (quote: {
      frameCount?: number
      confirmedFrames?: number
      txHashes?: string[]
      onChain?: boolean
      jobStatus?: string
      progressPercent?: number
    }) => {
      const total = Math.max(0, Number(quote.frameCount) || 0)
      const doneFromHashes = Array.isArray(quote.txHashes) ? quote.txHashes.length : 0
      const doneFromConfirmed = Math.max(0, Number(quote.confirmedFrames) || 0)
      const done = Math.max(doneFromHashes, doneFromConfirmed)
      if (total > 0) setArchiveFrameCount(total)
      setArchiveFramesDone(Math.min(total > 0 ? total : done, done))
      if (quote.onChain || quote.jobStatus === 'complete') {
        setArchiveJobPhase('done')
      } else if (quote.jobStatus === 'failed') {
        setArchiveJobPhase('failed')
      } else if (total > 0 && done >= total) {
        setArchiveJobPhase('confirm')
      } else if (quote.jobStatus === 'processing' || done > 0) {
        setArchiveJobPhase('write')
      } else {
        setArchiveJobPhase('write')
      }
    },
    [],
  )
  /** Sync guard - React state alone can miss double-clicks before re-render. */
  const archiveInFlightRef = useRef(false)
  /** Doc id being archived so background completion still updates the list. */
  const archiveDocIdRef = useRef<string | null>(null)
  /** False when user dismissed the modal while work continues in background. */
  const archiveModalOpenRef = useRef(false)
  const [query, setQuery] = useState('')
  const [listMode, setListMode] = useState<AgreementListMode>('inbox')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [listArchiveBusyId, setListArchiveBusyId] = useState<string | null>(null)

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

  // Reset progressive reveal when search or list mode changes.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, listMode])

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
    setArchiveFramesDone(0)
    setArchiveJobPhase(null)
    setArchiveCredits(summary?.credits ?? 0)
    setArchiveBalance(null)
    try {
      const quote = await api.getOnChainDataQuote(token, doc.id)
      setArchiveFrameCount(quote.frameCount)
      applyArchiveProgressFromQuote(quote)
      // alreadyPaid → show free resume in the modal (credits already held).
      setArchiveCredits(quote.alreadyPaid ? 0 : quote.credits)
      setArchiveBalance(quote.balance)
      if (quote.jobStatus === 'processing') {
        // Job still running (e.g. after a prior 524) - show progress and poll.
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
        // Keep modal open in "done" state so creator can download recovery file.
        setArchiveFrameCount(quote.frameCount)
        setArchiveFramesDone(quote.frameCount)
        setArchiveJobPhase('done')
        setArchiveDone(true)
        setArchiveBusy(false)
        setPendingArchive(doc)
        archiveModalOpenRef.current = true
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
      setRecoveryBusy(false)
      setArchiveFramesDone(0)
      setArchiveJobPhase(null)
    }
  }

  const downloadArchiveRecovery = async () => {
    if (!token || !pendingArchive) return
    setRecoveryBusy(true)
    setArchiveError(null)
    try {
      const pack = await api.getOnChainDataRecovery(token, pendingArchive.id)
      const blob = new Blob([JSON.stringify(pack, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const short = pack.originalSha256.slice(0, 12)
      a.href = url
      a.download = `verilock-archive-${short}.json`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setArchiveError(
        err instanceof Error ? err.message : 'Could not download recovery file',
      )
    } finally {
      setRecoveryBusy(false)
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
        // Spend happens at job start — push header balance immediately.
        publishCreditsBalance(token, started.balance)
        setArchiveBalance(started.balance)
      }
      setArchiveFrameCount(started.frameCount || archiveFrameCount)
      setArchiveCredits(started.alreadyPaid ? 0 : started.credits || archiveCredits)
      applyArchiveProgressFromQuote(started)

      if (started.onChain) {
        applyArchiveQuoteToDocs(docId, started)
        if (typeof started.balance === 'number') {
          publishCreditsBalance(token, started.balance)
          setArchiveBalance(started.balance)
        }
        setArchiveBusy(false)
        setArchiveJobPhase('done')
        if (archiveModalOpenRef.current) {
          setArchiveDone(true)
          setPendingArchive(docSnapshot)
        }
        return
      }

      /**
       * Apply a progress snapshot from SSE or poll. Returns true when the wait
       * loop should stop (terminal success/failure).
       */
      const handleArchiveQuote = (
        quote: {
          frameCount?: number
          confirmedFrames?: number
          txHashes?: string[]
          onChain?: boolean
          jobStatus?: string
          progressPercent?: number
          balance?: number | null
          error?: string | null
          reason?: string
          alreadyPaid?: boolean
          eligible?: boolean
          credits?: number
        },
      ): boolean => {
        applyArchiveProgressFromQuote(quote)
        if (typeof quote.balance === 'number') {
          writeCreditsBalanceCache(token, quote.balance)
          setArchiveBalance(quote.balance)
        }
        const frameCount = Math.max(0, Number(quote.frameCount) || 0)
        const credits = Math.max(0, Number(quote.credits) || 0)
        if (quote.onChain || quote.jobStatus === 'complete') {
          applyArchiveQuoteToDocs(docId, {
            onChain: true,
            eligible: false,
            frameCount,
            credits,
            reason: quote.reason,
          })
          if (typeof quote.balance === 'number') {
            publishCreditsBalance(token, quote.balance)
            setArchiveBalance(quote.balance)
          }
          setArchiveBusy(false)
          setArchiveJobPhase('done')
          if (archiveModalOpenRef.current) {
            setArchiveDone(true)
            setPendingArchive(docSnapshot)
          }
          return true
        }
        if (quote.jobStatus === 'failed' && !quote.alreadyPaid) {
          applyArchiveQuoteToDocs(docId, {
            onChain: false,
            eligible: Boolean(quote.eligible),
            frameCount,
            credits,
            reason: quote.reason,
          })
          if (typeof quote.balance === 'number') {
            publishCreditsBalance(token, quote.balance)
            setArchiveBalance(quote.balance)
          }
          setArchiveBusy(false)
          setArchiveJobPhase('failed')
          setArchiveError(
            quote.error ||
              quote.reason ||
              'Could not write data to the Nimiq blockchain (credits refunded if nothing was written)',
          )
          if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
          return true
        }
        if (quote.jobStatus === 'failed' && quote.alreadyPaid) {
          applyArchiveQuoteToDocs(docId, {
            onChain: false,
            eligible: true,
            frameCount,
            credits,
            reason: quote.reason,
          })
          if (typeof quote.balance === 'number') {
            publishCreditsBalance(token, quote.balance)
            setArchiveBalance(quote.balance)
          }
          setArchiveBusy(false)
          setArchiveJobPhase('failed')
          setArchiveError(
            quote.error ||
              quote.reason ||
              'Partial write saved. Click Store forever again to resume (no extra charge).',
          )
          if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
          return true
        }
        return false
      }

      // Prefer SSE: server pushes after each transmitted frame (O(1) connection,
      // no quote rate-limit risk under many concurrent users). Poll is fallback.
      // Hard deadline so archiveInFlightRef cannot stick forever if the stream stalls.
      const waitDeadline = Date.now() + 8 * 60_000
      let last: typeof started | null = started
      let finished = false
      try {
        let terminalFromEvent = false
        const sseAbort = new AbortController()
        const sseTimeoutMs = Math.max(1_000, waitDeadline - Date.now())
        const sseTimer = window.setTimeout(() => sseAbort.abort(), sseTimeoutMs)
        let streamResult: 'complete' | 'failed' | 'closed' | 'aborted' = 'closed'
        try {
          streamResult = await api.streamOnChainDataProgress(
            token,
            docId,
            quote => {
              last = quote as typeof started
              if (handleArchiveQuote(quote)) {
                terminalFromEvent = true
              }
            },
            { signal: sseAbort.signal },
          )
        } finally {
          window.clearTimeout(sseTimer)
        }
        if (terminalFromEvent || streamResult === 'complete' || streamResult === 'failed') {
          finished = true
          // If stream ended without a terminal progress payload, pull one quote.
          if (!terminalFromEvent) {
            try {
              const quote = await api.getOnChainDataQuote(token, docId)
              last = quote as typeof started
              handleArchiveQuote(quote)
            } catch {
              /* UI already reflects last SSE event */
            }
          }
        } else if (streamResult === 'aborted') {
          console.warn('[data-archive] SSE wait timed out, polling for status')
        }
      } catch (streamErr) {
        // Stream open failed (proxy, old server, etc.) — fall back to poll.
        console.warn('[data-archive] SSE unavailable, polling', streamErr)
      }

      if (!finished) {
        // Slow poll fallback (~8s). Fine for resume / multi-instance / SSE drop.
        // First poll is immediate so a failed SSE open does not stall the UI.
        let pollDelayMs = 8000
        let firstPoll = true
        while (Date.now() < waitDeadline) {
          if (!firstPoll) {
            await new Promise(r => setTimeout(r, pollDelayMs))
          }
          firstPoll = false
          if (Date.now() >= waitDeadline) break
          try {
            const quote = await api.getOnChainDataQuote(token, docId)
            pollDelayMs = 8000
            last = quote as typeof started
            if (handleArchiveQuote(quote)) {
              finished = true
              break
            }
          } catch (pollErr) {
            const msg = pollErr instanceof Error ? pollErr.message : ''
            if (/too many requests|slow down|429/i.test(msg)) {
              pollDelayMs = Math.min(20_000, Math.round(pollDelayMs * 1.5))
              continue
            }
            throw pollErr
          }
        }
      }

      if (!finished) {
        // One last status pull before giving up (catches jobs that finished during a stall).
        try {
          const quote = await api.getOnChainDataQuote(token, docId)
          last = quote as typeof started
          if (handleArchiveQuote(quote)) {
            finished = true
          }
        } catch {
          /* keep timeout path */
        }
      }

      if (!finished) {
        // Timed out waiting (job may still be running server-side).
        applyArchiveQuoteToDocs(docId, last ?? started)
        if (typeof last?.balance === 'number') {
          publishCreditsBalance(token, last.balance)
          setArchiveBalance(last.balance)
        }
        setArchiveBusy(false)
        setArchiveError(
          'Still writing in the background. Close this window and reopen Store forever later - if credits were charged, resume is free.',
        )
        if (archiveModalOpenRef.current) setPendingArchive(docSnapshot)
      }
    } catch (err) {
      setArchiveBusy(false)
      // 524 / network: job may still be running or already paid - refresh quote.
      try {
        const quote = await api.getOnChainDataQuote(token, docId)
        if (typeof quote.balance === 'number') {
          publishCreditsBalance(token, quote.balance)
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
              ? 'Connection dropped while writing - work may still be running. Wait a minute, then open Store forever again (resume is free if already paid).'
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
          : 'Could not start blockchain storage - check My agreements and try again',
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
  const byMode = useMemo(() => partitionByListMode(filtered, address), [filtered, address])
  const actionable = useMemo(() => countActionable(filtered, address), [filtered, address])
  const modeItems = useMemo(
    () => sortAgreementsForMode(byMode[listMode], listMode, address),
    [byMode, listMode, address],
  )
  const queryTrimmed = query.trim()
  const hasActiveFilters = queryTrimmed.length > 0 || listMode !== 'inbox'

  const modeCounts = useMemo(
    () => ({
      inbox: byMode.inbox.length,
      completed: byMode.completed.length,
      archived: byMode.archived.length,
    }),
    [byMode],
  )

  const showMore = () => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, modeItems.length))
  }

  const clearFilters = () => {
    setQuery('')
    setListMode('inbox')
  }

  const setListArchived = async (doc: SealDocument, archived: boolean) => {
    if (!token) return
    setListArchiveBusyId(doc.id)
    setError(null)
    try {
      const { document: updated } = await api.setDocumentListArchived(token, doc.id, archived)
      setDocuments(prev => prev.map(d => (d.id === updated.id ? { ...d, ...updated } : d)))
      // If archive emptied inbox but completed has items, stay put; user chose the mode.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : archived
            ? 'Could not archive agreement'
            : 'Could not restore agreement',
      )
    } finally {
      setListArchiveBusyId(null)
    }
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
              When you create or sign, they show up here - even years later.
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
  if (modeCounts.completed > 0 && !queryTrimmed) {
    subtitleParts.push(`${modeCounts.completed} completed`)
  }

  const shown = modeItems.slice(0, visibleCount)
  const remaining = modeItems.length - shown.length
  const needsBackupCount = byMode.completed.filter(doc => {
    if (!isDocumentCreator(doc, address)) return false
    const archive = doc.dataArchive
    return archive && !archive.onChain && archive.eligible
  }).length

  const emptyCopy = (() => {
    if (queryTrimmed) {
      return `No agreements match “${queryTrimmed.length > 40 ? `${queryTrimmed.slice(0, 40)}…` : queryTrimmed}” in ${LIST_MODE_LABELS[listMode].toLowerCase()}.`
    }
    if (listMode === 'inbox') {
      return actionable === 0 && modeCounts.completed > 0
        ? 'Inbox is clear — completed agreements are under Completed.'
        : 'Nothing needs your attention right now.'
    }
    if (listMode === 'completed') {
      return 'No completed agreements yet. Locked fingerprints show up here.'
    }
    return 'Nothing archived. Hide completed agreements from Inbox and Completed with Archive.'
  })()

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

        <div className="agreements-page-chips" role="tablist" aria-label="Agreement list">
          {MODE_OPTIONS.map(({ key, label }) => {
            const count = modeCounts[key]
            const pressed = listMode === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                className={`agreements-page-chip${pressed ? ' agreements-page-chip--active' : ''}`}
                aria-selected={pressed}
                onClick={() => setListMode(key)}
              >
                <span className="agreements-page-chip-label">{label}</span>
                <span className="agreements-page-chip-count">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <p className="muted agreements-page-inline-error" role="alert">
          {error}
        </p>
      )}

      {listMode === 'completed' && needsBackupCount > 0 && (
        <p className="agreements-page-banner" role="status">
          <Database size={14} strokeWidth={2.25} aria-hidden />
          {needsBackupCount === 1
            ? '1 agreement can store signatures & fields on the blockchain.'
            : `${needsBackupCount} agreements can store signatures & fields on the blockchain.`}
        </p>
      )}

      {modeItems.length === 0 ? (
        <div className="agreements-page-no-match">
          <p className="muted" style={{ margin: 0 }}>
            {emptyCopy}
          </p>
          {listMode === 'inbox' && modeCounts.completed > 0 && !queryTrimmed && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setListMode('completed')}
            >
              View completed
            </button>
          )}
          {hasActiveFilters && listMode !== 'inbox' && (
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Back to Inbox
            </button>
          )}
          {queryTrimmed && (
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="agreements-page-group">
          <ul className="agreements-page-list">
            {shown.map(doc => {
              const view = getAgreementView(doc, address)
              const creator = isDocumentCreator(doc, address)
              const preferSeal = isLockCta(view.cta) && creator
              const freeComplete =
                creator &&
                view.bucket === 'ready_to_seal' &&
                view.cta === 'View & print'
              const canCancel = canDeleteDocument(doc, address)
              const canPurge = canPurgeServerCopy(doc, address)
              const cancelling = cancellingId === doc.id
              const listArchiving = listArchiveBusyId === doc.id
              const archived = isListArchived(doc)
              const archive = creator ? doc.dataArchive : null
              const fullyOnChain = isFullyOnChain(doc)
              const fingerprintLocked =
                view.bucket === 'locked' ||
                doc.status === 'locked' ||
                doc.attestation?.status === 'confirmed'
              const showDataArchiveUpsell =
                creator &&
                fingerprintLocked &&
                !archived &&
                archive &&
                !archive.onChain &&
                archive.eligible
              const completedAt = agreementCompletedAt(doc)
              const whenAt = completedAt ?? doc.createdAt
              const whenLabel = completedAt
                ? fingerprintLocked
                  ? 'Locked'
                  : 'Completed'
                : 'Created'
              const statusPill = BUCKET_PILL_LABELS[view.bucket]
              return (
                <li
                  key={doc.id}
                  className={[
                    'agreements-page-item',
                    view.bucket === 'ready_to_seal' && !archived
                      ? 'agreements-page-item--seal'
                      : '',
                    showDataArchiveUpsell ? 'agreements-page-item--archive' : '',
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
                          <ShieldCheck size={15} strokeWidth={2.25} aria-hidden />
                        </span>
                      )}
                      <strong className="agreements-page-title">
                        {agreementListTitle(doc)}
                      </strong>
                      <span className="agreements-page-type">{documentTypeLabel(doc.type)}</span>
                      <span
                        className={`agreements-page-status-pill agreements-page-status-pill--${view.bucket}`}
                      >
                        {statusPill}
                      </span>
                    </span>
                    <span className="muted agreements-page-meta">
                      {creator ? 'You created' : "You're a signer"}
                      {' · '}
                      {view.detail}
                      {' · '}
                      <time
                        className="agreements-page-when"
                        dateTime={new Date(whenAt).toISOString()}
                        title={`${whenLabel} ${formatAgreementWhenFull(whenAt)}`}
                      >
                        {formatAgreementWhen(whenAt)}
                      </time>
                      {' · '}
                      <code className="mono">{shortHash(doc.originalSha256)}</code>
                    </span>
                    {(view.bucket === 'needs_you' ||
                      view.bucket === 'ready_to_seal' ||
                      view.cta === 'Retry lock') && (
                      <span className="agreements-page-headline">{view.headline}</span>
                    )}
                  </button>
                  <div className="agreements-page-actions">
                    <button
                      type="button"
                      className={`btn ${preferSeal ? 'btn-primary' : freeComplete ? 'btn-primary' : 'btn-secondary'} agreements-page-cta`}
                      onClick={() => onOpen(doc, preferSeal)}
                    >
                      {preferSeal ? (
                        <>
                          <Lock size={14} strokeWidth={2.25} aria-hidden />
                          {view.cta}
                        </>
                      ) : freeComplete ? (
                        view.cta
                      ) : view.cta === 'Sign now' ? (
                        <>
                          <PenLine size={14} strokeWidth={2.25} aria-hidden />
                          Sign now
                        </>
                      ) : (
                        view.cta
                      )}
                    </button>
                    {freeComplete && (
                      <button
                        type="button"
                        className="btn btn-secondary agreements-page-cta"
                        onClick={() => onOpen(doc, true)}
                        title="Lock fingerprint on the Nimiq blockchain (1 credit)"
                      >
                        <Lock size={14} strokeWidth={2.25} aria-hidden />
                        Lock (1 credit)
                      </button>
                    )}
                    {showDataArchiveUpsell && (
                      <button
                        type="button"
                        className="btn btn-secondary agreements-page-archive-btn agreements-page-cta"
                        onClick={() => void requestArchive(doc)}
                        title={
                          archive.credits > 0
                            ? `Store signatures & fields on the Nimiq blockchain (${formatDataArchiveCredits(archive.credits)})`
                            : 'Store signatures & fields on the Nimiq blockchain'
                        }
                      >
                        <Database size={14} strokeWidth={2.25} aria-hidden />
                        {archive.credits > 0
                          ? `Store forever · ${formatDataArchiveCredits(archive.credits)}`
                          : 'Store forever'}
                      </button>
                    )}
                    {archived ? (
                      <button
                        type="button"
                        className={`btn btn-ghost agreements-page-list-archive agreements-page-icon-btn${listArchiving ? ' btn--busy' : ''}`}
                        disabled={Boolean(listArchiveBusyId)}
                        onClick={() => void setListArchived(doc, false)}
                        title="Restore — show in Inbox or Completed again"
                        aria-label={
                          listArchiving
                            ? 'Restoring agreement'
                            : 'Restore agreement to Inbox or Completed'
                        }
                      >
                        {listArchiving ? (
                          <LoaderCircle
                            className="btn-spinner"
                            size={16}
                            strokeWidth={2.5}
                            aria-hidden
                          />
                        ) : (
                          <ArchiveRestore size={16} strokeWidth={2.25} aria-hidden />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`btn btn-ghost agreements-page-list-archive agreements-page-icon-btn${listArchiving ? ' btn--busy' : ''}`}
                        disabled={Boolean(listArchiveBusyId)}
                        onClick={() => void setListArchived(doc, true)}
                        title="Archive — hide from Inbox and Completed (restore anytime)"
                        aria-label={
                          listArchiving
                            ? 'Archiving agreement'
                            : 'Archive agreement from Inbox and Completed'
                        }
                      >
                        {listArchiving ? (
                          <LoaderCircle
                            className="btn-spinner"
                            size={16}
                            strokeWidth={2.5}
                            aria-hidden
                          />
                        ) : (
                          <Archive size={16} strokeWidth={2.25} aria-hidden />
                        )}
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
                              size={14}
                              strokeWidth={2.5}
                              aria-hidden
                            />
                            Removing…
                          </>
                        ) : (
                          <>
                            <Trash2 size={14} strokeWidth={2.25} aria-hidden />
                            Remove
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
                              size={14}
                              strokeWidth={2.5}
                              aria-hidden
                            />
                            Cancelling…
                          </>
                        ) : (
                          <>
                            <Trash2 size={14} strokeWidth={2.25} aria-hidden />
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
                Showing {shown.length} of {modeItems.length}
              </p>
              <button
                type="button"
                className="btn btn-secondary agreements-page-more-btn"
                onClick={showMore}
              >
                Show {Math.min(PAGE_SIZE, remaining)} more
              </button>
            </div>
          )}
        </div>
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
        framesDone={archiveFramesDone}
        jobPhase={archiveJobPhase}
        credits={archiveCredits}
        balance={archiveBalance}
        busy={archiveBusy}
        done={archiveDone}
        error={archiveError}
        emailNotifyAvailable={archiveEmailAvailable}
        onClose={closeArchiveModal}
        onConfirm={opts => void confirmArchive(opts)}
        onDownloadRecovery={
          archiveDone ? () => void downloadArchiveRecovery() : undefined
        }
        recoveryBusy={recoveryBusy}
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
