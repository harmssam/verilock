/**
 * Per-person signing invite (Resend). No PDF attachment — link + copy only.
 */
import { assertDocumentCreator } from '../documents.js'
import { getPartiesForDocument, getPartyById } from '../db.js'
import { normalizeAddress } from '../addresses.js'
import { sanitizeNotifyEmail } from '../security.js'
import { appPublicUrl, isResendSendEnabled } from './config.js'
import { documentDeepLink, nimiqPayMiniAppDeepLink, sendTransactionalEmail } from './resend.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** True when the label is a truncated Nimiq address, not a human name. */
function looksLikeAddressLabel(name: string): boolean {
  return /^NQ[0-9A-Z…]{4,}/i.test(name.replace(/\s/g, '')) || /…/.test(name)
}

/**
 * Prefer the step-1 organizer name stored on the document (survives roster rebuild).
 * Fall back to the creator's party slot, then a generic label.
 */
function resolveOrganizerName(doc: {
  creatorAddress: string
  creatorDisplayName?: string | null
  id: string
}): string {
  const stored = doc.creatorDisplayName?.trim()
  if (stored && !looksLikeAddressLabel(stored)) return stored

  const parties = getPartiesForDocument(doc.id)
  const creatorAddr = normalizeAddress(doc.creatorAddress)
  const creatorParty = parties.find(
    p => p.walletAddress && normalizeAddress(p.walletAddress) === creatorAddr,
  )
  const partyName = creatorParty?.displayName?.trim()
  if (partyName && !looksLikeAddressLabel(partyName)) return partyName

  if (stored) return stored
  return 'The organizer'
}

export type InviteSignerResult =
  | { ok: true; id: string; to: string; partyId: string }
  | { ok: false; status: number; error: string }

/**
 * Creator sends a signed invite email for one party.
 * Body includes unique ?party= deep link; never attaches the PDF.
 */
export async function sendPartyInviteEmail(input: {
  documentId: string
  creatorAddress: string
  partyId: string
  to: string
}): Promise<InviteSignerResult> {
  let doc
  try {
    doc = assertDocumentCreator(input.documentId, input.creatorAddress)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forbidden'
    const status =
      message === 'Document not found'
        ? 404
        : message.includes('Only the creator')
          ? 403
          : 400
    return { ok: false, status, error: message }
  }

  if (doc.status === 'locked') {
    return { ok: false, status: 400, error: 'This agreement is already sealed' }
  }

  let to: string
  try {
    const cleaned = sanitizeNotifyEmail(input.to)
    if (!cleaned) return { ok: false, status: 400, error: 'Valid recipient email required' }
    to = cleaned
  } catch {
    return { ok: false, status: 400, error: 'Invalid recipient email address' }
  }

  const party = getPartyById(input.partyId)
  if (!party || party.documentId !== doc.id) {
    return { ok: false, status: 404, error: 'Party not found on this agreement' }
  }
  if (!party.required) {
    return { ok: false, status: 400, error: 'This party is not a required signer' }
  }
  if (party.status === 'signed') {
    return { ok: false, status: 400, error: 'This person has already signed' }
  }

  if (!isResendSendEnabled()) {
    return {
      ok: false,
      status: 503,
      error:
        'Invite email is not enabled on this server yet (configure Resend: RESEND_API_KEY + RESEND_ENABLED).',
    }
  }

  const base = documentDeepLink(doc.slug)
  const link = `${base}${base.includes('?') ? '&' : '?'}party=${encodeURIComponent(party.id)}`
  // HTTPS bridge with openPay=1 — email clients often block nimiqpay:// schemes.
  // Client strips the flag, stashes the path, then launches Nimiq Pay with the full URL.
  const payHttpsBridge = `${link}${link.includes('?') ? '&' : '?'}openPay=1`
  // Native scheme (plain-text + clients that allow it), full invite path in url=.
  const payNativeLink = nimiqPayMiniAppDeepLink(link)
  const personName = party.displayName?.trim() || 'there'
  const organizerName = resolveOrganizerName(doc)
  const safePerson = escapeHtml(personName)
  const safeOrganizer = escapeHtml(organizerName)
  const safeTitle = escapeHtml(doc.title)
  // Header + footer use verilock-mark (tracked/deployed). Legacy verilock-logo* is gitignored → 404 on prod.
  const logoUrl = `${appPublicUrl()}/verilock-mark-180.png`
  const markUrl = `${appPublicUrl()}/verilock-mark-96.png`

  const walletNote = party.walletAddress
    ? `Sign with the Nimiq wallet ${party.walletAddress} (the address reserved for you on this agreement).`
    : 'Connect any Nimiq wallet you control, confirm you are the person named in the invite, and sign your fields on the PDF.'

  const subject = `${organizerName} has requested you sign “${doc.title}” on VeriLock`
  const text = [
    `Hi ${personName},`,
    '',
    `${organizerName} has requested you sign “${doc.title}” on VeriLock.`,
    '',
    'Open in your browser (Nimiq Hub login works here):',
    link,
    '',
    'Or open in the Nimiq Pay app (best on phone — installs Pay if needed via the site first):',
    payHttpsBridge,
    '',
    'Nimiq Pay direct link (if your mail app allows custom schemes):',
    payNativeLink,
    '',
    walletNote,
    '',
    'Important: VeriLock never hosts or emails the PDF. Use the exact PDF file the organizer shared with you, then open a link above to match the fingerprint and sign.',
    '',
    '—',
    'VeriLock · Sign together. Prove forever.',
    appPublicUrl(),
  ].join('\n')

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
          <tr>
            <td style="padding:28px 28px 12px;text-align:center;background:linear-gradient(180deg,#f0fdfa 0%,#ffffff 100%);">
              <img src="${logoUrl}" width="120" height="auto" alt="VeriLock" style="display:inline-block;max-width:140px;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;line-height:1.55;">
              <p style="margin:0 0 12px;font-size:16px;">Hi ${safePerson},</p>
              <p style="margin:0 0 16px;font-size:16px;">
                <strong>${safeOrganizer}</strong> has requested you sign <strong>${safeTitle}</strong> on VeriLock.
              </p>
              <p style="margin:0 0 10px;font-size:14px;color:#475569;text-align:center;">
                Choose how you want to open your personal signing link:
              </p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px;">
                <tr>
                  <td align="center" style="padding:0 0 10px;">
                    <a href="${link}"
                       style="display:inline-block;padding:14px 22px;background:#0d9488;color:#ffffff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">
                      Open in browser
                    </a>
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:0 0 8px;">
                    <a href="${payHttpsBridge}"
                       style="display:inline-block;padding:14px 22px;background:#ffffff;color:#0f766e;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;border:2px solid #0d9488;">
                      Open in Nimiq Pay
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;font-size:12px;color:#64748b;text-align:center;line-height:1.45;">
                <strong>Browser</strong> uses Nimiq Hub in Safari/Chrome.
                <strong>Nimiq Pay</strong> opens this agreement inside the Pay app (phone).
              </p>
              <p style="margin:0 0 12px;font-size:14px;color:#475569;">
                ${escapeHtml(walletNote)}
              </p>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">
                Or paste this personal link into your browser:
              </p>
              <p style="margin:0 0 20px;font-size:13px;word-break:break-all;">
                <a href="${link}" style="color:#0f766e;">${escapeHtml(link)}</a>
              </p>
              <div style="padding:14px 16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.45;">
                  <strong style="color:#0f172a;">Your PDF stays private.</strong>
                  VeriLock never hosts or emails the document file. Use the exact PDF the organizer shared with you, then open a link above to match its fingerprint and complete your fields.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;text-align:center;font-family:system-ui,sans-serif;">
              <img src="${markUrl}" width="36" height="36" alt="" style="display:inline-block;border:0;opacity:0.9;" />
              <p style="margin:10px 0 0;font-size:12px;color:#94a3b8;">
                VeriLock · Sign together. Prove forever.<br/>
                <a href="${appPublicUrl()}" style="color:#94a3b8;">${escapeHtml(appPublicUrl())}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()

  const result = await sendTransactionalEmail({ to, subject, text, html })

  if (result.ok) {
    console.log('[email] party-invite sent', {
      documentId: doc.id,
      partyId: party.id,
      to,
      id: result.id,
      organizer: organizerName,
    })
    return { ok: true, id: result.id, to, partyId: party.id }
  }

  if ('skipped' in result && result.skipped) {
    return {
      ok: false,
      status: 503,
      error: result.reason || 'Email sending is disabled',
    }
  }

  return {
    ok: false,
    status: 502,
    error: 'error' in result ? result.error : 'Failed to send invite email',
  }
}
