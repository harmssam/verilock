import type { MouseEvent, ReactNode } from 'react'
import './TextLink.css'

interface TextLinkProps {
  children: ReactNode
  onClick?: () => void
  href?: string
  disabled?: boolean
  className?: string
  title?: string
}

export function TextLink({
  children,
  onClick,
  href,
  disabled,
  className,
  title,
}: TextLinkProps) {
  const classes = ['text-link', className].filter(Boolean).join(' ')

  const handleClick = (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (disabled) {
      event.preventDefault()
      return
    }
    onClick?.()
  }

  if (href && !disabled) {
    return (
      <a className={classes} href={href} onClick={handleClick} title={title}>
        {children}
      </a>
    )
  }

  if (onClick || disabled) {
    return (
      <button
        type="button"
        className={classes}
        onClick={handleClick}
        disabled={disabled}
        title={title}
      >
        {children}
      </button>
    )
  }

  return <span className={classes}>{children}</span>
}