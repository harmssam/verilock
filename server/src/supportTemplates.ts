/**
 * Canned support reply templates for the admin ticket queue.
 * Placeholders: {{name}}, {{publicId}}, {{subject}}, {{site}}
 */
import { getSupportAutoAckBody } from './adminSettings.js'
import { SUPPORT_AUTO_ACK_DEFAULT_BODY } from './supportAutoAckDefault.js'

export interface SupportReplyTemplate {
  id: string
  label: string
  /** Short group for UI (wallet | lock | credits | general) */
  category: string
  /** Plain-text body (email + ticket thread). */
  body: string
}

/** Used for automatic email on contact-form submit (not listed as a manual insert). */
export const SUPPORT_AUTO_ACK_TEMPLATE: SupportReplyTemplate = {
  id: 'auto-ack',
  label: 'Auto acknowledgment',
  category: 'general',
  body: SUPPORT_AUTO_ACK_DEFAULT_BODY,
}

/**
 * Sent once near end of day when a ticket still has no human reply after ~3 days
 * (wall-clock, same clock as the auto-ack promise).
 */
export const SUPPORT_VOLUME_NOTICE_TEMPLATE: SupportReplyTemplate = {
  id: 'volume-notice',
  label: 'High volume follow-up',
  category: 'general',
  body: `Hi {{name}},

We are still working through a higher volume of requests than usual and have not been able to reply to your message yet (ticket {{publicId}}).

We have not forgotten about you. A member of the team will follow up as soon as we can. Thank you for your patience.

- VeriLock Support`,
}

export const SUPPORT_REPLY_TEMPLATES: SupportReplyTemplate[] = [
  {
    id: 'ack-received',
    label: 'We received your message',
    category: 'general',
    body: `Hi {{name}},

Thanks for contacting VeriLock. We received your message (ticket {{publicId}}) and will respond within about 3 days.

- VeriLock Support`,
  },
  {
    id: 'nimiq-wallet',
    label: 'Nimiq wallet / connect',
    category: 'wallet',
    body: `Hi {{name}},

VeriLock uses a Nimiq wallet (via Nimiq Hub) as the signer identity - there is no VeriLock password for signing.

Quick checks:
1. Open the agreement link on the same device where you can complete Hub login.
2. Use the wallet that was invited / claimed for your party slot (the address on the agreement must match).
3. If the browser blocked a popup, allow popups for verilock.online and try Connect again.
4. On mobile, use the in-app flow or QR handoff from the agreement rather than a partial browser session.

If it still fails, reply with: browser (or app), whether you created or were invited, and the agreement link (/d/…). Ticket: {{publicId}}.

- VeriLock Support`,
  },
  {
    id: 'wallet-mismatch',
    label: 'Wallet does not match slot',
    category: 'wallet',
    body: `Hi {{name}},

The signature did not go through because the connected wallet does not match the party slot on this agreement.

Each required party must sign with the wallet that claimed (or was assigned to) that slot. Free multi-party signing is wallet-bound so the audit trail stays attributable.

What to do:
• Connect the correct Nimiq address for your slot, then try Sign again.
• If you were invited by email, open the personal invite link from that email first, then connect.
• If the wrong person claimed a slot, the creator may need to adjust the roster (or start a new agreement) before you can complete.

Ticket: {{publicId}}. Reply if you need help identifying which address is expected.

- VeriLock Support`,
  },
  {
    id: 'how-lock-works',
    label: 'Free sign vs permanent lock',
    category: 'lock',
    body: `Hi {{name}},

Here is how VeriLock separates free signing from permanent proof:

• Free multi-party signing - parties connect wallets and sign. Progress lives on the agreement record; we never upload your PDF.
• Optional permanent lock - when everyone required has signed, the creator can lock a hash-based proof on-chain (credits / NIM). That step is permanent by design.
• The file stays local - only hashes, signatures, placements, and chain pointers are stored with us.

To lock: open the agreement as creator → complete signatures → use the lock / seal step. If lock is unavailable, check that all required parties signed and that your credit or NIM balance covers the lock.

Ticket: {{publicId}}.

- VeriLock Support`,
  },
  {
    id: 'lock-failed',
    label: 'Lock / seal failed',
    category: 'lock',
    body: `Hi {{name}},

Sorry the lock did not complete. Common causes:

1. Not all required parties have signed yet.
2. Insufficient credits or NIM for the seal price at that moment.
3. Network / wallet confirmation was cancelled or timed out.
4. The agreement was cancelled or already locked.

What to try: refresh the agreement, confirm every party shows signed, check balance (credits or NIM), then run lock again. Keep the same file you fingerprinted when creating the agreement - a different PDF will not match.

Reply with the agreement link (/d/…) and roughly when you tried to lock (ticket {{publicId}}) and we will dig in.

- VeriLock Support`,
  },
  {
    id: 'credits',
    label: 'Credits & payment',
    category: 'credits',
    body: `Hi {{name}},

Credits are used for permanent on-chain locks (optional after free signing). Free multi-party signing does not require credits.

To add credits:
• In the product, open the credits / top-up flow (Stripe card or NIM where enabled).
• After payment confirms, balance updates on your wallet session - refresh if it still shows zero.
• AppSumo or promo codes: redeem from the product redeem flow if you have a code.

If you were charged but credits did not appear, reply with the approximate time, payment method (card / NIM), and the wallet address you used. Ticket: {{publicId}}.

- VeriLock Support`,
  },
  {
    id: 'invite-email',
    label: 'Invite / open share link',
    category: 'general',
    body: `Hi {{name}},

Co-signers can join in two ways:

• Personal email invite - use the link in the email (best: matches the intended party).
• Open share link - anyone with the link can open the agreement; the creator still controls the roster.

We never email the PDF. The file is shared out-of-band; VeriLock only stores the fingerprint and signing state.

If an invite looks expired or the wrong person opened the link, the creator can send a fresh invite or share link from the agreement. Ticket: {{publicId}}.

- VeriLock Support`,
  },
  {
    id: 're-verify',
    label: 'Verify a sealed document',
    category: 'lock',
    body: `Hi {{name}},

To verify a sealed agreement:

1. Keep the same file that was fingerprinted when the agreement was created.
2. Use Verify on verilock.online (or the offline companion) and drop the file so the hash is computed locally.
3. A match returns lock status, timestamps, and the on-chain pointer when locked.

We never need you to upload the PDF to support. If verify does not match, the file may differ by even one byte (export, edit, or a different revision). Ticket: {{publicId}}.

- VeriLock Support`,
  },
]

export function listSupportReplyTemplates(): SupportReplyTemplate[] {
  return SUPPORT_REPLY_TEMPLATES.map(t => ({ ...t }))
}

export function getSupportReplyTemplate(id: string): SupportReplyTemplate | null {
  return SUPPORT_REPLY_TEMPLATES.find(t => t.id === id) ?? null
}

export function renderSupportTemplate(
  body: string,
  vars: { name?: string; publicId?: string; subject?: string; site?: string },
): string {
  const map: Record<string, string> = {
    name: (vars.name ?? '').trim() || 'there',
    publicId: (vars.publicId ?? '').trim() || '-',
    subject: (vars.subject ?? '').trim() || 'your request',
    site: (vars.site ?? '').trim() || 'https://verilock.online',
  }
  return body.replace(/\{\{\s*(name|publicId|subject|site)\s*\}\}/g, (_, key: string) => {
    return map[key] ?? ''
  })
}

/** Customer-facing auto-reply after contact form submit (uses admin override when set). */
export function buildSupportAutoReplyBody(vars: {
  name: string
  publicId: string
  subject: string
  site: string
}): string {
  return renderSupportTemplate(getSupportAutoAckBody().body, vars)
}

/** Customer-facing 3-day high-volume follow-up. */
export function buildSupportVolumeNoticeBody(vars: {
  name: string
  publicId: string
  subject: string
  site: string
}): string {
  return renderSupportTemplate(SUPPORT_VOLUME_NOTICE_TEMPLATE.body, vars)
}
