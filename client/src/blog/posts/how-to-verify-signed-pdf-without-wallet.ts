import type { BlogPost } from '../types'

const cover = '/blog/how-to-verify-signed-pdf-without-a-wallet.jpg'

export const post: BlogPost = {
  slug: 'how-to-verify-signed-pdf-without-a-wallet',
  title: 'How to Verify a Signed PDF Without a Wallet',
  description:
    'Check a sealed VeriLock agreement by fingerprinting a PDF in the browser. No wallet for basic integrity.',
  date: '2026-07-09',
  tags: ['guide', 'verify'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of browser-based document verification with a shield check',
  relatedSlugs: [
    'tamper-proof-pdf-verification',
    'private-signatures-public-proof',
  ],
  body: [
    {
      type: 'p',
      text: 'Not everyone who needs proof should need a crypto wallet. VeriLock\'s verifier path is built for that: open verify, drop in the PDF, let the browser compute the fingerprint.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Browser window silhouette with document and shield check',
      caption: 'Basic integrity checks need a browser and the PDF. Nothing else.',
    },
    {
      type: 'h2',
      text: 'What you need',
    },
    {
      type: 'ul',
      items: [
        'The PDF that was sealed (or claimed to match).',
        'The VeriLock verify link or document reference.',
        'A modern browser.',
      ],
    },
    {
      type: 'h2',
      text: 'When a wallet still helps',
    },
    {
      type: 'p',
      text: 'Parties can connect to unlock private signature details. Creators sealing or buying credits need a wallet. Pure "is this still the sealed PDF?" does not.',
    },
    {
      type: 'p',
      text: 'Private signing for those who sign. Public proof for those who only check. When you seal, the July rate is 50 NIM (95% off list) through August 1.',
    },
  ],
}
