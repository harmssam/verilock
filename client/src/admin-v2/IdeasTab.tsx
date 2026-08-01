/**
 * Admin v2 X Ideas — ported from XIdeas with v2 styling.
 * New: character counter (280 limit, amber at 250, red at 280), ConfirmDialog instead of window.confirm.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type XIdea, type XIdeaInput } from '../admin/adminApi'
import { ConfirmDialog } from './components/ConfirmDialog'
import './IdeasTab.css'

interface Props {
  onAuthLost: () => void
}

type EditingState = { id: string; source_url: string; copy: string; idea_date: string } | null

const COPY_MAX = 280
const COPY_WARN = 250

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
    })
  }, [])

  // Character counter classes
  const copyLen = copy.length
  const copyCounterClass =
    copyLen >= COPY_MAX ? 'av2-ideas-counter--red' :
    copyLen >= COPY_WARN ? 'av2-ideas-counter--amber' :
    ''

  return (
    <div className="av2-ideas">
      <div className="av2-dash-head">
        <div>
          <h1 className="av2-dash-title">X Post Ideas</h1>
          <p className="av2-dash-subtitle">
            Paste ideas for X posts — source URLs, copy, and dates.
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

      {/* List */}
      {loading && <p className="av2-loading">Loading ideas…</p>}
      {error && (
        <p className="av2-error" role="alert">
          {error}
        </p>
      )}

      {!loading && ideas.length === 0 && (
        <p className="av2-ideas-empty">No ideas yet. Paste one above.</p>
      )}

      {ideas.length > 0 && (
        <div className="av2-ideas-list">
          {ideas.map(idea => (
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
                {idea.idea_date && (
                  <time className="av2-ideas-date" dateTime={idea.idea_date}>
                    {idea.idea_date}
                  </time>
                )}
              </div>
              <div className="av2-ideas-card-actions">
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
          ))}
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
}
