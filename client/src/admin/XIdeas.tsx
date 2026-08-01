/**
 * X Ideas — simple idea page for X post content.
 * Paste ideas with source URLs, copy, and date. List, add, edit, delete.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { adminApi, type XIdea, type XIdeaInput } from './adminApi'

export interface XIdeasProps {
  onAuthLost: () => void
}

type EditingState = { id: string; source_url: string; copy: string; idea_date: string } | null

export function XIdeas({ onAuthLost }: XIdeasProps) {
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

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('Delete this idea?')) return
      try {
        await adminApi.xIdeasDelete(id)
        void loadIdeas()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete idea')
      }
    },
    [loadIdeas],
  )

  const startEdit = useCallback((idea: XIdea) => {
    setEditing({
      id: idea.id,
      source_url: idea.source_url,
      copy: idea.copy,
      idea_date: idea.idea_date,
    })
  }, [])

  return (
    <section className="admin-ideas">
      <h2>X Post Ideas</h2>
      <p className="admin-ideas-desc">
        Paste ideas for X posts — source URLs, copy, and dates.
      </p>

      {/* Add / Edit form */}
      <form className="admin-ideas-form" onSubmit={e => void handleAdd(e)}>
        <div className="admin-ideas-form-row">
          <div className="admin-field">
            <label htmlFor="xidea-source">Source URL</label>
            <input
              id="xidea-source"
              type="url"
              placeholder="https://reddit.com/r/..."
              value={sourceUrl}
              onChange={e => setSourceUrl(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="admin-field admin-field--date">
            <label htmlFor="xidea-date">Date</label>
            <input
              id="xidea-date"
              type="date"
              value={ideaDate}
              onChange={e => setIdeaDate(e.target.value)}
              disabled={saving}
            />
          </div>
        </div>
        <div className="admin-field">
          <label htmlFor="xidea-copy">Copy</label>
          <textarea
            ref={copyRef}
            id="xidea-copy"
            rows={3}
            placeholder="Paste your post idea or complaint quote here..."
            value={copy}
            onChange={e => setCopy(e.target.value)}
            disabled={saving}
            required
          />
        </div>
        {saveError && (
          <p className="admin-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="admin-ideas-form-actions">
          <button
            type="submit"
            className="admin-btn admin-btn-primary"
            disabled={saving || !copy.trim()}
          >
            {saving ? 'Saving…' : 'Add Idea'}
          </button>
        </div>
      </form>

      {/* Edit modal */}
      {editing && (
        <div className="admin-ideas-edit-overlay" onClick={() => setEditing(null)}>
          <div className="admin-ideas-edit-card" onClick={e => e.stopPropagation()}>
            <h3>Edit Idea</h3>
            <div className="admin-field">
              <label htmlFor="xidea-edit-source">Source URL</label>
              <input
                id="xidea-edit-source"
                type="url"
                value={editing.source_url}
                onChange={e =>
                  setEditing(prev => (prev ? { ...prev, source_url: e.target.value } : null))
                }
              />
            </div>
            <div className="admin-field">
              <label htmlFor="xidea-edit-date">Date</label>
              <input
                id="xidea-edit-date"
                type="date"
                value={editing.idea_date}
                onChange={e =>
                  setEditing(prev => (prev ? { ...prev, idea_date: e.target.value } : null))
                }
              />
            </div>
            <div className="admin-field">
              <label htmlFor="xidea-edit-copy">Copy</label>
              <textarea
                id="xidea-edit-copy"
                rows={4}
                value={editing.copy}
                onChange={e =>
                  setEditing(prev => (prev ? { ...prev, copy: e.target.value } : null))
                }
              />
            </div>
            <div className="admin-ideas-edit-actions">
              <button
                type="button"
                className="admin-btn admin-btn-ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-primary"
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
      {loading && <p className="admin-loading">Loading ideas…</p>}
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      {!loading && ideas.length === 0 && (
        <p className="admin-ideas-empty">No ideas yet. Paste one above.</p>
      )}

      {ideas.length > 0 && (
        <div className="admin-ideas-list">
          {ideas.map(idea => (
            <article key={idea.id} className="admin-ideas-card">
              <div className="admin-ideas-card-body">
                {idea.source_url && (
                  <a
                    className="admin-ideas-source"
                    href={idea.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {idea.source_url.length > 80
                      ? idea.source_url.slice(0, 80) + '…'
                      : idea.source_url}
                  </a>
                )}
                <p className="admin-ideas-copy">{idea.copy}</p>
                {idea.idea_date && (
                  <time className="admin-ideas-date" dateTime={idea.idea_date}>
                    {idea.idea_date}
                  </time>
                )}
              </div>
              <div className="admin-ideas-card-actions">
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost admin-btn-sm"
                  onClick={() => startEdit(idea)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost admin-btn-sm admin-btn-danger"
                  onClick={() => void handleDelete(idea.id)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
