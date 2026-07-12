import type { BlogPost } from '../types'

const cover = '/blog/clearer-pricing-for-permanent-seals.jpg'

export const post: BlogPost = {
  slug: 'clearer-pricing-for-permanent-seals',
  title: 'Clearer Pricing for Permanent Seals',
  description:
    'Credit-first pricing, a cleaner pack picker, and plainer copy about permanent Nimiq seals.',
  date: '2026-07-10',
  tags: ['feature', 'pricing'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of a simple luminous seal for clear pricing',
  relatedSlugs: [
    'prepaid-credits-for-seals',
    'journey-edition-is-live',
  ],
  body: [
    {
      type: 'p',
      text: 'We simplified how pricing presents permanent seals. Credits come first when you are signed in, with a cleaner pack picker and less fee-widget noise.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Single clean luminous seal stamp',
      caption: 'One seal is a permanent on-chain fingerprint of your PDF hash.',
    },
    {
      type: 'p',
      text: 'Buy credits ahead of time or pay with NIM when you prefer. When a balance is available, the header can surface it so focus stays on sealing documents.',
    },
    {
      type: 'p',
      text: 'Open Pricing for live numbers. Through July a seal is 50 NIM (95% off the 1000 NIM list). Promo ends August 1.',
    },
  ],
}
