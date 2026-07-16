/**
 * Public support contact form — validation, bot checks, email delivery.
 */
import {
  appPublicUrl,
  isResendSendEnabled,
  resendFromAddress,
} from './email/config.js'
import { sendTransactionalEmail } from './email/resend.js'

export const MAX_SUPPORT_NAME_LENGTH = 80
export const MAX_SUPPORT_SUBJECT_LENGTH = 120
export const MAX_SUPPORT_MESSAGE_LENGTH = 4000
export const MAX_SUPPORT_EMAIL_LENGTH = 254

/** Minimum time (ms) a human needs before submit — bots often fire instantly. */
export const SUPPORT_MIN_FILL_MS = 2_500
/** Reject absurdly old formStartedAt (stale tabs / replay). */
export const SUPPORT_MAX_FILL_MS = 24 * 60 * 60 * 1000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, '')
}

function truthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim())
}

/** When true and secret is set, missing/invalid Turnstile tokens are rejected. */
export function isTurnstileRequired(): boolean {
  if (!isTurnstileConfigured()) return false
  // Default: require when secret is present. Opt out with TURNSTILE_REQUIRED=false.
  const raw = process.env.TURNSTILE_REQUIRED
  if (raw == null || raw === '') return true
  return truthy(raw)
}

export function supportInboxAddress(): string {
  return (
    process.env.SUPPORT_TO_EMAIL?.trim() ||
    process.env.SUPPORT_INBOX?.trim() ||
    'support@verilock.online'
  )
}

export function supportContactPublicFeatures() {
  return {
    turnstileRequired: isTurnstileRequired(),
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY?.trim() || null,
    supportSendEnabled: isResendSendEnabled(),
  }
}

export interface SupportContactBody {
  name?: unknown
  email?: unknown
  subject?: unknown
  message?: unknown
  /** Honeypot — must be empty. */
  website?: unknown
  /** Client clock when form mounted (ms since epoch). */
  formStartedAt?: unknown
  /** Cloudflare Turnstile token when widget is shown. */
  turnstileToken?: unknown
}

export type SupportSanitizeResult =
  | {
      ok: true
      name: string
      email: string
      subject: string
      message: string
      formStartedAt: number
      turnstileToken: string | null
    }
  | { ok: false; error: string; status: number }
  /** Silent bot rejection — respond 200 so scrapers don't probe. */
  | { ok: false; silent: true }

export function sanitizeSupportContact(body: SupportContactBody): SupportSanitizeResult {
  // Honeypot: any non-empty value = bot. Fail closed silently.
  if (typeof body.website === 'string' && body.website.trim().length > 0) {
    return { ok: false, silent: true }
  }
  if (body.website != null && typeof body.website !== 'string') {
    return { ok: false, silent: true }
  }

  const formStartedAt =
    typeof body.formStartedAt === 'number'
      ? body.formStartedAt
      : typeof body.formStartedAt === 'string' && body.formStartedAt.trim()
        ? Number(body.formStartedAt)
        : NaN

  if (!Number.isFinite(formStartedAt)) {
    return { ok: false, error: 'Invalid form session. Reload the page and try again.', status: 400 }
  }

  const elapsed = Date.now() - formStartedAt
  if (elapsed < SUPPORT_MIN_FILL_MS) {
    // Too fast — treat as bot, silent success.
    return { ok: false, silent: true }
  }
  if (elapsed > SUPPORT_MAX_FILL_MS || formStartedAt > Date.now() + 60_000) {
    return { ok: false, error: 'Form session expired. Reload the page and try again.', status: 400 }
  }

  const name = stripControlChars(String(body.name ?? ''))
    .trim()
    .slice(0, MAX_SUPPORT_NAME_LENGTH)
  if (!name || name.length < 2) {
    return { ok: false, error: 'Please enter your name (at least 2 characters).', status: 400 }
  }

  const email = stripControlChars(String(body.email ?? ''))
    .trim()
    .toLowerCase()
    .slice(0, MAX_SUPPORT_EMAIL_LENGTH)
  if (!email || !EMAIL_RE.test(email) || email.includes('..')) {
    return { ok: false, error: 'Please enter a valid email address.', status: 400 }
  }

  const subject = stripControlChars(String(body.subject ?? ''))
    .trim()
    .slice(0, MAX_SUPPORT_SUBJECT_LENGTH)
  if (!subject || subject.length < 3) {
    return { ok: false, error: 'Please enter a short subject.', status: 400 }
  }

  const message = stripControlChars(String(body.message ?? ''))
    .trim()
    .slice(0, MAX_SUPPORT_MESSAGE_LENGTH)
  if (!message || message.length < 10) {
    return { ok: false, error: 'Please enter a message (at least 10 characters).', status: 400 }
  }

  const turnstileToken =
    typeof body.turnstileToken === 'string' && body.turnstileToken.trim()
      ? body.turnstileToken.trim()
      : null

  return { ok: true, name, email, subject, message, formStartedAt, turnstileToken }
}

interface TurnstileVerifyResponse {
  success?: boolean
  'error-codes'?: string[]
  action?: string
  cdata?: string
}

export async function verifyTurnstileToken(
  token: string | null,
  remoteIp?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isTurnstileRequired()) {
    return { ok: true }
  }

  const secret = process.env.TURNSTILE_SECRET_KEY?.trim()
  if (!secret) {
    return { ok: true }
  }

  if (!token) {
    return { ok: false, error: 'Please complete the bot check and try again.' }
  }

  try {
    const form = new URLSearchParams()
    form.set('secret', secret)
    form.set('response', token)
    if (remoteIp) form.set('remoteip', remoteIp)

    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })

    if (!res.ok) {
      console.error('[support] turnstile HTTP', res.status)
      return { ok: false, error: 'Bot check failed. Please try again.' }
    }

    const data = (await res.json()) as TurnstileVerifyResponse
    if (!data.success) {
      console.warn('[support] turnstile rejected', data['error-codes'])
      return { ok: false, error: 'Bot check failed. Please try again.' }
    }
    return { ok: true }
  } catch (err) {
    console.error('[support] turnstile verify error', err)
    return { ok: false, error: 'Bot check unavailable. Please try again shortly.' }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type DeliverSupportResult =
  | { ok: true; id: string }
  | { ok: false; error: string; status: number }

export async function deliverSupportContact(input: {
  name: string
  email: string
  subject: string
  message: string
}): Promise<DeliverSupportResult> {
  if (!isResendSendEnabled()) {
    console.log('[support] contact received (email send disabled)', {
      name: input.name,
      email: input.email,
      subject: input.subject,
      messageLen: input.message.length,
    })
    // Dev / pre-domain: accept so the form is testable without Resend.
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, id: 'dev-logged' }
    }
    return {
      ok: false,
      error: 'Support email is temporarily unavailable. Please try again later.',
      status: 503,
    }
  }

  const to = supportInboxAddress()
  const site = appPublicUrl()
  const mailSubject = `[VeriLock Support] ${input.subject}`
  const text = [
    `New support message from ${site}`,
    '',
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Subject: ${input.subject}`,
    '',
    input.message,
    '',
    '—',
    `Reply-To should be set to the sender. From: ${resendFromAddress()}`,
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:560px">
      <p style="font-size:13px;color:#64748b;margin:0 0 1rem">New support message from <a href="${escapeHtml(site)}">${escapeHtml(site)}</a></p>
      <p style="margin:0 0 0.35rem"><strong>Name:</strong> ${escapeHtml(input.name)}</p>
      <p style="margin:0 0 0.35rem"><strong>Email:</strong> <a href="mailto:${escapeHtml(input.email)}">${escapeHtml(input.email)}</a></p>
      <p style="margin:0 0 1rem"><strong>Subject:</strong> ${escapeHtml(input.subject)}</p>
      <div style="white-space:pre-wrap;padding:1rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">${escapeHtml(input.message)}</div>
    </div>
  `.trim()

  const result = await sendTransactionalEmail({
    to,
    subject: mailSubject,
    text,
    html,
    replyTo: input.email,
  })

  if (result.ok) {
    console.log('[support] contact emailed', { id: result.id, to })
    return { ok: true, id: result.id }
  }

  if ('skipped' in result && result.skipped) {
    console.log('[support] contact skipped', { reason: result.reason })
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, id: 'dev-skipped' }
    }
    return {
      ok: false,
      error: 'Support email is temporarily unavailable. Please try again later.',
      status: 503,
    }
  }

  console.error('[support] contact send failed', {
    error: 'error' in result ? result.error : 'unknown',
  })
  return {
    ok: false,
    error: 'Could not send your message. Please try again shortly.',
    status: 502,
  }
}

export function clientIpFromRequest(req: {
  headers: { [key: string]: string | string[] | undefined }
  socket?: { remoteAddress?: string | undefined }
}): string | null {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || null
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(',')[0]?.trim() || null
  }
  return req.socket?.remoteAddress ?? null
}
