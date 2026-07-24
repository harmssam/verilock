import {
  getDocumentById,
  getDocumentNotifyEmail,
  markReadyToSealEmailSent,
} from '../db.js'
import { agreementsDeepLink, sendTransactionalEmail } from './resend.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Fire-and-forget: notify creator that all signatures are in.
 * No-ops when send is disabled, no email on file, or already sent.
 */
export async function notifyCreatorReadyToSeal(documentId: string): Promise<void> {
  try {
    const doc = getDocumentById(documentId)
    if (!doc) return
    if (doc.status !== 'ready_to_lock' && doc.status !== 'locking') return

    const email = getDocumentNotifyEmail(documentId)
    if (!email) {
      console.log('[email] ready-to-seal skipped: no creator email', { documentId: doc.id })
      return
    }

    // My Agreements (not /d/…) — document deep links open the “I was invited” signer flow.
    const link = agreementsDeepLink()
    const subject = `All signed — lock "${doc.title}" on VeriLock`
    const text = [
      'Hi,',
      '',
      `Everyone has signed "${doc.title}" on VeriLock.`,
      'Open My agreements below, then lock the fingerprint on the Nimiq blockchain.',
      '',
      link,
      '',
      'VeriLock never hosts your PDF — keep your local copy.',
      '',
      '—',
      'VeriLock · Sign today. Prove forever.',
    ].join('\n')

    const safeTitle = escapeHtml(doc.title)
    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f172a;max-width:560px">
        <p>Hi,</p>
        <p>Everyone has signed <strong>${safeTitle}</strong> on VeriLock.</p>
        <p>Open <strong>My agreements</strong> and complete the on-chain lock when you are ready:</p>
        <p><a href="${link}" style="display:inline-block;padding:12px 18px;background:#0d9488;color:#fff;text-decoration:none;border-radius:999px;font-weight:600">Open My agreements</a></p>
        <p style="font-size:14px;color:#475569">Or paste this link:<br/><a href="${link}">${link}</a></p>
        <p style="font-size:13px;color:#64748b">VeriLock never hosts your PDF — keep your local copy.</p>
        <p style="font-size:12px;color:#94a3b8">VeriLock · Sign today. Prove forever.</p>
      </div>
    `.trim()

    const result = await sendTransactionalEmail({ to: email, subject, text, html })

    if (result.ok) {
      markReadyToSealEmailSent(documentId)
      console.log('[email] ready-to-seal sent', { documentId: doc.id, id: result.id })
      return
    }

    if ('skipped' in result && result.skipped) {
      console.log('[email] ready-to-seal skipped', { documentId: doc.id, reason: result.reason })
      return
    }

    console.error('[email] ready-to-seal failed', {
      documentId: doc.id,
      error: 'error' in result ? result.error : 'unknown',
    })
  } catch (err) {
    console.error('[email] ready-to-seal unexpected error', err)
  }
}
