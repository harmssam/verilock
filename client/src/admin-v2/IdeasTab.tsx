/**
 * Admin v2 X Ideas — Content Pipeline with statuses, kanban view, and posted URLs.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type XIdea, type XIdeaInput } from '../admin/adminApi'
import { ConfirmDialog } from './components/ConfirmDialog'
import './IdeasTab.css'

interface Props {
  onAuthLost: () => void
}

type EditingState = {
  id: string; source_url: string; copy: string; idea_date: string
  status: string; posted_url: string
} | null

const COPY_MAX = 280
const COPY_WARN = 250

const STATUS_OPTIONS = ['draft', 'ready', 'scheduled', 'posted', 'archived'] as const
type IdeaStatus = (typeof STATUS_OPTIONS)[number]

const STATUS_LABELS: Record<IdeaStatus, string> = {
  draft: 'Draft',
  ready: 'Ready',
  scheduled: 'Scheduled',
  posted: 'Posted',
  archived: 'Archived',
}

const STATUS_COLORS: Record<IdeaStatus, string> = {
  draft: 'gray',
  ready: 'amber',
  scheduled: 'blue',
  posted: 'green',
  archived: 'dim',
}

export function IdeasTab({ onAuthLost }: Props) {
  const [ideas, setIdeas] = useState<XIdea[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // New idea form
  const [sourceUrl, setSourceUrl] = useState('')
  const [copy, setCopy] = useState('')
  const [ideaDate, setIdeaDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Edit state
  const [editing, setEditing] = useState<EditingState>(null)

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Pipeline: mark as posted form
  const [postUrlIdea, setPostUrlIdea] = useState<XIdea | null>(null)
  const [postUrlValue, setPostUrlValue] = useState('')

  // Status filter
  const [statusFilter, setStatusFilter] = useState<IdeaStatus | 'all'>('all')

  // View mode: list or kanban
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')

  const copyRef = useRef<HTMLTextAreaElement>(null)

  const loadIdeas = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await adminApi.xIdeasList()
      setIdeas(result.ideas)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load ideas'
      setError(message)
      if ((err as { status?: number }).status === 401) onAuthLost()
    } finally {
      setLoading(false)
    }
  }, [onAuthLost])

  useEffect(() => {
    void loadIdeas()
  }, [loadIdeas])

  const handleAdd = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      const trimmed = copy.trim()
      if (!trimmed) return

      setSaving(true)
      setSaveError(null)
      try {
        await adminApi.xIdeasCreate({
          source_url: sourceUrl.trim(),
          copy: trimmed,
          idea_date: ideaDate,
        })
        setSourceUrl('')
        setCopy('')
        setIdeaDate(new Date().toISOString().slice(0, 10))
        copyRef.current?.focus()
        void loadIdeas()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save idea')
      } finally {
        setSaving(false)
      }
    },
    [sourceUrl, copy, ideaDate, loadIdeas],
  )

  const handleUpdate = useCallback(
    async (id: string, input: XIdeaInput) => {
      try {
        await adminApi.xIdeasUpdate(id, input)
        setEditing(null)
        void loadIdeas()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not update idea')
      }
    },
    [loadIdeas],
  )

  const handlePipelineUpdate = useCallback(
    async (id: string, status?: string, postedUrl?: string) => {
      try {
        await adminApi.xIdeasPipeline(id, { status, posted_url: postedUrl })
        setPostUrlIdea(null)
        setPostUrlValue('')
        void loadIdeas()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not update pipeline')
      }
    },
    [loadIdeas],
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteId) return
    try {
      await adminApi.xIdeasDelete(deleteId)
      setDeleteId(null)
      void loadIdeas()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete idea')
      setDeleteId(null)
    }
  }, [deleteId, loadIdeas])

  const startEdit = useCallback((idea: XIdea) => {
    setEditing({
      id: idea.id,
      source_url: idea.source_url,
      copy: idea.copy,
      idea_date: idea.idea_date,
      status: idea.status || 'draft',
      posted_url: idea.posted_url || '',
    })
  }, [])

  // Filter ideas by status
  const filteredIdeas = statusFilter === 'all'
    ? ideas
    : ideas.filter(i => (i.status || 'draft') === statusFilter)

  // Group for kanban
  const kanbanGroups: Record<IdeaStatus, XIdea[]> = {
    draft: [],
    ready: [],
    scheduled: [],
    posted: [],
    archived: [],
  }
  for (const idea of filteredIdeas) {
    const s = (idea.status || 'draft') as IdeaStatus
    if (kanbanGroups[s]) kanbanGroups[s].push(idea)
  }

  // Character counter classes
  const copyLen = copy.length
  const copyCounterClass =
    copyLen >= COPY_MAX ? 'av2-ideas-counter--red' :
    copyLen >= COPY_WARN ? 'av2-ideas-counter--amber' :
    ''

  const ensureStatus = (s: string | undefined): IdeaStatus =>
    STATUS_OPTIONS.includes(s as IdeaStatus) ? (s as IdeaStatus) : 'draft'

  return (
    <div className="av2-ideas">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">X Post Ideas</h1>
          <p className="av2-dash-subtitle">
            Content pipeline: draft → ready → scheduled → posted → archived.
          </p>
        </div>
      </div>

      {/* Add form */}
      <form className="av2-ideas-form" onSubmit={e => void handleAdd(e)}>
        <div className="av2-ideas-form-row">
          <div className="av2-ideas-field">
            <label htmlFor="av2-idea-source">Source URL</label>
            <input
              id="av2-idea-source"
              type="url"
              placeholder="https://reddit.com/r/..."
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="av2-ideas-field av2-ideas-field--date">
            <label htmlFor="av2-idea-date">Date</label>
            <input
              id="av2-idea-date"
              type="date"
              value={ideaDate}
              onChange={e => setIdeaDate(e.target.value)}
              disabled={saving}
            />
          </div>
        </div>
        <div className="av2-ideas-field">
          <label htmlFor="av2-idea-copy">Copy</label>
          <textarea
            ref={copyRef}
            id="av2-idea-copy"
            rows={3}
            placeholder="Paste your post idea or complaint quote here..."
            value={copy}
            onChange={e => setCopy(e.target.value)}
            disabled={saving}
            maxLength={COPY_MAX}
            required
          />
          <div className={`av2-ideas-counter ${copyCounterClass}`}>
            {copyLen}/{COPY_MAX}
          </div>
        </div>
        {saveError && (
          <p className="av2-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="av2-ideas-form-actions">
          <button
            type="submit"
            className="av2-btn av2-btn-accent"
            disabled={saving || !copy.trim()}
          >
            {saving ? 'Saving…' : 'Add Idea'}
          </button>
        </div>
      </form>

      {/* Status filter chips + view toggle */}
      <div className="av2-ideas-toolbar">
        <div className="av2-ideas-filters" role="group" aria-label="Status filter">
          {(['all', ...STATUS_OPTIONS] as const).map(s => (
            <button
              key={s}
              type="button"
              className={`av2-chip${statusFilter === s ? ' av2-chip--active' : ''}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="av2-ideas-view-toggle">
          <button
            type="button"
            className={`av2-chip${viewMode === 'list' ? ' av2-chip--active' : ''}`}
            onClick={() => setViewMode('list')}
          >
            List
          </button>
          <button
            type="button"
            className={`av2-chip${viewMode === 'kanban' ? ' av2-chip--active' : ''}`}
            onClick={() => setViewMode('kanban')}
          >
            Kanban
          </button>
        </div>
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="av2-ideas-edit-overlay" onClick={() => setEditing(null)}>
          <div className="av2-ideas-edit-card" onClick={e => e.stopPropagation()}>
            <h3>Edit Idea</h3>
            <div className="av2-ideas-field">
              <label htmlFor="av2-idea-edit-source">Source URL</label>
              <input
                id="av2-idea-edit-source"
                type="url"
                value={editing.source_url}
                onChange={e =>
                  setEditing(prev => (prev ? { ...prev, source_url: e.target.value } : null))
                }
              />
            </div>
            <div className="av2-ideas-field">
              <label htmlFor="av2-idea-edit-date">Date</label>
              <input
                id="av2-idea-edit-date"
                type="date"
                value={editing.idea_date}
                onChange={e =>
                  setEditing(prev => (prev ? { ...prev, idea_date: e.target.value } : null))
                }
              />
            </div>
            <div className="av2-ideas-field">
              <label htmlFor="av2-idea-edit-copy">Copy</label>
              <textarea
                id="av2-idea-edit-copy"
                rows={4}
                value={editing.copy}
                onChange={e =>
                  setEditing(prev => (prev ? { ...prev, copy: e.target.value } : null))
                }
                maxLength={COPY_MAX}
              />
              <div className={`av2-ideas-counter ${editing.copy.length >= COPY_MAX ? 'av2-ideas-counter--red' : editing.copy.length >= COPY_WARN ? 'av2-ideas-counter--amber' : ''}`}>
                {editing.copy.length}/{COPY_MAX}
              </div>
            </div>
            <div className="av2-ideas-edit-actions">
              <button
                type="button"
                className="av2-btn av2-btn-ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="av2-btn av2-btn-primary"
                onClick={() =>
                  void handleUpdate(editing.id, {
                    source_url: editing.source_url,
                    copy: editing.copy,
                    idea_date: editing.idea_date,
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mark as posted modal */}
      {postUrlIdea && (
        <div className="av2-ideas-edit-overlay" onClick={() => { setPostUrlIdea(null); setPostUrlValue('') }}>
          <div className="av2-ideas-edit-card" onClick={e => e.stopPropagation()}>
            <h3>Mark as Posted</h3>
            <p className="av2-settings-section-desc">
              Enter the URL of the published X post.
            </p>
            <div className="av2-ideas-field">
              <label htmlFor="av2-idea-post-url">Posted URL</label>
              <input
                id="av2-idea-post-url"
                type="url"
                placeholder="https://x.com/..."
                value={postUrlValue}
                onChange={e => setPostUrlValue(e.target.value)}
              />
            </div>
            <div className="av2-ideas-edit-actions">
              <button
                type="button"
                className="av2-btn av2-btn-ghost"
                onClick={() => { setPostUrlIdea(null); setPostUrlValue('') }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="av2-btn av2-btn-accent"
                onClick={() => void handlePipelineUpdate(postUrlIdea.id, 'posted', postUrlValue)}
              >
                Mark Posted
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading && <p className="av2-loading">Loading ideas…</p>}
      {error && (
        <p className="av2-error" role="alert">
          {error}
        </p>
      )}

      {!loading && filteredIdeas.length === 0 && (
        <p className="av2-ideas-empty">No ideas yet. Paste one above.</p>
      )}

      {/* Kanban view */}
      {!loading && viewMode === 'kanban' && filteredIdeas.length > 0 && (
        <div className="av2-ideas-kanban">
          {STATUS_OPTIONS.map(status => (
            <div key={status} className="av2-ideas-kanban-col">
              <div className={`av2-ideas-kanban-header av2-ideas-kanban-header--${STATUS_COLORS[status]}`}>
                {STATUS_LABELS[status]}
                <span className="av2-ideas-kanban-count">{kanbanGroups[status].length}</span>
              </div>
              <div className="av2-ideas-kanban-cards">
                {kanbanGroups[status].map(idea => renderIdeaCard(idea))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List view */}
      {!loading && viewMode === 'list' && filteredIdeas.length > 0 && (
        <div className="av2-ideas-list">
          {filteredIdeas.map(idea => renderIdeaCard(idea))}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteId !== null}
        title="Delete idea"
        message="Delete this idea? This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  )

  function renderIdeaCard(idea: XIdea) {
    const s = ensureStatus(idea.status)
    const isDraft = s === 'draft'

    return (
      <article key={idea.id} className="av2-ideas-card">
        <div className="av2-ideas-card-body">
          {idea.source_url && (
            <a
              className="av2-ideas-source"
              href={idea.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {idea.source_url.length > 80
                ? idea.source_url.slice(0, 80) + '…'
                : idea.source_url}
            </a>
          )}
          <p className="av2-ideas-copy">{idea.copy}</p>
          <div className="av2-ideas-card-meta">
            {/* Status badge */}
            <span className={`av2-ideas-status av2-ideas-status--${STATUS_COLORS[s]}`}>
              {STATUS_LABELS[s]}
            </span>
            {idea.idea_date && (
              <time className="av2-ideas-date" dateTime={idea.idea_date}>
                {idea.idea_date}
              </time>
            )}
            {idea.posted_url && (
              <a
                className="av2-ideas-posted-url"
                href={idea.posted_url}
                target="_blank"
                rel="noopener noreferrer"
                title={idea.posted_url}
              >
                ↗ View post
              </a>
            )}
          </div>
        </div>
        <div className="av2-ideas-card-actions">
          {/* Pipeline actions */}
          {isDraft && (
            <button
              type="button"
              className="av2-btn av2-btn-ghost av2-btn-sm"
              onClick={() => void handlePipelineUpdate(idea.id, 'ready')}
              title="Mark as ready"
            >
              → Ready
            </button>
          )}
          {(s === 'ready' || s === 'draft') && (
            <button
              type="button"
              className="av2-btn av2-btn-ghost av2-btn-sm"
              onClick={() => {
                setPostUrlIdea(idea)
                setPostUrlValue(idea.posted_url || '')
              }}
              title="Mark as posted"
            >
              ✓ Posted
            </button>
          )}
          {s === 'posted' && (
            <button
              type="button"
              className="av2-btn av2-btn-ghost av2-btn-sm"
              onClick={() => void handlePipelineUpdate(idea.id, 'archived')}
              title="Archive"
            >
              ↵ Archive
            </button>
          )}
          {s === 'archived' && (
            <button
              type="button"
              className="av2-btn av2-btn-ghost av2-btn-sm"
              onClick={() => void handlePipelineUpdate(idea.id, 'draft')}
              title="Restore to draft"
            >
              ↺ Restore
            </button>
          )}
          <button
            type="button"
            className="av2-btn av2-btn-ghost av2-btn-sm"
            onClick={() => startEdit(idea)}
          >
            Edit
          </button>
          <button
            type="button"
            className="av2-btn av2-btn-ghost av2-btn-sm av2-btn-danger-text"
            onClick={() => setDeleteId(idea.id)}
          >
            Delete
          </button>
        </div>
      </article>
    )
  }
}
