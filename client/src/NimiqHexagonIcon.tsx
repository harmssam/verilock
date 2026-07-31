/**
 * Official Nimiq colored hexagon mark from the design kit
 * (https://nimiq.dev/design-kit - logos/nimiq/hexagon.svg).
 *
 * Inlined SVG (not <img>) so Safari ≤17 cannot use the default replaced-element
 * size (~300×150) in flex min-content and blow up Login / Hub buttons.
 * Gradient ids are unique per instance via useId.
 */
import { useId } from 'react'

interface NimiqHexagonIconProps {
  /** Width in CSS pixels; height follows the 20×18 viewBox. */
  size?: number
  className?: string
  title?: string
}

export function NimiqHexagonIcon({ size = 16, className, title }: NimiqHexagonIconProps) {
  const height = Math.round((size * 18) / 20)
  const uid = useId().replace(/:/g, '')
  const gradId = `nimiq-hex-g-${uid}`
  const decorative = !title

  return (
    <svg
      className={['nimiq-hexagon-icon', className].filter(Boolean).join(' ')}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={height}
      viewBox="0 0 20 18"
      focusable="false"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <g fill="none">
        <path
          fill={`url(#${gradId})`}
          d="M19.734 8.156 15.576.844A1.66 1.66 0 0014.135 0H5.819C5.226 0 4.677.32 4.38.844L.222 8.156a1.71 1.71 0 000 1.688l4.158 7.312c.297.523.846.844 1.439.844h8.316c.593 0 1.142-.32 1.438-.844l4.158-7.312c.3-.523.3-1.165.003-1.688"
        />
        <defs>
          <radialGradient
            id={gradId}
            cx="0"
            cy="0"
            r="1"
            gradientTransform="matrix(-19.9562 0 0 -18 19.956 18)"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#EC991C" />
            <stop offset="1" stopColor="#E9B213" />
          </radialGradient>
        </defs>
      </g>
    </svg>
  )
}
