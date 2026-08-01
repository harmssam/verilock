/**
 * Admin v2 Support — ported from SupportQueue with v2 styling.
 * New: SLA/time-since indicator colors, bulk status change, ticket tags.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import {
  adminApi,
  type SupportReplyTemplate,
  type SupportTicket,
  type SupportTicketListItem,
  type SupportTicketMessage,
  type SupportTicketStatus,
} from '../admin/adminApi'
import './SupportTab.css'

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

function slaColor(lastActivityMs: number): 'green' | 'yellow' | 'red' | null {
  if (!lastActivityMs || lastActivityMs <= 0) return null
  const hours = (Date.now() - lastActivityMs) / 3600_000
  if (hours < 4) return 'green'
  if (hours < 24) return 'yellow'
  return 'red'
}

interface Props {
  onAuthLost: () => void
}

export function SupportTab({ onAuthLost }: Props) {
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

  // Bulk status change
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<SupportTicketStatus | ''>('')
  const [bulkBusy, setBulkBusy] = useState(false)

  // Ticket tags
  const [ticketTags, setTicketTags] = useState<string[]>([])
  const [allTags, setAllTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState('')

  const onAuthLostRef = useRef(onAuthLost)
  useEffect(() => { onAuthLostRef.current = onAuthLost }, [onAuthLost])

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
      let filtered = result.tickets

      // Client-side tag filter (server doesn't filter by tag in tickets endpoint)
      if (tagFilter.trim()) {
        // Fetch tags for all tickets and filter
        const tagPromises = filtered.map(async t => {
          try {
            const r = await adminApi.ticketTagsForTicket(t.id)
            return { id: t.id, tags: r.tags }
          } catch { return { id: t.id, tags: [] as string[] } }
        })
        const tagResults = await Promise.all(tagPromises)
        const tagMap = new Map(tagResults.map(r => [r.id, r.tags]))
        filtered = filtered.filter(t => {
          const tags = tagMap.get(t.id) ?? []
          return tags.some(tag => tag.includes(tagFilter.toLowerCase()))
        })
      }

      setTickets(filtered)
      setTotal(filtered.length)
    } catch (err) {
      handleAuthError(err)
      setListError(err instanceof Error ? err.message : 'Could not load tickets')
    } finally {
      setListLoading(false)
    }
  }, [filter, query, tagFilter, handleAuthError])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const [ticketResult, tagsResult] = await Promise.all([
        adminApi.ticket(id),
        adminApi.ticketTagsForTicket(id).catch(() => ({ tags: [] as string[] })),
      ])
      setDetailTicket(ticketResult.ticket)
      setMessages(ticketResult.messages)
      setTicketTags(tagsResult.tags)
      setTagInput('')
    } catch (err) {
      handleAuthError(err)
      setDetailError(err instanceof Error ? err.message : 'Could not load ticket')
      setDetailTicket(null)
      setMessages([])
      setTicketTags([])
    } finally {
      setDetailLoading(false)
    }
  }, [handleAuthError])

  useEffect(() => { void loadList() }, [loadList])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      adminApi.supportTemplates().catch(() => ({ templates: [] as SupportReplyTemplate[] })),
      adminApi.ticketTags().catch(() => ({ tags: [] as string[] })),
    ]).then(([tplResult, tagResult]) => {
      if (!cancelled) {
        setTemplates(tplResult.templates)
        setAllTags(tagResult.tags)
      }
    }).catch(err => { handleAuthError(err) })
    return () => { cancelled = true }
  }, [handleAuthError])

  useEffect(() => {
    if (!selectedId) {
      setDetailTicket(null)
      setMessages([])
      setTicketTags([])
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

  // Bulk status
  async function onBulkStatusChange() {
    if (selectedIds.size === 0 || !bulkStatus) return
    setBulkBusy(true)
    try {
      const ids = Array.from(selectedIds)
      const API_BASE = import.meta.env.VITE_API_URL ?? ''
      const res = await fetch(`${API_BASE}/api/admin-v2/tickets/bulk-status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ids, status: bulkStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSelectedIds(new Set())
      setBulkStatus('')
      void loadList()
    } catch (err) {
      handleAuthError(err)
      setListError(err instanceof Error ? err.message : 'Bulk status change failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // Tag helpers
  async function addTag(tag: string) {
    if (!detailTicket) return
    const clean = tag.trim().toLowerCase()
    if (!clean || ticketTags.includes(clean)) return
    const updated = [...ticketTags, clean]
    try {
      await adminApi.ticketTagsSet(detailTicket.id, updated)
      setTicketTags(updated)
      setTagInput('')
      // Refresh allTags
      const r = await adminApi.ticketTags().catch(() => ({ tags: allTags }))
      setAllTags(r.tags)
    } catch (err) {
      handleAuthError(err)
    }
  }

  async function removeTag(tag: string) {
    if (!detailTicket) return
    const updated = ticketTags.filter(t => t !== tag)
    try {
      await adminApi.ticketTagsSet(detailTicket.id, updated)
      setTicketTags(updated)
    } catch (err) {
      handleAuthError(err)
    }
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      void addTag(tagInput)
    }
    if (e.key === 'Backspace' && !tagInput && ticketTags.length > 0) {
      removeTag(ticketTags[ticketTags.length - 1])
    }
  }

  function handleTagInputChange(value: string) {
    setTagInput(value)
    if (value.trim()) {
      const suggestions = allTags.filter(t =>
        t.includes(value.toLowerCase()) && !ticketTags.includes(t),
      ).slice(0, 5)
      setTagSuggestions(suggestions)
    } else {
      setTagSuggestions([])
    }
  }

  return (
    <div className="av2-support">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">Support tickets</h1>
          <p className="av2-dash-subtitle">
            {total} {filter === 'active' ? 'active' : 'matching'} · from /support contact form
          </p>
        </div>
        <button
          type="button"
          className="av2-btn av2-btn-ghost"
          onClick={() => void loadList()}
          disabled={listLoading}
        >
          {listLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="av2-support-toolbar">
        <div className="av2-support-filters" role="group" aria-label="Ticket status filter">
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
              className={`av2-chip${filter === value ? ' av2-chip--active' : ''}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="av2-support-search"
          onSubmit={e => {
            e.preventDefault()
            setQuery(qInput.trim())
          }}
        >
          <input
            type="search"
            placeholder="Search email, subject, ticket id…"
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            aria-label="Search tickets"
          />
          <button type="submit" className="av2-btn av2-btn-ghost av2-btn-sm">
            Search
          </button>
        </form>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="av2-support-tag-filter">
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="av2-support-tag-select"
            aria-label="Filter by tag"
          >
            <option value="">All tags</option>
            {allTags.map(t => (
              <option key={t} value={t}>#{t}</option>
            ))}
          </select>
        </div>
      )}

      {listError && (
        <p className="av2-error" role="alert" style={{ marginBottom: '1rem' }}>
          {listError}
        </p>
      )}

      {/* Bulk status bar */}
      {selectedIds.size > 0 && (
        <div className="av2-support-bulk-bar">
          <span className="av2-support-bulk-count">{selectedIds.size} selected</span>
          <div className="av2-support-bulk-actions">
            <select
              value={bulkStatus}
              onChange={e => setBulkStatus(e.target.value as SupportTicketStatus | '')}
              className="av2-support-bulk-select"
            >
              <option value="">Set status…</option>
              {(Object.keys(TICKET_STATUS_LABELS) as SupportTicketStatus[]).map(s => (
                <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>
              ))}
            </select>
            <button
              type="button"
              className="av2-btn av2-btn-accent av2-btn-sm"
              disabled={!bulkStatus || bulkBusy}
              onClick={() => void onBulkStatusChange()}
            >
              {bulkBusy ? 'Updating…' : 'Apply'}
            </button>
          </div>
        </div>
      )}

      {/* SLA legend */}
      <div className="av2-support-sla-legend" aria-label="SLA time-since-last-update indicators">
        <span className="av2-support-sla-dot av2-support-sla-dot--green" /> &lt;4h
        <span className="av2-support-sla-dot av2-support-sla-dot--yellow" /> 4–24h
        <span className="av2-support-sla-dot av2-support-sla-dot--red" /> &gt;24h
      </div>

      <div className="av2-support-layout">
        {/* Ticket list */}
        <section className="av2-support-list-panel" aria-label="Ticket list">
          {listLoading && tickets.length === 0 ? (
            <p className="av2-empty">Loading tickets…</p>
          ) : tickets.length === 0 ? (
            <p className="av2-empty">No tickets match this filter.</p>
          ) : (
            <div className="av2-support-list-body">
              {tickets.map(t => {
                const sla = slaColor(t.lastMessageAt || t.updatedAt)
                return (
                  <div
                    key={t.id}
                    className={`av2-support-row${sla ? ` av2-support-row--sla-${sla}` : ''}${selectedId === t.id ? ' av2-support-row--active' : ''}`}
                  >
                    <label className="av2-support-row-check" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelect(t.id)}
                      />
                    </label>
                    <button
                      type="button"
                      className="av2-support-row-btn"
                      onClick={() => {
                        setSelectedId(t.id)
                        setReplyBody('')
                        setReplyError(null)
                      }}
                    >
                      <div className="av2-support-row-top">
                        <span className="av2-support-row-id">{t.publicId}</span>
                        <span className={`av2-badge av2-badge--${t.status === 'open' ? 'red' : t.status === 'resolved' ? 'mint' : 'amber'}`}>
                          {TICKET_STATUS_LABELS[t.status] ?? statusLabel(t.status)}
                        </span>
                      </div>
                      <div className="av2-support-row-subject">{t.subject}</div>
                      <div className="av2-support-row-meta">
                        {t.name} · {t.email}
                        {t.documentSlug ? ` · /d/${t.documentSlug}` : ''}
                      </div>
                      {t.lastMessagePreview && (
                        <div className="av2-support-row-preview">{t.lastMessagePreview}</div>
                      )}
                      <div className="av2-support-row-when">{formatWhen(t.updatedAt)}</div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Ticket detail */}
        <section className="av2-support-detail-panel" aria-label="Ticket detail">
          {!selectedId && <p className="av2-empty">Select a ticket to read and reply.</p>}
          {selectedId && detailLoading && !detailTicket && (
            <p className="av2-empty">Loading…</p>
          )}
          {selectedId && detailError && !detailTicket && (
            <p className="av2-error" role="alert">{detailError}</p>
          )}
          {detailTicket && (
            <>
              <div className="av2-support-detail-head">
                <div>
                  <p className="av2-support-detail-id">{detailTicket.publicId}</p>
                  <h2 className="av2-support-detail-subject">{detailTicket.subject}</h2>
                  <p className="av2-support-detail-meta">
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
                    <p className="av2-support-detail-wallet mono">
                      Wallet: {detailTicket.walletAddress}
                    </p>
                  ) : null}
                  <p className="av2-support-detail-when">
                    Opened {formatWhen(detailTicket.createdAt)} · Updated{' '}
                    {formatWhen(detailTicket.updatedAt)}
                  </p>

                  {/* Tags */}
                  <div className="av2-ticket-tags">
                    {ticketTags.map(tag => (
                      <span key={tag} className="av2-tag-chip">
                        #{tag}
                        <button
                          type="button"
                          className="av2-tag-chip-remove"
                          onClick={() => void removeTag(tag)}
                          aria-label={`Remove tag ${tag}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                    <div className="av2-tag-input-wrap">
                      <input
                        type="text"
                        className="av2-tag-input"
                        placeholder={ticketTags.length === 0 ? '+ Add tag…' : '+'}
                        value={tagInput}
                        onChange={e => handleTagInputChange(e.target.value)}
                        onKeyDown={e => handleTagKeyDown(e)}
                        aria-label="Add tag"
                      />
                      {tagSuggestions.length > 0 && tagInput.trim() && (
                        <div className="av2-tag-suggestions">
                          {tagSuggestions.map(s => (
                            <button
                              key={s}
                              type="button"
                              className="av2-tag-suggestion-item"
                              onClick={() => {
                                void addTag(s)
                                setTagSuggestions([])
                              }}
                            >
                              #{s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <label className="av2-support-status-select">
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
                <p className="av2-error" role="alert" style={{ marginBottom: '0.75rem' }}>
                  {detailError}
                </p>
              )}

              {/* Message thread */}
              <div className="av2-support-thread">
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
                      className={`av2-support-msg av2-support-msg--${m.authorKind}${emailed ? ' av2-support-msg--emailed' : ''}`}
                    >
                      <header>
                        <strong>
                          {label}
                          {emailed ? (
                            <span className="av2-support-msg-pill av2-support-msg-pill--emailed">Emailed</span>
                          ) : isInternal ? (
                            <span className="av2-support-msg-pill">Internal</span>
                          ) : null}
                        </strong>
                        <span>{formatWhen(m.createdAt)}</span>
                      </header>
                      <div className="av2-support-msg-body">{m.body}</div>
                    </article>
                  )
                })}
              </div>

              {/* Reply form */}
              <form className="av2-support-reply-form" onSubmit={e => void onReply(e)}>
                <label htmlFor="av2-support-reply-body">
                  {internalOnly ? 'Internal note' : 'Reply to customer'}
                </label>
                {templates.length > 0 && !internalOnly ? (
                  <div className="av2-support-templates" role="group" aria-label="Reply templates">
                    <span className="av2-support-templates-label">Templates</span>
                    <div className="av2-support-templates-list">
                      {templates.map(tpl => (
                        <button
                          key={tpl.id}
                          type="button"
                          className="av2-chip"
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
                  id="av2-support-reply-body"
                  rows={7}
                  value={replyBody}
                  onChange={e => setReplyBody(e.target.value)}
                  placeholder={
                    internalOnly
                      ? 'Note for operators only (not emailed)…'
                      : 'Write a reply — emailed to the customer and saved on this ticket…'
                  }
                  disabled={replyBusy}
                />
                <div className="av2-support-reply-actions">
                  <label className="av2-support-check">
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
                    className="av2-btn av2-btn-primary"
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
                  <p className="av2-error" role="alert">
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
