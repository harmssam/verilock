import type { BlogPost } from '../types'

const cover = '/blog/esignature-pricing-report-2026.jpg'

export const post: BlogPost = {
  slug: 'esignature-pricing-report-2026',
  title: 'eSignature Pricing Report 2026: What You Actually Pay Per Signature',
  description:
    'Side-by-side pricing across DocuSign, Adobe Sign, PandaDoc, Dropbox Sign, SignNow, and VeriLock. Sign free on VeriLock; optional lock is pay-per-use. Subscription math vs real cost per document.',
  date: '2026-07-25',
  tags: ['pricing'],
  coverImage: cover,
  coverAlt:
    'Top-down light desk: tall stack of subscription invoices, one thin pay-per-use receipt, pocket calculator, mint sticky note, and teal pen on a comparison sheet',
  relatedSlugs: [
    'docusign-vs-hellosign-vs-verilock',
    'prepaid-credits-for-seals',
    'what-is-verilock',
  ],
  body: [
    {
      type: 'p',
      text: 'E-signature pricing looks simple: $15 to $60 per user per month. But the sticker price hides two things. First, most entry-level plans strip core features -- templates, branding, multi-party signing -- forcing an upgrade. Second, the monthly fee masks what you actually pay per document.',
    },
    {
      type: 'h2',
      text: 'The real cost per signature',
    },
    {
      type: 'p',
      text: 'If you sign five documents a month on DocuSign Standard at $45, each signature costs you $9. On Adobe Sign Standard at $12.99, it is $2.60 each. The math shifts sharply at higher volumes, but the average user signs between five and eight documents monthly -- nowhere near the break-even point where subscriptions pull ahead.',
    },
    {
      type: 'p',
      text: 'We built a full pricing report that lays all of this out: every major provider, every tier, and the cost per document at three usage levels. It covers the hidden costs too -- additional users, branding removal, API access -- that vendors bury in higher tiers.',
      link: { url: '/esignature-pricing', label: 'See the full eSignature Pricing Report →' },
    },
    {
      type: 'h2',
      text: 'Where VeriLock fits',
    },
    {
      type: 'p',
      text: 'VeriLock is free for multi-party signing. The paid piece is optional: a permanent on-chain lock for about $0.41 (full list fee as of July 25, 2026), no subscription, no feature tiers. If you lock eight documents a month -- a typical workload -- that is about $39 a year. Sign-only stays $0. The cheapest subscription alternative still costs more than double the lock path.',
    },
    {
      type: 'p',
      text: 'The report also covers what happens to your file during signing. Every subscription service uploads your PDF to their servers. VeriLock fingerprints locally. The file never leaves your device.',
    },
    {
      type: 'note',
      text: 'All pricing data was collected July 25, 2026 from official provider pages (VeriLock from verilock.online/pricing). We will refresh the report quarterly so the numbers stay current.',
    },
  ],
}
