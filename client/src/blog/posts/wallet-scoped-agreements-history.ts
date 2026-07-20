import type { BlogPost } from '../types'

const cover = '/blog/wallet-scoped-agreements-history.jpg'

export const post: BlogPost = {
  slug: 'wallet-scoped-agreements-history',
  title: 'Your Agreements, Scoped to Your Wallet',
  description:
    'Agreements history follows the Nimiq wallet you connect. Reopen in-progress work, jump to sealed docs, or start create without hunting old links.',
  date: '2026-07-09',
  tags: ['feature'],
  coverImage: cover,
  coverAlt:
    'Open manila folder stacked with signed paper agreements, soft blockchain network hexagons in the background',
  relatedSlugs: [
    'private-signatures-public-proof',
    'how-to-sign-pdf-with-blockchain',
    'prepaid-credits-for-seals',
  ],
  body: [
    {
      type: 'p',
      text: 'VeriLock does not use a separate username for document history. When you connect a Nimiq wallet, Agreements shows what that address created or signed. The list is a workspace for in-progress and sealed work, not a public directory of every file on the network.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Stack of translucent document cards',
      caption: 'History follows the address you signed in with.',
    },
    {
      type: 'h2',
      text: 'Where to open it',
    },
    {
      type: 'p',
      text: 'After login, open Agreements from the header, or from the account menu. You land on a full page of documents for that wallet: reopen a draft, continue signing, jump toward seal when the agreement is ready, or start Create & seal if the list is empty.',
    },
    {
      type: 'h2',
      text: 'What shows up',
    },
    {
      type: 'ul',
      items: [
        'Agreements you created (you are the party who fingerprinted the PDF and invited others).',
        'Agreements you co-signed after someone shared a link and the same PDF with you.',
        'Status cues such as in progress versus sealed, so you can tell what still needs signatures or a chain lock.',
        'Actions to open a document, prefer seal when you are allowed to, or remove work when the product rules allow cancel or delete.',
      ],
    },
    {
      type: 'h2',
      text: 'Wallet scope, not a cloud folder',
    },
    {
      type: 'p',
      text: 'The server stores agreement metadata and hashes so parties can resume. The PDF still never leaves the device. Sign out and the list leaves that browser session. Connect again with the same wallet to resume. Connect a different wallet and you see that address\'s history instead. There is no shared "company account" list unless every party uses the same wallet (they should not).',
    },
    {
      type: 'note',
      text: 'If a co-signer never opens the invite while logged in as their wallet, their address may not appear as a participant history entry the way you expect. Share the link and the exact PDF bytes; they still need to match the fingerprint before they can sign.',
    },
    {
      type: 'h2',
      text: 'Empty list',
    },
    {
      type: 'p',
      text: 'No rows yet usually means this wallet has not created or signed anything in VeriLock. Start Create & seal from Agreements or from the home path picker. If you expected a document, confirm you are on the same wallet that signed or created it, and that the agreement was not cancelled by the creator before the first signature.',
    },
    {
      type: 'p',
      text: 'Connect, open Agreements in the header, and keep work moving from one place. Through the end of July, a permanent Nimiq seal is 50 NIM (95% off the 1000 NIM list price). Promo ends August 1.',
    },
  ],
}
