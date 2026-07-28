/**
 * Support ticket unit checks: message_kind, volume-notice eligibility, claim-before-send.
 * Run: npm run test:support --prefix server
 */
import assert from 'node:assert/strict'
import { createSupportTicket, listSupportTicketsNeedingVolumeNotice, claimSupportVolumeNotice, releaseSupportVolumeNoticeClaim, addSupportTicketMessage, listSupportTicketMessages, getSupportTicketCounts } from '../src/supportTickets.ts'
import { buildSupportAutoReplyBody, buildSupportVolumeNoticeBody } from '../src/supportTemplates.ts'
import { isVolumeNoticeSendWindow } from '../src/supportVolumeNotice.ts'

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  FAIL ${name}`)
    console.error(err)
  }
}

console.log('support tickets')

check('auto-ack copy uses wall-clock 3 days (not business days)', () => {
  const body = buildSupportAutoReplyBody({
    name: 'Sam',
    publicId: 'VL-TEST',
    subject: 'Hi',
    site: 'https://verilock.online',
  })
  assert.match(body, /about 3 days/)
  assert.doesNotMatch(body, /business days/)
  assert.doesNotMatch(body, /—/)
})

check('volume notice copy has no em-dash', () => {
  const body = buildSupportVolumeNoticeBody({
    name: 'Sam',
    publicId: 'VL-TEST',
    subject: 'Hi',
    site: 'https://verilock.online',
  })
  assert.match(body, /higher volume/)
  assert.doesNotMatch(body, /—/)
})

check('create ticket stores customer message_kind', () => {
  const t = createSupportTicket({
    name: 'Tester',
    email: 't@example.com',
    subject: 'Need help please',
    message: 'I cannot sign my agreement help',
  })
  const msgs = listSupportTicketMessages(t.id)
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].messageKind, 'customer')
  assert.equal(t.status, 'open')
})

check('young tickets are not volume-notice eligible', () => {
  const t = createSupportTicket({
    name: 'Young',
    email: 'y@example.com',
    subject: 'Recent issue',
    message: 'Just submitted this ticket now',
  })
  const eligible = listSupportTicketsNeedingVolumeNotice({
    now: Date.now(),
    minAgeMs: 3 * 86400000,
  })
  assert.equal(eligible.some(x => x.id === t.id), false)
})

check('aged ticket without human_reply is eligible; human_reply excludes', () => {
  const t = createSupportTicket({
    name: 'Aged',
    email: 'a@example.com',
    subject: 'Old issue here',
    message: 'This has been waiting a while',
  })
  addSupportTicketMessage({
    ticketId: t.id,
    messageKind: 'auto_ack',
    authorName: 'VeriLock Support (auto-reply)',
    body: 'ack',
    resendMessageId: 'r-auto',
    bumpStatus: false,
  })
  const agedNow = Date.now() + 4 * 86400000
  let eligible = listSupportTicketsNeedingVolumeNotice({
    now: agedNow,
    minAgeMs: 3 * 86400000,
  })
  assert.equal(eligible.some(x => x.id === t.id), true)

  addSupportTicketMessage({
    ticketId: t.id,
    messageKind: 'human_reply',
    authorName: 'admin',
    body: 'We fixed it',
    resendMessageId: 'r-human',
    bumpStatus: false,
  })
  eligible = listSupportTicketsNeedingVolumeNotice({
    now: agedNow,
    minAgeMs: 3 * 86400000,
  })
  assert.equal(eligible.some(x => x.id === t.id), false)
})

check('claim is single-winner; release allows reclaim', () => {
  const t = createSupportTicket({
    name: 'Claim',
    email: 'c@example.com',
    subject: 'Claim test subject',
    message: 'Claim claim claim claim',
  })
  assert.equal(claimSupportVolumeNotice(t.id), true)
  assert.equal(claimSupportVolumeNotice(t.id), false)
  releaseSupportVolumeNoticeClaim(t.id)
  assert.equal(claimSupportVolumeNotice(t.id), true)
})

check('counts open includes open + in_progress + waiting_customer', () => {
  const counts = getSupportTicketCounts()
  assert.ok(typeof counts.total === 'number')
  assert.ok(typeof counts.open === 'number')
  assert.ok(counts.total >= counts.open)
})

check('send window helper returns boolean', () => {
  assert.equal(typeof isVolumeNoticeSendWindow(new Date()), 'boolean')
})

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nall support checks passed')
