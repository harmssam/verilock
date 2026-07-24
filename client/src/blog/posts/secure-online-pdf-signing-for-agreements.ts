import type { BlogPost } from '../types'

const cover = '/blog/secure-online-pdf-signing-for-agreements.jpg'

export const post: BlogPost = {
  slug: 'secure-online-pdf-signing-for-agreements',
  title: 'Secure Online PDF Signing for Agreements',
  description:
    'Sign PDF agreements online without uploading the file. Local fingerprints, multi-party wallets, permanent on-chain proof.',
  date: '2026-07-07',
  tags: ['guide', 'privacy'],
  coverImage: cover,
  coverAlt: 'Printed agreement beside phone showing verification mark on warm gray desk',
  relatedSlugs: [
    'is-this-the-same-file',
    'how-to-sign-pdf-with-blockchain',
    'private-signatures-public-proof',
  ],
  body: [
    {
      type: 'p',
      text: 'Most signing tools ask you to upload the full PDF so a platform can host it. Convenient, but your agreement text lives on someone else\'s servers.',
    },
    {
      type: 'p',
      text: 'VeriLock fingerprints the PDF in the browser, collects wallet signatures, and locks a compact hash on Nimiq. The PDF stays on each device. The chain holds proof, not the contract wording.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Private document with a padlock of light',
      caption: 'Private by design: the file stays with you. The proof can be public.',
    },
    {
      type: 'h2',
      text: 'What security means here',
    },
    {
      type: 'ul',
      items: [
        'Did every party review the same file?',
        'Can someone rewrite a page after signatures?',
        'Can a third party check integrity without trusting one vendor database?',
      ],
    },
    {
      type: 'p',
      text: 'Local SHA-256 fingerprinting, multi-party signing against that fingerprint, and an on-chain lock answer those questions. Change the file, and the hash will not match.',
    },
    {
      type: 'h2',
      text: 'Private file, public proof',
    },
    {
      type: 'p',
      text: 'VeriLock stores workflow metadata (title, fingerprints, parties, lock details). The full PDF is never uploaded. When you lock it on the blockchain, a Nimiq transaction anchors the fingerprint permanently.',
    },
    {
      type: 'note',
      text: 'VeriLock helps you sign together and prove the locked fingerprint later. It is not legal advice about enforceability in your jurisdiction.',
    },
    {
      type: 'p',
      text: 'Sign today. Prove forever. Locks are 50 NIM through July (95% off list), then the standard fee returns August 1.',
    },
  ],
}
