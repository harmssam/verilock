import './DocumentNotesPanel.css'

interface DocumentNotesPanelProps {
  notes: string
  compact?: boolean
}

export function DocumentNotesPanel({ notes, compact }: DocumentNotesPanelProps) {
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