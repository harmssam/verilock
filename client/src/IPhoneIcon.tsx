/**
 * Compact iPhone outline for button icons (Nimiq Pay / mobile handoff).
 * Uses currentColor so it matches surrounding label text.
 */
interface IPhoneIconProps {
  size?: number
  className?: string
  /** Stroke weight for the body outline. */
  strokeWidth?: number
}

export function IPhoneIcon({ size = 16, className, strokeWidth = 2 }: IPhoneIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="7"
        y="2.5"
        width="10"
        height="19"
        rx="2.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
      />
      {/* Notch / Dynamic Island bar */}
      <rect x="9.5" y="4" width="5" height="1.4" rx="0.7" fill="currentColor" />
      {/* Home indicator */}
      <rect
        x="9.5"
        y="19.2"
        width="5"
        height="1.2"
        rx="0.6"
        fill="currentColor"
        opacity={0.7}
      />
    </svg>
  )
}
