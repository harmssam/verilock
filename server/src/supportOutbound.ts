/**
 * Single path for customer-facing support emails + thread logging.
 */
import {
  addSupportTicketMessage,
  type SupportMessageKind,
  type SupportTicketRecord,
} from './supportTickets.js'
import { appPublicUrl, isResendSendEnabled } from './email/config.js'
import { sendTransactionalEmail } from './email/resend.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export type SendCustomerTicketEmailResult =
  | { ok: true; resendId: string }
  | { ok: false; error: string; skipped?: boolean }

/**
 * Email the customer and append the exact payload to the ticket thread.
 * Does not claim volume-notice state — callers own that.
 */
export async function sendCustomerTicketEmail(input: {
  ticket: SupportTicketRecord
  subject: string
  body: string
  messageKind: Extract<SupportMessageKind, 'auto_ack' | 'volume_notice' | 'human_reply'>
  authorName: string
  /** Default false for auto_ack / volume_notice; true for human_reply. */
  bumpStatus?: boolean
}): Promise<SendCustomerTicketEmailResult> {
  const site = appPublicUrl()
  const { ticket, subject, body, messageKind, authorName } = input
  const bumpStatus =
    input.bumpStatus !== undefined ? input.bumpStatus : messageKind === 'human_reply'

  if (!isResendSendEnabled()) {
    addSupportTicketMessage({
      ticketId: ticket.id,
      messageKind: 'internal',
      authorName: 'System',
      body: `Outbound email disabled - did not send (${messageKind}).\n\nSubject: ${subject}\n\n${body}`,
      bumpStatus: false,
    })
    return { ok: false, error: 'Outbound email is not enabled on this server.', skipped: true }
  }

  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.55;color:#0f172a;max-width:560px">
      <div style="white-space:pre-wrap;margin:0 0 1.25rem">${escapeHtml(body)}</div>
      <p style="margin:0;font-size:13px;color:#64748b">
        Ticket <strong>${escapeHtml(ticket.publicId)}</strong> ·
        <a href="${escapeHtml(site)}">${escapeHtml(site)}</a>
      </p>
    </div>
  `.trim()

  const result = await sendTransactionalEmail({
    to: ticket.email,
    subject,
    text: body,
    html,
  })

  if (!result.ok) {
    const error =
      'skipped' in result && result.skipped
        ? result.reason
        : 'error' in result
          ? result.error
          : 'Could not send email'
    addSupportTicketMessage({
      ticketId: ticket.id,
      messageKind: 'internal',
      authorName: 'System',
      body: `Failed to email customer (${messageKind}): ${error}\n\nSubject: ${subject}\n\n${body}`,
      bumpStatus: false,
    })
    return {
      ok: false,
      error,
      skipped: 'skipped' in result ? result.skipped : false,
    }
  }

  addSupportTicketMessage({
    ticketId: ticket.id,
    messageKind,
    authorName,
    body: `[Emailed to customer]\nSubject: ${subject}\n\n${body}`,
    resendMessageId: result.id,
    bumpStatus,
  })

  return { ok: true, resendId: result.id }
}
