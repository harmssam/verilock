import type { BlogPost } from '../types'

const cover = '/blog/journey-edition-is-live.jpg'

export const post: BlogPost = {
  slug: 'journey-edition-is-live',
  title: 'Journey Edition Is Live',
  description:
    'Production UI is now the document journey: clearer paths for creators, co-signers, and verifiers.',
  date: '2026-07-09',
  tags: ['feature'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of a multi-step journey path ending in a seal',
  relatedSlugs: [
    'wallet-scoped-agreements-history',
    'how-to-sign-pdf-with-blockchain',
  ],
  body: [
    {
      type: 'p',
      text: 'VeriLock\'s production interface is Journey Edition. Pick a role and move through a focused path: create and seal, join as a co-signer, or verify.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Glowing stage path leading to a lock seal',
      caption: 'Stage rail and action dock keep the next step obvious.',
    },
    {
      type: 'p',
      text: 'Same product under the hood: local fingerprinting, multi-party Nimiq signatures, permanent seals. The journey layout just makes it easier on phone and desktop, including Nimiq Pay.',
    },
    {
      type: 'p',
      text: 'Journey is the live default. Pick a path above, and when you seal, July pricing is 50 NIM for a permanent record (95% off; ends August 1).',
    },
  ],
}
