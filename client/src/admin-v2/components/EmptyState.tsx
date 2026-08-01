/**
 * Branded empty state with icon + message + optional action button.
 */
import './EmptyState.css'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="av2-empty-state">
      <div className="av2-empty-state-icon" aria-hidden="true">{icon}</div>
      <h3 className="av2-empty-state-title">{title}</h3>
      {description && (
        <p className="av2-empty-state-desc">{description}</p>
      )}
      {actionLabel && onAction && (
        <button
          type="button"
          className="av2-btn av2-btn-accent"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
