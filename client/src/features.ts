/**
 * Client feature flags.
 *
 * Email notify UI stays off until the Resend sending domain is verified.
 * Server must also set RESEND_ENABLED=true + EMAIL_NOTIFY_UI=true to go live.
 * Optional override: VITE_EMAIL_NOTIFY_UI=true for local previews.
 */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[name]
  if (raw == null || raw === '') return fallback
  const v = String(raw).trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export const FEATURES = {
  /** Optional “email me when everyone has signed” on create (Resend). */
  emailNotifyUi: envFlag('VITE_EMAIL_NOTIFY_UI', true),
} as const
