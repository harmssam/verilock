import type { BlogPost } from '../types'

const cover = '/blog/wallet-scoped-agreements-history.jpg'

export const post: BlogPost = {
  slug: 'wallet-scoped-agreements-history',
  title: 'Your Agreements, Scoped to Your Wallet',
  description:
    'Open Agreements from the header for wallet-scoped history and jump back into a document journey.',
  date: '2026-07-09',
  tags: ['feature'],
  coverImage: cover,
  coverAlt: 'Open manila folder stacked with signed paper agreements, soft blockchain network hexagons in the background',
  relatedSlugs: [
    'private-signatures-public-proof',
    'how-to-sign-pdf-with-blockchain',
  ],
  body: [
    {
      type: 'p',
      text: 'After you connect, Agreements shows history scoped to your wallet. Reopen in-progress work, jump to a sealed document, or start new without hunting old links.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Stack of translucent document cards',
      caption: 'History follows the address you signed in with.',
    },
    {
      type: 'p',
      text: 'Sign out and the list leaves the session. Connect again with the same wallet to resume. Empty state? Start create from the same screen.',
    },
    {
      type: 'p',
      text: 'Connect and open Agreements in the header. Seal new work for 50 NIM through the end of July while the promo lasts.',
    },
  ],
}
