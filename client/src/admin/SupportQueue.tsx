/**
 * Admin support ticket queue (list, thread, templates, reply).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  adminApi,
  type SupportReplyTemplate,
  type SupportTicket,
  type SupportTicketListItem,
  type SupportTicketMessage,
  type SupportTicketStatus,
} from './adminApi'

const TICKET_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_customer: 'Waiting on customer',
  resolved: 'Resolved',
  closed: 'Closed',
}

function formatWhen(ms: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toISOString()
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

function renderTemplateBody(
  body: string,
  vars: { name?: string; publicId?: string; subject?: string },
): string {
  const map: Record<string, string> = {
    name: vars.name?.trim() || 'there',
    publicId: vars.publicId?.trim() || '-',
    subject: vars.subject?.trim() || 'your request',
    site: typeof window !== 'undefined' ? window.location.origin : 'https://verilock.online',
  }
  return body.replace(/\{\{\s*(name|publicId|subject|site)\s*\}\}/g, (_, key: string) => {
    return map[key] ?? ''
  })
}

export function SupportQueue({
  onAuthLost,
  onCountsChange,
}: {
  onAuthLost: () => void
  onCountsChange?: (counts: { open: number; total: number }) => void
}) {
  const [filter, setFilter] = useState<'active' | 'all' | SupportTicketStatus>('active')
  const [query, setQuery] = useState('')
  const [qInput, setQInput] = useState('')
  const [tickets, setTickets] = useState<SupportTicketListItem[]>([])
  const [total, setTotal] = useState(0)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTicket, setDetailTicket] = useState<SupportTicket | null>(null)
  const [messages, setMessages] = useState<SupportTicketMessage[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [replyBody, setReplyBody] = useState('')
  const [replyBusy, setReplyBusy] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [internalOnly, setInternalOnly] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [templates, setTemplates] = useState<SupportReplyTemplate[]>([])

  // Keep parent callbacks in refs so list/detail effects only re-run on filter/query/id —
  // not when the parent re-renders after counts/badge updates (that was an infinite 429 loop).
  const onAuthLostRef = useRef(onAuthLost)
  const onCountsChangeRef = useRef(onCountsChange)
  useEffect(() => {
    onAuthLostRef.current = onAuthLost
  }, [onAuthLost])
  useEffect(() => {
    onCountsChangeRef.current = onCountsChange
  }, [onCountsChange])

  const handleAuthError = useCallback((err: unknown) => {
    if ((err as { status?: number }).status === 401) onAuthLostRef.current()
  }, [])

  const loadList = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    try {
      const result = await adminApi.tickets({
        status: filter,
        q: query || undefined,
        limit: 100,
      })
      setTickets(result.tickets)
      setTotal(result.total)
      if (result.counts) {
        onCountsChangeRef.current?.(result.counts)
      } else if (filter === 'active' && !query) {
        // Fallback when server has no counts field yet
        onCountsChangeRef.current?.({ open: result.total, total: result.total })
      }
    } catch (err) {
      handleAuthError(err)
      setListError(err instanceof Error ? err.message : 'Could not load tickets')
    } finally {
      setListLoading(false)
    }
  }, [filter, query, handleAuthError])

  const loadDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true)
      setDetailError(null)
      try {
        const result = await adminApi.ticket(id)
        setDetailTicket(result.ticket)
        setMessages(result.messages)
      } catch (err) {
        handleAuthError(err)
        setDetailError(err instanceof Error ? err.message : 'Could not load ticket')
        setDetailTicket(null)
        setMessages([])
      } finally {
        setDetailLoading(false)
      }
    },
    [handleAuthError],
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    let cancelled = false
    void adminApi
      .supportTemplates()
      .then(r => {
        if (!cancelled) setTemplates(r.templates)
      })
      .catch(err => {
        handleAuthError(err)
      })
    return () => {
      cancelled = true
    }
  }, [handleAuthError])

  useEffect(() => {
    if (!selectedId) {
      setDetailTicket(null)
      setMessages([])
      return
    }
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  function applyTemplate(tpl: SupportReplyTemplate) {
    if (!detailTicket) return
    const rendered = renderTemplateBody(tpl.body, {
      name: detailTicket.name,
      publicId: detailTicket.publicId,
      subject: detailTicket.subject,
    })
    setReplyBody(prev => {
      const cur = prev.trim()
      return cur ? `${cur}\n\n${rendered}` : rendered
    })
    setInternalOnly(false)
    setReplyError(null)
  }

  async function onStatusChange(status: SupportTicketStatus) {
    if (!detailTicket) return
    setStatusBusy(true)
    setDetailError(null)
    try {
      const result = await adminApi.updateTicket(detailTicket.id, { status })
      setDetailTicket(result.ticket)
      void loadList()
    } catch (err) {
      handleAuthError(err)
      setDetailError(err instanceof Error ? err.message : 'Could not update status')
    } finally {
      setStatusBusy(false)
    }
  }

  async function onReply(e: FormEvent) {
    e.preventDefault()
    if (!detailTicket || replyBusy) return
    const body = replyBody.trim()
    if (body.length < 2) {
      setReplyError('Write a short reply first.')
      return
    }
    setReplyBusy(true)
    setReplyError(null)
    try {
      const result = await adminApi.replyTicket(detailTicket.id, {
        body,
        internalOnly,
      })
      setDetailTicket(result.ticket)
      setMessages(result.messages)
      setReplyBody('')
      setInternalOnly(false)
      void loadList()
    } catch (err) {
      handleAuthError(err)
      setReplyError(err instanceof Error ? err.message : 'Could not send reply')
    } finally {
      setReplyBusy(false)
    }
  }

  return (
    <div className="admin-support">
      <div className="admin-dash-head">
        <div>
          <h1>Support tickets</h1>
          <p className="admin-dash-meta">
            {total} {filter === 'active' ? 'active' : 'matching'} · from /support contact form
          </p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn-ghost"
          onClick={() => void loadList()}
          disabled={listLoading}
        >
          {listLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="admin-support-toolbar">
        <div className="admin-support-filters" role="group" aria-label="Ticket status filter">
          {(
            [
              ['active', 'Active'],
              ['all', 'All'],
              ['open', 'Open'],
              ['in_progress', 'In progress'],
              ['waiting_customer', 'Waiting'],
              ['resolved', 'Resolved'],
              ['closed', 'Closed'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`admin-chip${filter === value ? ' admin-chip--active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="admin-support-search"
          onSubmit={e => {
            e.preventDefault()
            setQuery(qInput.trim())
          }}
        >
          <input
            type="search"
            placeholder="Search email, subject, ticket id, slug…"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            aria-label="Search tickets"
          />
          <button type="submit" className="admin-btn admin-btn-ghost">
            Search
          </button>
        </form>
      </div>

      {listError && (
        <p className="admin-error" role="alert" style={{ marginBottom: '1rem' }}>
          {listError}
        </p>
      )}

      <div className="admin-support-layout">
        <section className="admin-panel admin-ticket-list" aria-label="Ticket list">
          {listLoading && tickets.length === 0 ? (
            <p className="admin-empty">Loading tickets…</p>
          ) : tickets.length === 0 ? (
            <p className="admin-empty">No tickets match this filter.</p>
          ) : (
            <ul className="admin-ticket-items">
              {tickets.map(t => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`admin-ticket-item${selectedId === t.id ? ' admin-ticket-item--active' : ''}`}
                    onClick={() => {
                      setSelectedId(t.id)
                      setReplyBody('')
                      setReplyError(null)
                    }}
                  >
                    <div className="admin-ticket-item-top">
                      <span className="admin-ticket-id">{t.publicId}</span>
                      <span className={`admin-badge admin-badge--${t.status}`}>
                        {TICKET_STATUS_LABELS[t.status] ?? statusLabel(t.status)}
                      </span>
                    </div>
                    <div className="admin-ticket-subject">{t.subject}</div>
                    <div className="admin-ticket-meta">
                      {t.name} · {t.email}
                      {t.issue ? ` · ${t.issue}` : ''}
                      {t.walletAddress
                        ? ` · ${t.walletAddress.slice(0, 6)}…${t.walletAddress.slice(-4)}`
                        : ''}
                      {t.documentSlug ? ` · /d/${t.documentSlug}` : ''}
                    </div>
                    {t.lastMessagePreview ? (
                      <div className="admin-ticket-preview">{t.lastMessagePreview}</div>
                    ) : null}
                    <div className="admin-ticket-when">{formatWhen(t.updatedAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="admin-panel admin-ticket-detail" aria-label="Ticket detail">
          {!selectedId && <p className="admin-empty">Select a ticket to read and reply.</p>}
          {selectedId && detailLoading && !detailTicket && (
            <p className="admin-empty">Loading…</p>
          )}
          {selectedId && detailError && !detailTicket && (
            <p className="admin-error" role="alert">
              {detailError}
            </p>
          )}
          {detailTicket && (
            <>
              <div className="admin-ticket-detail-head">
                <div>
                  <p className="admin-ticket-id">{detailTicket.publicId}</p>
                  <h2>{detailTicket.subject}</h2>
                  <p className="admin-ticket-meta">
                    {detailTicket.name} ·{' '}
                    <a href={`mailto:${detailTicket.email}`}>{detailTicket.email}</a>
                    {detailTicket.issue ? (
                      <>
                        {' · '}
                        <span title="Issue category">{detailTicket.issue}</span>
                      </>
                    ) : null}
                    {detailTicket.documentSlug ? (
                      <>
                        {' · '}
                        <a
                          href={`/d/${detailTicket.documentSlug}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          /d/{detailTicket.documentSlug}
                        </a>
                      </>
                    ) : null}
                  </p>
                  {detailTicket.walletAddress ? (
                    <p className="admin-dash-meta mono" title="Signed-in wallet at submit">
                      Wallet: {detailTicket.walletAddress}
                    </p>
                  ) : null}
                  <p className="admin-dash-meta">
                    Opened {formatWhen(detailTicket.createdAt)} · Updated{' '}
                    {formatWhen(detailTicket.updatedAt)}
                  </p>
                </div>
                <label className="admin-status-select">
                  <span>Status</span>
                  <select
                    value={detailTicket.status}
                    disabled={statusBusy}
                    onChange={e => void onStatusChange(e.target.value as SupportTicketStatus)}
                  >
                    {(Object.keys(TICKET_STATUS_LABELS) as SupportTicketStatus[]).map(s => (
                      <option key={s} value={s}>
                        {TICKET_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {detailError && (
                <p className="admin-error" role="alert" style={{ marginBottom: '0.75rem' }}>
                  {detailError}
                </p>
              )}

              <div className="admin-thread">
                {messages.map(m => {
                  const kind = m.messageKind
                  const emailed =
                    kind === 'auto_ack' ||
                    kind === 'volume_notice' ||
                    kind === 'human_reply' ||
                    Boolean(m.resendMessageId)
                  const isInternal = kind === 'internal' || (!kind && m.authorKind === 'system')
                  const label =
                    kind === 'customer' || m.authorKind === 'customer'
                      ? m.authorName || 'Customer'
                      : kind === 'auto_ack'
                        ? m.authorName || 'Auto-reply'
                        : kind === 'volume_notice'
                          ? m.authorName || 'Volume notice'
                          : isInternal
                            ? m.authorName || 'Internal note'
                            : m.authorName || 'Operator'
                  return (
                    <article
                      key={m.id}
                      className={`admin-thread-msg admin-thread-msg--${m.authorKind}${emailed ? ' admin-thread-msg--emailed' : ''}`}
                    >
                      <header>
                        <strong>
                          {label}
                          {emailed ? (
                            <span className="admin-msg-pill admin-msg-pill--emailed">Emailed</span>
                          ) : isInternal ? (
                            <span className="admin-msg-pill">Internal</span>
                          ) : null}
                        </strong>
                        <span>{formatWhen(m.createdAt)}</span>
                      </header>
                      <div className="admin-thread-body">{m.body}</div>
                    </article>
                  )
                })}
              </div>

              <form className="admin-reply-form" onSubmit={e => void onReply(e)}>
                <label htmlFor="admin-reply-body">
                  {internalOnly ? 'Internal note' : 'Reply to customer'}
                </label>
                {templates.length > 0 && !internalOnly ? (
                  <div className="admin-templates" role="group" aria-label="Reply templates">
                    <span className="admin-templates-label">Templates</span>
                    <div className="admin-templates-list">
                      {templates.map(tpl => (
                        <button
                          key={tpl.id}
                          type="button"
                          className="admin-chip"
                          title={tpl.category}
                          disabled={replyBusy}
                          onClick={() => applyTemplate(tpl)}
                        >
                          {tpl.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <textarea
                  id="admin-reply-body"
                  rows={7}
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder={
                    internalOnly
                      ? 'Note for operators only (not emailed)…'
                      : 'Write a reply - emailed to the customer and saved on this ticket…'
                  }
                  disabled={replyBusy}
                />
                <div className="admin-reply-actions">
                  <label className="admin-check">
                    <input
                      type="checkbox"
                      checked={internalOnly}
                      onChange={e => setInternalOnly(e.target.checked)}
                      disabled={replyBusy}
                    />
                    Internal note only
                  </label>
                  <button
                    type="submit"
                    className="admin-btn admin-btn-primary"
                    disabled={replyBusy || replyBody.trim().length < 2}
                  >
                    {replyBusy
                      ? 'Sending…'
                      : internalOnly
                        ? 'Save note'
                        : 'Send reply'}
                  </button>
                </div>
                {replyError && (
                  <p className="admin-error" role="alert">
                    {replyError}
                  </p>
                )}
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
