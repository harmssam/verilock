import type { BlogPost } from '../types'

const cover = '/blog/blockchain-pdf-signature-verification.jpg'

export const post: BlogPost = {
  slug: 'blockchain-pdf-signature-verification',
  title: 'Blockchain PDF Signature Verification',
  description:
    'What verification actually checks: matching fingerprints, party signatures, and a permanent on-chain seal.',
  date: '2026-07-07',
  tags: ['guide', 'verify'],
  coverImage: cover,
  coverAlt: 'Two abstract digital fingerprints face a glowing blue checkmark between them, with subtle hash characters and blockchain nodes on a white background',
  relatedSlugs: [
    'is-this-the-same-file',
    'tamper-proof-pdf-verification',
    'how-to-verify-signed-pdf-without-a-wallet',
  ],
  body: [
    {
      type: 'p',
      text: 'Blockchain PDF verification usually means two checks: who signed, and whether the file still matches what was sealed. VeriLock keeps those clear and separate from the private document content.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Two matching abstract fingerprints with a verification glow',
      caption: 'A match means the bytes you hold are still the sealed document.',
    },
    {
      type: 'h2',
      text: 'Fingerprint first',
    },
    {
      type: 'p',
      text: 'Every PDF has a SHA-256 fingerprint of its exact bytes. Edit a fee, date, or name, and the hash changes. Signing and sealing both refer to that fingerprint.',
    },
    {
      type: 'h2',
      text: 'What the seal adds',
    },
    {
      type: 'p',
      text: 'Sealing publishes the fingerprint on Nimiq. VeriLock cannot quietly delete that chain record. Parties sign with wallets; public viewers see redacted signature details.',
    },
    {
      type: 'h2',
      text: 'Quick checklist',
    },
    {
      type: 'ul',
      items: [
        'Start from the PDF you were given, not a screenshot.',
        'Re-hash it in VeriLock\'s verify flow.',
        'Confirm the fingerprint matches the sealed agreement.',
        'Optionally open the seal transaction on a Nimiq explorer.',
      ],
    },
    {
      type: 'p',
      text: 'Private file. Public proof. Check integrity anytime, and seal new agreements for 50 NIM through the end of July (promo ends August 1).',
    },
  ],
}
