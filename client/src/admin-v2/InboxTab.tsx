/**
 * Admin v2 Inbox — ported from existing Inbox with v2 styling.
 * New: bulk archive, reply-and-archive, Inbox zero EmptyState.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, type InboxEmail } from '../admin/adminApi'
import { EmptyState } from './components/EmptyState'
import './InboxTab.css'

interface Props {
  onAuthLost: () => void
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const now = Date.now()
  const diff = now - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  if (diff < 604800_000) {
    return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatFullDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function senderDisplay(email: InboxEmail): string {
  return email.fromName || email.fromEmail
}

export function InboxTab({ onAuthLost }: Props) {
  const [emails, setEmails] = useState<InboxEmail[]>([])
  const [total, setTotal] = useState(0)
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEmail, setSelectedEmail] = useState<InboxEmail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [replySending, setReplySending] = useState(false)
  const [replySent, setReplySent] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedSearchRef = useRef(search)

  // Bulk archive
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkArchiving, setBulkArchiving] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.inboxList({
        q: debouncedSearchRef.current || undefined,
        archived: showArchived,
        limit: 100,
      })
      setEmails(result.emails)
      setTotal(result.total)
      setUnreadCount(result.unreadCount)
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        onAuthLost()
        return
      }
      setError(err instanceof Error ? err.message : 'Could not load inbox')
    } finally {
      setLoading(false)
    }
  }, [showArchived, onAuthLost])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // Debounced search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      debouncedSearchRef.current = search
      void loadList()
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [search, loadList])

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => void loadList(), 30_000)
    return () => clearInterval(id)
  }, [loadList])

  const loadDetail = useCallback(async (id: string) => {
    setSelectedId(id)
    setDetailLoading(true)
    setReplyText('')
    setReplySent(false)
    setReplyError(null)
    try {
      const result = await adminApi.inboxEmail(id)
      setSelectedEmail(result.email)
      if (!result.email.read) {
        void adminApi.inboxUpdate(id, { read: true }).then(() => {
          setEmails(prev =>
            prev.map(e => (e.id === id ? { ...e, read: true } : e)),
          )
          setUnreadCount(prev => Math.max(0, prev - 1))
        })
      }
    } catch (err) {
      if ((err as { status?: number }).status === 401) {
        onAuthLost()
        return
      }
      setError(err instanceof Error ? err.message : 'Could not load email')
    } finally {
      setDetailLoading(false)
    }
  }, [onAuthLost])

  const handleArchive = useCallback(async (id: string, archive: boolean) => {
    try {
      await adminApi.inboxUpdate(id, { archived: archive })
      if (selectedId === id) {
        setSelectedId(null)
        setSelectedEmail(null)
      }
      void loadList()
    } catch (err) {
      if ((err as { status?: number }).status === 401) onAuthLost()
    }
  }, [selectedId, loadList, onAuthLost])

  const handleBulkArchive = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBulkArchiving(true)
    try {
      const ids = Array.from(selectedIds)
      const API_BASE = import.meta.env.VITE_API_URL ?? ''
      const res = await fetch(`${API_BASE}/api/admin-v2/inbox/bulk`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids, archived: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSelectedIds(new Set())
      if (selectedId && selectedIds.has(selectedId)) {
        setSelectedId(null)
        setSelectedEmail(null)
      }
      void loadList()
    } catch (err) {
      if ((err as { status?: number }).status === 401) onAuthLost()
      else setError(err instanceof Error ? err.message : 'Bulk archive failed')
    } finally {
      setBulkArchiving(false)
    }
  }, [selectedIds, selectedId, loadList, onAuthLost])

  const handleReply = useCallback(async (archiveAlso = false) => {
    if (!selectedId || !replyText.trim()) return
    setReplySending(true)
    setReplyError(null)
    try {
      await adminApi.inboxReply(selectedId, replyText.trim())
      if (archiveAlso) {
        await adminApi.inboxUpdate(selectedId, { archived: true })
        setSelectedId(null)
        setSelectedEmail(null)
      }
      setReplySent(true)
      setReplyText('')
      if (!archiveAlso) void loadList()
      else void loadList()
    } catch (err) {
      if ((err as { status?: number }).status === 401) onAuthLost()
      else setReplyError(err instanceof Error ? err.message : 'Reply failed')
    } finally {
      setReplySending(false)
    }
  }, [selectedId, replyText, onAuthLost, loadList])

  const handleMarkAllRead = useCallback(async () => {
    try {
      await adminApi.inboxMarkAllRead()
      void loadList()
    } catch (err) {
      if ((err as { status?: number }).status === 401) onAuthLost()
    }
  }, [loadList, onAuthLost])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => {
      if (prev.size === emails.length) return new Set()
      return new Set(emails.map(e => e.id))
    })
  }, [emails])

  // Escape to close detail
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedId) {
        setSelectedId(null)
        setSelectedEmail(null)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedId])

  // All selected state
  const allSelected = emails.length > 0 && selectedIds.size === emails.length

  return (
    <div className="av2-inbox">
      <div className={`av2-inbox-layout${selectedId ? ' av2-inbox-layout--detail-open' : ''}`}>
        {/* ── List Panel ─────────────────────────────────────────────── */}
        <div className={`av2-inbox-list${selectedId ? ' av2-inbox-list--collapsed' : ''}`}>
          <div className="av2-inbox-toolbar">
            <div className="av2-inbox-search">
              <input
                ref={searchRef}
                type="search"
                placeholder="Search inbox…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="av2-inbox-search-input"
              />
            </div>
            <div className="av2-inbox-toolbar-actions">
              {!showArchived && unreadCount > 0 && (
                <button
                  type="button"
                  className="av2-btn av2-btn-ghost av2-btn-sm"
                  onClick={() => void handleMarkAllRead()}
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                className={`av2-btn av2-btn-ghost av2-btn-sm${showArchived ? ' av2-inbox-archive-active' : ''}`}
                onClick={() => {
                  setShowArchived(!showArchived)
                  setSelectedId(null)
                  setSelectedEmail(null)
                  setSelectedIds(new Set())
                }}
              >
                {showArchived ? '← Inbox' : 'Archive'}
              </button>
            </div>
          </div>

          {/* Bulk actions */}
          {selectedIds.size > 0 && (
            <div className="av2-inbox-bulk-bar">
              <span className="av2-inbox-bulk-count">{selectedIds.size} selected</span>
              <button
                type="button"
                className="av2-btn av2-btn-ghost av2-btn-sm"
                onClick={() => void handleBulkArchive()}
                disabled={bulkArchiving}
              >
                {bulkArchiving ? 'Archiving…' : 'Archive selected'}
              </button>
            </div>
          )}

          {error && (
            <div className="av2-inbox-error" role="alert">
              {error}
              <button type="button" className="av2-btn av2-btn-ghost av2-btn-sm" onClick={() => void loadList()}>
                Retry
              </button>
            </div>
          )}

          <div className="av2-inbox-list-body">
            {loading && emails.length === 0 && (
              <div className="av2-inbox-empty-text">Loading…</div>
            )}

            {!loading && emails.length === 0 && (
              <EmptyState
                icon={showArchived ? '📦' : '📭'}
                title={showArchived ? 'No archived emails' : 'Inbox zero'}
                description={showArchived ? 'Nothing has been archived yet.' : 'You\'ve read and handled every email. Nice work!'}
              />
            )}

            {/* Select all toggle */}
            {emails.length > 0 && (
              <label className="av2-inbox-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                />
                <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
              </label>
            )}

            {emails.map(email => (
              <div
                key={email.id}
                className={`av2-inbox-row${email.id === selectedId ? ' av2-inbox-row--active' : ''}${!email.read ? ' av2-inbox-row--unread' : ''}`}
              >
                <label className="av2-inbox-row-check" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(email.id)}
                    onChange={() => toggleSelect(email.id)}
                  />
                </label>
                <button
                  type="button"
                  className="av2-inbox-row-btn"
                  onClick={() => void loadDetail(email.id)}
                >
                  <div className="av2-inbox-row-sender">
                    <span className="av2-inbox-row-name">{senderDisplay(email)}</span>
                    <span className="av2-inbox-row-time">{formatTime(email.receivedAt)}</span>
                  </div>
                  <div className="av2-inbox-row-subject">
                    {email.subject || '(no subject)'}
                    {email.replySentAt && <span className="av2-inbox-replied"> ↲</span>}
                  </div>
                  <div className="av2-inbox-row-preview">
                    {email.bodyText.slice(0, 120)}
                  </div>
                </button>
              </div>
            ))}

            {total > emails.length && (
              <div className="av2-inbox-more">
                Showing {emails.length} of {total}
              </div>
            )}
          </div>
        </div>

        {/* ── Detail Panel ────────────────────────────────────────────── */}
        {selectedId && (
          <div className="av2-inbox-detail">
            {detailLoading ? (
              <div className="av2-inbox-detail-loading">Loading…</div>
            ) : selectedEmail ? (
              <>
                <div className="av2-inbox-detail-header">
                  <button
                    type="button"
                    className="av2-inbox-back-btn"
                    onClick={() => {
                      setSelectedId(null)
                      setSelectedEmail(null)
                    }}
                    aria-label="Back to list"
                  >
                    ← Back
                  </button>
                  <div className="av2-inbox-detail-actions">
                    <button
                      type="button"
                      className="av2-btn av2-btn-ghost av2-btn-sm"
                      onClick={() =>
                        void handleArchive(selectedEmail.id, !selectedEmail.archived)
                      }
                    >
                      {selectedEmail.archived ? 'Unarchive' : 'Archive'}
                    </button>
                  </div>
                </div>

                <article className="av2-inbox-detail-body">
                  <h2 className="av2-inbox-detail-subject">
                    {selectedEmail.subject || '(no subject)'}
                  </h2>
                  <div className="av2-inbox-detail-meta">
                    <div className="av2-inbox-detail-from">
                      <span className="av2-inbox-detail-label">From</span>
                      <span className="av2-inbox-detail-value">
                        {selectedEmail.fromName
                          ? `${selectedEmail.fromName} <${selectedEmail.fromEmail}>`
                          : selectedEmail.fromEmail}
                      </span>
                    </div>
                    <div className="av2-inbox-detail-to">
                      <span className="av2-inbox-detail-label">To</span>
                      <span className="av2-inbox-detail-value">{selectedEmail.toEmail}</span>
                    </div>
                    <div className="av2-inbox-detail-date">
                      <span className="av2-inbox-detail-label">Date</span>
                      <span className="av2-inbox-detail-value">
                        {formatFullDate(selectedEmail.receivedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="av2-inbox-detail-content">
                    {selectedEmail.bodyHtml ? (
                      <div
                        className="av2-inbox-html-body"
                        dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                      />
                    ) : selectedEmail.bodyText ? (
                      <pre className="av2-inbox-text-body">{selectedEmail.bodyText}</pre>
                    ) : (
                      <div className="av2-inbox-body-empty">
                        Email body not available — this email was received before the fix that fetches full content from Resend.
                        New emails will show the body here.
                      </div>
                    )}
                  </div>

                  {/* Reply form */}
                  <div className="av2-inbox-reply-section">
                    {selectedEmail.replySentAt ? (
                      <div className="av2-inbox-reply-sent">
                        ✓ Reply sent {formatTime(selectedEmail.replySentAt)}
                      </div>
                    ) : replySent ? (
                      <div className="av2-inbox-reply-sent">✓ Reply sent</div>
                    ) : (
                      <>
                        {replyError && (
                          <div className="av2-inbox-reply-error" role="alert">{replyError}</div>
                        )}
                        <textarea
                          className="av2-inbox-reply-textarea"
                          rows={4}
                          placeholder={`Reply to ${selectedEmail.fromName || selectedEmail.fromEmail}…`}
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          disabled={replySending}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault()
                              void handleReply(false)
                            }
                          }}
                        />
                        <div className="av2-inbox-reply-actions">
                          <span className="av2-inbox-reply-hint">⌘+Enter to send</span>
                          <div className="av2-inbox-reply-buttons">
                            <button
                              type="button"
                              className="av2-btn av2-btn-ghost av2-btn-sm"
                              disabled={!replyText.trim() || replySending}
                              onClick={() => void handleReply(true)}
                            >
                              {replySending ? 'Sending…' : 'Reply & archive'}
                            </button>
                            <button
                              type="button"
                              className="av2-btn av2-btn-primary"
                              disabled={!replyText.trim() || replySending}
                              onClick={() => void handleReply(false)}
                            >
                              {replySending ? 'Sending…' : 'Send reply'}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
