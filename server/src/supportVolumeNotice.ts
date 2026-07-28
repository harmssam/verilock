/**
 * Daily end-of-window job: one-time high-volume notice when a ticket still has
 * no human_reply after ~3 calendar days (wall-clock; matches customer copy).
 *
 * Env (optional):
 * - SUPPORT_VOLUME_NOTICE_ENABLED=false to disable
 * - SUPPORT_VOLUME_NOTICE_DAYS=3
 * - SUPPORT_VOLUME_NOTICE_TZ=America/Edmonton
 * - SUPPORT_VOLUME_NOTICE_HOUR_START=16
 * - SUPPORT_VOLUME_NOTICE_HOUR_END=18
 */
import { sendCustomerTicketEmail } from './supportOutbound.js'
import { buildSupportVolumeNoticeBody } from './supportTemplates.js'
import {
  claimSupportVolumeNotice,
  listSupportTicketsNeedingVolumeNotice,
  releaseSupportVolumeNoticeClaim,
  type SupportTicketRecord,
} from './supportTickets.js'
import { isResendSendEnabled } from './email/config.js'

const TICK_MS = 30 * 60 * 1000
const DEFAULT_DAYS = 3
const DEFAULT_TZ = 'America/Edmonton'
const DEFAULT_HOUR_START = 16
const DEFAULT_HOUR_END = 18

function truthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function isVolumeNoticeEnabled(): boolean {
  const raw = process.env.SUPPORT_VOLUME_NOTICE_ENABLED
  if (raw != null && raw !== '') return truthy(raw)
  return true
}

function minAgeMs(): number {
  const days = Number(process.env.SUPPORT_VOLUME_NOTICE_DAYS ?? DEFAULT_DAYS)
  const d = Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS
  return d * 24 * 60 * 60 * 1000
}

function localHourInTz(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(now)
    const hourPart = parts.find(p => p.type === 'hour')?.value
    const hour = hourPart != null ? Number(hourPart) : NaN
    return Number.isFinite(hour) ? hour : null
  } catch {
    return null
  }
}

/** True near end of the configured local day (default 16:00–18:59 America/Edmonton). */
export function isVolumeNoticeSendWindow(now = new Date()): boolean {
  const tz = process.env.SUPPORT_VOLUME_NOTICE_TZ?.trim() || DEFAULT_TZ
  const start = Number(process.env.SUPPORT_VOLUME_NOTICE_HOUR_START ?? DEFAULT_HOUR_START)
  const end = Number(process.env.SUPPORT_VOLUME_NOTICE_HOUR_END ?? DEFAULT_HOUR_END)
  const hourStart = Number.isFinite(start) ? start : DEFAULT_HOUR_START
  const hourEnd = Number.isFinite(end) ? end : DEFAULT_HOUR_END
  const hour = localHourInTz(now, tz)
  if (hour == null) return false
  if (hourStart <= hourEnd) return hour >= hourStart && hour <= hourEnd
  return hour >= hourStart || hour <= hourEnd
}

async function sendVolumeNotice(ticket: SupportTicketRecord): Promise<boolean> {
  // Claim first so concurrent workers / crashes cannot double-send.
  if (!claimSupportVolumeNotice(ticket.id)) {
    return false
  }

  if (!isResendSendEnabled()) {
    releaseSupportVolumeNoticeClaim(ticket.id)
    console.log('[support] volume notice skipped (email send disabled)', {
      publicId: ticket.publicId,
    })
    return false
  }

  const body = buildSupportVolumeNoticeBody({
    name: ticket.name,
    publicId: ticket.publicId,
    subject: ticket.subject,
    site: '',
  })
  const mailSubject = `Still working on your request [${ticket.publicId}]`

  const result = await sendCustomerTicketEmail({
    ticket,
    subject: mailSubject,
    body,
    messageKind: 'volume_notice',
    authorName: 'VeriLock Support (volume notice)',
    bumpStatus: false,
  })

  if (!result.ok) {
    // Allow retry on a later pass.
    releaseSupportVolumeNoticeClaim(ticket.id)
    console.error('[support] volume notice email failed', {
      publicId: ticket.publicId,
      error: result.error,
    })
    return false
  }

  console.log('[support] volume notice emailed', {
    id: result.resendId,
    publicId: ticket.publicId,
    to: ticket.email,
  })
  return true
}

export async function runSupportVolumeNoticePass(now = new Date()): Promise<{
  considered: number
  sent: number
  skippedWindow: boolean
  skippedDisabled: boolean
}> {
  if (!isVolumeNoticeEnabled()) {
    return { considered: 0, sent: 0, skippedWindow: false, skippedDisabled: true }
  }
  if (!isVolumeNoticeSendWindow(now)) {
    return { considered: 0, sent: 0, skippedWindow: true, skippedDisabled: false }
  }

  const tickets = listSupportTicketsNeedingVolumeNotice({
    now: now.getTime(),
    minAgeMs: minAgeMs(),
    limit: 50,
  })

  let sent = 0
  for (const ticket of tickets) {
    try {
      const ok = await sendVolumeNotice(ticket)
      if (ok) sent += 1
    } catch (err) {
      releaseSupportVolumeNoticeClaim(ticket.id)
      console.error('[support] volume notice error', {
        publicId: ticket.publicId,
        err,
      })
    }
  }

  if (tickets.length > 0) {
    console.log('[support] volume notice pass', {
      considered: tickets.length,
      sent,
    })
  }

  return {
    considered: tickets.length,
    sent,
    skippedWindow: false,
    skippedDisabled: false,
  }
}

export function startSupportVolumeNoticeWorker(): void {
  if (!isVolumeNoticeEnabled()) {
    console.log('[support] volume notice worker disabled')
    return
  }

  const tz = process.env.SUPPORT_VOLUME_NOTICE_TZ?.trim() || DEFAULT_TZ
  const start = process.env.SUPPORT_VOLUME_NOTICE_HOUR_START ?? String(DEFAULT_HOUR_START)
  const end = process.env.SUPPORT_VOLUME_NOTICE_HOUR_END ?? String(DEFAULT_HOUR_END)
  const days = process.env.SUPPORT_VOLUME_NOTICE_DAYS ?? String(DEFAULT_DAYS)

  console.log(
    `[support] volume notice worker: every ${TICK_MS / 60000}m, age>=${days}d wall-clock, window ${start}-${end}h ${tz}`,
  )

  const run = () => {
    void runSupportVolumeNoticePass().catch(err => {
      console.error('[support] volume notice pass failed', err)
    })
  }

  setTimeout(run, 45_000)
  const timer = setInterval(run, TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
}
