/**
 * Guest signing feature flag (create/sign without a Nimiq wallet).
 *
 * GUEST_SIGNING - server kill-switch for guest-capable routes (default: off).
 * Per `docs/guest-signing-plan.md`: build-time env convention, matching
 * PDF_ANNOTATION_UI's pattern in `pdfAnnotationConfig.ts`.
 */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw == null || raw === '') return fallback
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes') return true
  return fallback
}

/** Guest create/sign/claim routes. Default off until soak-tested. */
export function isGuestSigningEnabled(): boolean {
  return envFlag('GUEST_SIGNING', false)
}

export function guestSigningFeaturesPublic(): { guestSigning: boolean } {
  return {
    guestSigning: isGuestSigningEnabled(),
  }
}
