/**
 * Reusable badge/pill component for counts and status labels.
 */
import './Badge.css'

export type BadgeVariant = 'mint' | 'amber' | 'red' | 'gray'

interface BadgeProps {
  count: number
  variant?: BadgeVariant
  className?: string
  label?: string
}

export function Badge({ count, variant = 'gray', className, label }: BadgeProps) {
  const ariaLabel = label || `${count} items`
  return (
    <span
      className={`av2-badge av2-badge--${variant}${className ? ` ${className}` : ''}`}
      aria-label={ariaLabel}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}
