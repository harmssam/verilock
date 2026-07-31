/**
 * Official Nimiq colored hexagon mark from the design kit
 * (https://nimiq.dev/design-kit - logos/nimiq/hexagon.svg).
 * Served from /nimiq-hexagon.svg so gradient IDs stay unique per image paint.
 *
 * Display size is applied via CSS custom properties (not only HTML width/height).
 * Safari ≤17 flex min-content can treat SVG <img> without CSS size as the
 * default replaced size (~300×150), which blows up Login / Hub buttons.
 * Callers may still override width/height in CSS (e.g. price page mark).
 */
import type { CSSProperties } from 'react'

interface NimiqHexagonIconProps {
  /** Width in CSS pixels; height follows the 20×18 viewBox. */
  size?: number
  className?: string
  title?: string
}

export function NimiqHexagonIcon({ size = 16, className, title }: NimiqHexagonIconProps) {
  const height = Math.round((size * 18) / 20)
  const decorative = !title
  const sizeStyle = {
    ['--nimiq-hex-w']: `${size}px`,
    ['--nimiq-hex-h']: `${height}px`,
  } as CSSProperties

  return (
    <img
      className={['nimiq-hexagon-icon', className].filter(Boolean).join(' ')}
      src="/nimiq-hexagon.svg"
      alt={title ?? ''}
      width={size}
      height={height}
      decoding="async"
      aria-hidden={decorative ? true : undefined}
      title={title}
      style={sizeStyle}
    />
  )
}
