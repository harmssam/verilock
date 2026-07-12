import type { BlogPost } from '../types'

const cover = '/blog/prepaid-credits-for-seals.jpg'

export const post: BlogPost = {
  slug: 'prepaid-credits-for-seals',
  title: 'Prepaid Credits for Permanent Seals',
  description:
    'Buy seal credits with NIM or card packs, then seal fingerprints without juggling NIM at the last step.',
  date: '2026-07-10',
  tags: ['feature', 'pricing'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of glowing credit tokens beside a document seal',
  relatedSlugs: [
    'clearer-pricing-for-permanent-seals',
    'how-to-sign-pdf-with-blockchain',
  ],
  body: [
    {
      type: 'p',
      text: 'Sealing still means publishing a permanent fingerprint on Nimiq. Prepaid credits make that step smoother when you do not want to handle NIM at seal time.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Glowing credit tokens near a seal of light',
      caption: 'Top up with NIM or buy fixed packs by card. One credit, one seal.',
    },
    {
      type: 'p',
      text: 'Balance shows in the header when signed in. Card checkout can mint on return even if a webhook is delayed. Statements include a VeriLock suffix so the charge is easy to recognize.',
    },
    {
      type: 'p',
      text: 'See packs on verilock.online/pricing, then seal when ready.',
    },
  ],
}
