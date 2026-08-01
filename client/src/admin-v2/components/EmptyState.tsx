/**
 * Branded empty state with icon + message + optional action button.
 */
import type { ReactNode } from 'react'
import { MailX } from 'lucide-react'
import './EmptyState.css'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const displayIcon = icon ?? <MailX size={40} strokeWidth={1.5} />

  return (
    <div className="av2-empty-state">
      <div className="av2-empty-state-icon" aria-hidden="true">{displayIcon}</div>
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
