import './DocumentNotesPanel.css'

interface DocumentNotesPanelProps {
  notes: string | null | undefined
  compact?: boolean
}

export function DocumentNotesPanel({ notes, compact }: DocumentNotesPanelProps) {
  if (typeof notes !== 'string') return null
  const trimmed = notes.trim()
  if (!trimmed) return null

  return (
    <div className={`document-notes-panel${compact ? ' document-notes-panel--compact' : ''}`}>
      <h3 className="document-notes-panel-title">Notes</h3>
      <div className="document-notes-panel-block">
        <p className="document-notes-panel-text muted">{trimmed}</p>
      </div>
    </div>
  )
}