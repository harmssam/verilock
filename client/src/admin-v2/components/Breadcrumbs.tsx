/**
 * Breadcrumb navigation — shown above the content area.
 * Hidden on Dashboard; on mobile only shows the last segment.
 */
import type { AdminV2Tab } from './Sidebar'
import './Breadcrumbs.css'

export interface BreadcrumbSegment {
  label: string
  /** If provided, clicking navigates to this tab. If omitted, the segment is not clickable. */
  tab?: AdminV2Tab
}

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[]
  onNavigate: (tab: AdminV2Tab) => void
}

const tabLabels: Record<AdminV2Tab, string> = {
  dashboard: 'Dashboard',
  inbox: 'Inbox',
  support: 'Support',
  stats: 'Stats',
  content: 'Content',
  studio: 'Studio',
  settings: 'Settings',
}

export function Breadcrumbs({ segments, onNavigate }: BreadcrumbsProps) {
  if (segments.length === 0) return null

  return (
    <nav className="av2-breadcrumbs" aria-label="Breadcrumb">
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1
        const showOnMobile = isLast

        return (
          <span
            key={`${seg.label}-${i}`}
            className={`av2-breadcrumb-segment${showOnMobile ? '' : ' av2-breadcrumb-segment--hide-mobile'}`}
          >
            {i > 0 && (
              <span className="av2-breadcrumb-sep" aria-hidden="true">
                ›
              </span>
            )}
            {seg.tab && !isLast ? (
              <button
                type="button"
                className="av2-breadcrumb-link"
                onClick={() => onNavigate(seg.tab!)}
              >
                {seg.label}
              </button>
            ) : (
              <span className="av2-breadcrumb-current">{seg.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}

export function breadcrumbLabel(tab: AdminV2Tab): string {
  return tabLabels[tab] || tab
}
