/**
 * Optional email when multi-tx data archive finishes on Nimiq.
 * Fire-and-forget from the archive endpoint after success.
 */
import { getDocumentById } from '../db.js'
import { agreementsDeepLink, sendTransactionalEmail } from './resend.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function notifyDataArchiveComplete(input: {
  documentId: string
  to: string
  frameCount?: number
  creditsCharged?: number
}): Promise<void> {
  try {
    const doc = getDocumentById(input.documentId)
    const title = doc?.title?.trim() || 'your agreement'
    const link = agreementsDeepLink()
    const subject = `Data stored on the Nimiq blockchain — "${title}"`
    const text = [
      'Hi,',
      '',
      `Signatures and field data for "${title}" are now stored permanently on the Nimiq blockchain.`,
      '',
      'Open My agreements anytime to review the status:',
      link,
      '',
      'VeriLock never hosts your PDF — keep your local copy.',
      '',
      '—',
      'VeriLock · Sign today. Prove forever.',
    ].join('\n')

    const safeTitle = escapeHtml(title)
    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:560px">
        <p>Hi,</p>
        <p>Signatures and field data for <strong>${safeTitle}</strong> are now stored permanently on the <strong>Nimiq blockchain</strong>.</p>
        <p>Open <strong>My agreements</strong> anytime to review:</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#0d9488;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">Open My agreements</a></p>
        <p style="font-size:14px;color:#475569">Or paste this link:<br/><a href="${link}">${link}</a></p>
        <p style="font-size:13px;color:#64748b">VeriLock never hosts your PDF — keep your local copy.</p>
        <p style="font-size:12px;color:#94a3b8">VeriLock · Sign today. Prove forever.</p>
      </div>
    `.trim()

    const result = await sendTransactionalEmail({
      to: input.to,
      subject,
      text,
      html,
    })

    if (result.ok) {
      console.log('[email] data-archive-complete sent', {
        documentId: input.documentId,
        id: result.id,
        frames: input.frameCount,
        credits: input.creditsCharged,
      })
      return
    }
    if ('skipped' in result && result.skipped) {
      console.log('[email] data-archive-complete skipped', {
        documentId: input.documentId,
        reason: result.reason,
      })
      return
    }
    console.error('[email] data-archive-complete failed', {
      documentId: input.documentId,
      error: 'error' in result ? result.error : 'unknown',
    })
  } catch (err) {
    console.error('[email] data-archive-complete unexpected error', err)
  }
}
