import type { BlogPost } from '../types'

const cover = '/blog/prepaid-credits-for-seals.jpg'

export const post: BlogPost = {
  slug: 'prepaid-credits-for-seals',
  title: 'Clearer Pricing and Prepaid Seal Credits',
  description:
    'Credit-first seal pricing, a cleaner pack picker, and prepaid credits so you can seal without juggling NIM at the last step.',
  date: '2026-07-10',
  tags: ['feature', 'pricing'],
  coverImage: cover,
  coverAlt: 'Charcoal credit card and amber hexagonal payment icon on a signed contract, soft studio lighting',
  relatedSlugs: [
    'how-to-sign-pdf-with-blockchain',
    'wallet-scoped-agreements-history',
  ],
  body: [
    {
      type: 'p',
      text: 'Sealing still means publishing a permanent fingerprint of your PDF hash on Nimiq. We simplified how that step is priced and paid: credits come first when you are signed in, the pack picker is quieter, and prepaid balance can cover a seal without a last-minute NIM dance.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Prepaid credit card resting on a signed contract',
      caption: 'Top up with NIM or buy fixed packs by card. One credit, one seal.',
    },
    {
      type: 'p',
      text: 'When a balance is available, the header can surface it so focus stays on documents. Card checkout can mint credits on return even if a webhook is delayed. Statements include a VeriLock suffix so the charge is easy to spot.',
    },
    {
      type: 'p',
      text: 'Open Pricing for live pack options and fee numbers. Through July a seal is 50 NIM (95% off the 1000 NIM list). Promo ends August 1.',
    },
  ],
}
