import type { BlogPost } from '../types'

const cover = '/blog/prepaid-credits-for-seals.jpg'

export const post: BlogPost = {
  slug: 'prepaid-credits-for-seals',
  title: 'Clearer Pricing and Prepaid Lock Credits',
  description:
    'One credit locks one document fingerprint on Nimiq. Buy packs with NIM or card, watch balance in the header, and lock on the blockchain without a last-minute wallet scramble.',
  date: '2026-07-10',
  tags: ['feature', 'pricing'],
  coverImage: cover,
  coverAlt:
    'Charcoal credit card and amber hexagonal payment icon on a signed contract, soft studio lighting',
  relatedSlugs: [
    'how-to-sign-pdf-with-blockchain',
    'wallet-scoped-agreements-history',
    'what-is-verilock',
  ],
  body: [
    {
      type: 'p',
      text: 'Locking still means publishing a permanent fingerprint of your PDF hash on Nimiq. Signing and verifying stay free. What we cleaned up is how you pay for that lock: a simple credit model, prepaid packs, and a quieter path at lock time so the last step is not a scramble for spare NIM.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Prepaid credit card resting on a signed contract',
      caption: 'Top up with NIM or buy fixed packs by card. One credit, one lock.',
    },
    {
      type: 'h2',
      text: 'What a credit is',
    },
    {
      type: 'p',
      text: 'One credit pays for one permanent on-chain lock of one document fingerprint. The same amount applies whether you spend a prepaid credit or pay the current credit value in NIM when you lock it on the blockchain. Fiat estimates on Pricing come from market data; the product truth is the NIM / credit figure shown there.',
    },
    {
      type: 'h2',
      text: 'How to buy and use credits',
    },
    {
      type: 'ul',
      items: [
        'Open Pricing while signed in with your Nimiq wallet.',
        'Choose a prepaid pack (typical sizes span small multi-lock packs up through larger ones).',
        'Pay with NIM from the wallet, or with card when card checkout is available.',
        'After purchase, the header can show your balance so focus stays on documents.',
        'At lock time, spend a credit or pay NIM for the current fee, depending on balance and flow.',
      ],
    },
    {
      type: 'p',
      text: 'Card checkout can mint credits when you return to the app even if a webhook is delayed. Statements include a VeriLock suffix so the charge is easy to spot later.',
    },
    {
      type: 'h2',
      text: 'Why prepaid helps',
    },
    {
      type: 'p',
      text: 'Multi-party agreements often stall at the last step when the creator still needs to pay the network fee. Credits let you fund locks ahead of time. Co-signers still only need a wallet to sign; they do not pay for the lock unless they are the party locking the hash.',
    },
    {
      type: 'note',
      text: 'Credits are for lock fees, not a subscription that changes who can verify. Anyone with the locked PDF can still re-hash and check the on-chain record without a credit balance.',
    },
    {
      type: 'h2',
      text: 'Promo and list price',
    },
    {
      type: 'p',
      text: 'Open Pricing for live pack options and fee numbers. Through the end of July, a permanent on-chain lock is 50 NIM, which is 95% off the 1000 NIM list price. The promo ends August 1. After that, use the current figures on Pricing, not this post\'s snapshot.',
    },
  ],
}
