import { Resend } from 'resend'
import {
  appPublicUrl,
  isResendSendEnabled,
  resendFromAddress,
} from './config.js'

let client: Resend | null = null

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return null
  if (!client) client = new Resend(key)
  return client
}

export interface SendEmailInput {
  to: string
  subject: string
  text: string
  html: string
  /** Optional Reply-To (e.g. support form sender). */
  replyTo?: string
}

export type SendEmailResult =
  | { ok: true; id: string }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string }

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!isResendSendEnabled()) {
    return {
      ok: false,
      skipped: true,
      reason: 'RESEND_ENABLED is not true (waiting on domain / feature flag)',
    }
  }

  const resend = getClient()
  if (!resend) {
    return { ok: false, skipped: true, reason: 'RESEND_API_KEY missing' }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: resendFromAddress(),
      to: [input.to],
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      subject: input.subject,
      text: input.text,
      html: input.html,
    })

    if (error) {
      return { ok: false, skipped: false, error: error.message }
    }
    if (!data?.id) {
      return { ok: false, skipped: false, error: 'Resend returned no message id' }
    }
    return { ok: true, id: data.id }
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      error: err instanceof Error ? err.message : 'Resend send failed',
    }
  }
}

export function documentDeepLink(slug: string): string {
  return `${appPublicUrl()}/d/${slug}`
}

/**
 * Nimiq Pay mini-app deeplink for a full HTTPS page (invite path + query).
 * Protocol: `nimiqpay://miniapp?url=<encoded https url>`
 * @see https://www.nimiq.dev/mini-apps — Sharing Your Mini App
 */
export function nimiqPayMiniAppDeepLink(httpsUrl: string): string {
  return `nimiqpay://miniapp?url=${encodeURIComponent(httpsUrl)}`
}
