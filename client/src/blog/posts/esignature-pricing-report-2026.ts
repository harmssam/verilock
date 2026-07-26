import type { BlogPost } from '../types'

const cover = '/blog/esignature-pricing-report.svg'

export const post: BlogPost = {
  slug: 'esignature-pricing-report-2026',
  title: 'eSignature Pricing Report 2026: What You Actually Pay Per Signature',
  description:
    'Side-by-side pricing across DocuSign, Adobe Sign, PandaDoc, Dropbox Sign, SignNow, and VeriLock. Subscription plans hide the real cost — here is the math.',
  date: '2026-07-25',
  tags: ['pricing'],
  coverImage: cover,
  coverAlt: 'A printed pricing comparison table on a clean desk with a pen resting beside it, soft daylight',
  relatedSlugs: [
    'docusign-vs-hellosign-vs-verilock',
    'prepaid-credits-for-seals',
    'what-is-verilock',
  ],
  body: [
    {
      type: 'p',
      text: 'e-signature pricing looks simple: $15 to $60 per user per month. But the sticker price hides two things. First, most entry-level plans strip core features — templates, branding, multi-party signing — forcing an upgrade. Second, the monthly fee masks what you actually pay per document.',
    },
    {
      type: 'h2',
      text: 'The real cost per signature',
    },
    {
      type: 'p',
      text: 'If you sign five documents a month on DocuSign Standard at $45, each signature costs you $9. On Adobe Sign Standard at $12.99, it is $2.60 each. The math shifts sharply at higher volumes, but the average user signs between five and eight documents monthly — nowhere near the break-even point where subscriptions pull ahead.',
    },
    {
      type: 'p',
      text: 'We built a full pricing report that lays all of this out: every major provider, every tier, and the cost per document at three usage levels. It covers the hidden costs too — additional users, branding removal, API access — that vendors bury in higher tiers.',
    },
    {
      type: 'h2',
      text: 'Where VeriLock fits',
    },
    {
      type: 'p',
      text: 'VeriLock is the only consumer-facing pay-per-use option with a full signing UI. $0.49 per document, no subscription, no feature tiers. At eight documents a month — a typical workload — that is $47 a year. The cheapest subscription alternative costs more than double.',
    },
    {
      type: 'p',
      text: 'The report also covers what happens to your file during signing. Every subscription service uploads your PDF to their servers. VeriLock fingerprints locally. The file never leaves your device.',
    },
    {
      type: 'note',
      text: 'All pricing data was collected July 25, 2026 from official provider pages. We will refresh the report quarterly so the numbers stay current.',
    },
  ],
}
