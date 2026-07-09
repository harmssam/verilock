/** Feature + Resend config. Emails stay off until RESEND_ENABLED=true after domain verify. */

function truthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim())
}

/** Master switch — leave false until the Resend sending domain is verified. */
export function isResendSendEnabled(): boolean {
  return isResendConfigured() && truthy(process.env.RESEND_ENABLED)
}

/**
 * When true, clients may show the optional “notify me by email” field.
 * Keep false until domain is ready so the UX stays clean.
 */
export function isEmailNotifyUiEnabled(): boolean {
  return truthy(process.env.EMAIL_NOTIFY_UI)
}

export function resendFromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    'VeriLock <onboarding@resend.dev>'
  )
}

/** Public site origin used in email deep links (no trailing slash). */
export function appPublicUrl(): string {
  const raw =
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    process.env.CORS_ORIGIN?.split(',')[0]?.trim() ||
    'https://verilock.online'
  return raw.replace(/\/$/, '')
}

export function emailFeaturesPublic() {
  return {
    emailNotifyUi: isEmailNotifyUiEnabled(),
    emailNotifySendEnabled: isResendSendEnabled(),
    emailNotifyConfigured: isResendConfigured(),
  }
}
