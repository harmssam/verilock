import type { MouseEvent, ReactNode } from 'react'

interface AppLinkProps {
  children: ReactNode
  to: string
  onClick: () => void
  className?: string
  title?: string
  'aria-label'?: string
  'aria-current'?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
}

/**
 * Renders a crawler-friendly <a href> that uses SPA navigation on click.
 *
 * Key behavior: Googlebot (and other crawlers) see a real <a href> link and can
 * follow it for discovery. Human users get an SPA transition without a page reload.
 */
export function AppLink({
  children,
  to,
  onClick,
  className,
  title,
  ...ariaProps
}: AppLinkProps) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Let cmd/ctrl+click, middle-click, shift+click, alt+click use native browser behavior.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    onClick()
  }

  return (
    <a
      href={to}
      className={className}
      title={title}
      onClick={handleClick}
      {...ariaProps}
    >
      {children}
    </a>
  )
}
