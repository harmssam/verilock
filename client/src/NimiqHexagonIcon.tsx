/**
 * Official Nimiq colored hexagon mark from the design kit
 * (https://nimiq.dev/design-kit — logos/nimiq/hexagon.svg).
 * Served from /nimiq-hexagon.svg so gradient IDs stay unique per image paint.
 */
interface NimiqHexagonIconProps {
  /** Width in CSS pixels; height follows the 20×18 viewBox. */
  size?: number
  className?: string
  title?: string
}

export function NimiqHexagonIcon({ size = 16, className, title }: NimiqHexagonIconProps) {
  const height = Math.round((size * 18) / 20)
  const decorative = !title
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
    />
  )
}
