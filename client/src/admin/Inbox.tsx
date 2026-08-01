/**
 * Admin Inbox — personal email at sam@verilock.online.
 * Separate from Support Queue. List + detail split layout.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { adminApi, type InboxEmail } from './adminApi'
import './Inbox.css'

interface Props {
  onAuthLost: () => void
  onUnreadChange?: (count: number) => void
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

export function Inbox({ onAuthLost, onUnreadChange }: Props) {
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
  const listRef = useRef<HTMLDivElement>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.inboxList({
        q: search || undefined,
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
  }, [search, showArchived, onAuthLost])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // Bubble unread count to parent for tab badge
  useEffect(() => {
    onUnreadChange?.(unreadCount)
  }, [unreadCount, onUnreadChange])

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
      // Mark as read if unread
      if (!result.email.read) {
        void adminApi.inboxUpdate(id, { read: true }).then(() => {
          // Update list optimistically
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

  const handleReply = useCallback(async () => {
    if (!selectedId || !replyText.trim()) return
    setReplySending(true)
    setReplyError(null)
    try {
      await adminApi.inboxReply(selectedId, replyText.trim())
      setReplySent(true)
      setReplyText('')
    } catch (err) {
      if ((err as { status?: number }).status === 401) onAuthLost()
      else setReplyError(err instanceof Error ? err.message : 'Reply failed')
    } finally {
      setReplySending(false)
    }
  }, [selectedId, replyText, onAuthLost])

  const handleMarkAllRead = useCallback(async () => {
    try {
      await adminApi.inboxMarkAllRead()
      void loadList()
    } catch (err) {
      if ((err as { status?: number }).status === 401) onAuthLost()
    }
  }, [loadList, onAuthLost])

  const handleSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void loadList()
  }

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

  return (
    <div className="inbox-layout">
      {/* ── List Panel ─────────────────────────────────────────────── */}
      <div className={`inbox-list-panel${selectedId ? ' inbox-list-panel--collapsed' : ''}`}>
        <div className="inbox-toolbar">
          <div className="inbox-search">
            <input
              ref={searchRef}
              type="search"
              placeholder="Search inbox…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKey}
              className="inbox-search-input"
            />
          </div>
          <div className="inbox-toolbar-actions">
            {!showArchived && unreadCount > 0 && (
              <button
                type="button"
                className="admin-btn admin-btn-ghost inbox-action-btn"
                onClick={() => void handleMarkAllRead()}
              >
                Mark all read
              </button>
            )}
            <button
              type="button"
              className={`admin-btn admin-btn-ghost inbox-action-btn${showArchived ? ' inbox-action-btn--active' : ''}`}
              onClick={() => {
                setShowArchived(!showArchived)
                setSelectedId(null)
                setSelectedEmail(null)
              }}
            >
              {showArchived ? '← Inbox' : 'Archive'}
            </button>
          </div>
        </div>

        {error && (
          <div className="inbox-error" role="alert">
            {error}
            <button type="button" className="admin-btn admin-btn-ghost" onClick={() => void loadList()}>
              Retry
            </button>
          </div>
        )}

        <div className="inbox-list" ref={listRef}>
          {loading && emails.length === 0 && (
            <div className="inbox-empty">Loading…</div>
          )}

          {!loading && emails.length === 0 && (
            <div className="inbox-empty">
              {search
                ? 'No emails match your search.'
                : showArchived
                  ? 'No archived emails.'
                  : 'Inbox zero 🎉'}
            </div>
          )}

          {emails.map(email => (
            <button
              key={email.id}
              type="button"
              className={`inbox-row${email.id === selectedId ? ' inbox-row--active' : ''}${!email.read ? ' inbox-row--unread' : ''}`}
              onClick={() => void loadDetail(email.id)}
            >
              <div className="inbox-row-sender">
                <span className="inbox-row-name">{senderDisplay(email)}</span>
                <span className="inbox-row-time">{formatTime(email.receivedAt)}</span>
              </div>
              <div className="inbox-row-subject">
                {email.subject || '(no subject)'}
              </div>
              <div className="inbox-row-preview">
                {email.bodyText.slice(0, 120)}
              </div>
            </button>
          ))}

          {total > emails.length && (
            <div className="inbox-more">
              Showing {emails.length} of {total}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail Panel ────────────────────────────────────────────── */}
      {selectedId && (
        <div className="inbox-detail-panel">
          {detailLoading ? (
            <div className="inbox-detail-loading">Loading…</div>
          ) : selectedEmail ? (
            <>
              <div className="inbox-detail-header">
                <button
                  type="button"
                  className="inbox-back-btn"
                  onClick={() => {
                    setSelectedId(null)
                    setSelectedEmail(null)
                  }}
                  aria-label="Back to list"
                >
                  ← Back
                </button>
                <div className="inbox-detail-actions">
                  <button
                    type="button"
                    className="admin-btn admin-btn-ghost"
                    onClick={() =>
                      void handleArchive(selectedEmail.id, !selectedEmail.archived)
                    }
                  >
                    {selectedEmail.archived ? 'Unarchive' : 'Archive'}
                  </button>
                </div>
              </div>

              <article className="inbox-detail-body">
                <h2 className="inbox-detail-subject">
                  {selectedEmail.subject || '(no subject)'}
                </h2>
                <div className="inbox-detail-meta">
                  <div className="inbox-detail-from">
                    <span className="inbox-detail-label">From</span>
                    <span className="inbox-detail-value">
                      {selectedEmail.fromName
                        ? `${selectedEmail.fromName} <${selectedEmail.fromEmail}>`
                        : selectedEmail.fromEmail}
                    </span>
                  </div>
                  <div className="inbox-detail-to">
                    <span className="inbox-detail-label">To</span>
                    <span className="inbox-detail-value">{selectedEmail.toEmail}</span>
                  </div>
                  <div className="inbox-detail-date">
                    <span className="inbox-detail-label">Date</span>
                    <span className="inbox-detail-value">
                      {formatFullDate(selectedEmail.receivedAt)}
                    </span>
                  </div>
                </div>
                <div className="inbox-detail-content">
                  {selectedEmail.bodyHtml ? (
                    <div
                      className="inbox-html-body"
                      dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                    />
                  ) : selectedEmail.bodyText ? (
                    <pre className="inbox-text-body">{selectedEmail.bodyText}</pre>
                  ) : (
                    <div className="inbox-body-empty">
                      Email body not available — this email was received before the fix that fetches full content from Resend.
                      New emails will show the body here.
                    </div>
                  )}
                </div>

                {/* Reply form */}
                <div className="inbox-reply-section">
                  {selectedEmail.replySentAt ? (
                    <div className="inbox-reply-sent">
                      ✓ Reply sent {formatTime(selectedEmail.replySentAt)}
                    </div>
                  ) : replySent ? (
                    <div className="inbox-reply-sent">✓ Reply sent</div>
                  ) : (
                    <>
                      {replyError && (
                        <div className="inbox-reply-error" role="alert">{replyError}</div>
                      )}
                      <textarea
                        className="inbox-reply-textarea"
                        rows={4}
                        placeholder={`Reply to ${selectedEmail.fromName || selectedEmail.fromEmail}…`}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        disabled={replySending}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            void handleReply()
                          }
                        }}
                      />
                      <div className="inbox-reply-actions">
                        <span className="inbox-reply-hint">⌘+Enter to send</span>
                        <button
                          type="button"
                          className="admin-btn admin-btn-primary"
                          disabled={!replyText.trim() || replySending}
                          onClick={() => void handleReply()}
                        >
                          {replySending ? 'Sending…' : 'Send reply'}
                        </button>
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
  )
}
