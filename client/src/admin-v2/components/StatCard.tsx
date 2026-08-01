/**
 * KPI stat card — used in Dashboard + Stats pages.
 */
import type { ReactNode } from 'react'
import './StatCard.css'

interface StatCardProps {
  label: string
  value: number | string
  icon?: ReactNode
  delta?: string
  deltaPositive?: boolean
  clickable?: boolean
  onClick?: () => void
}

export function StatCard({
  label,
  value,
  icon,
  delta,
  deltaPositive,
  clickable = false,
  onClick,
}: StatCardProps) {
  const formattedValue = typeof value === 'number' ? value.toLocaleString() : value

  return (
    <div
      className={`av2-stat-card${clickable ? ' av2-stat-card--clickable' : ''}`}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={
        clickable
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      <div className="av2-stat-card-head">
        <span className="av2-stat-card-label">{label}</span>
        {icon && <span className="av2-stat-card-icon" aria-hidden="true">{icon}</span>}
      </div>
      <div className="av2-stat-card-value">{formattedValue}</div>
      {delta && (
        <div className={`av2-stat-card-delta${deltaPositive === true ? ' av2-stat-card-delta--up' : deltaPositive === false ? ' av2-stat-card-delta--down' : ''}`}>
          {delta}
        </div>
      )}
    </div>
  )
}
