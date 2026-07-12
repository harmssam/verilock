import type { BlogPost } from '../types'

const cover = '/blog/tamper-proof-pdf-verification.jpg'

export const post: BlogPost = {
  slug: 'tamper-proof-pdf-verification',
  title: 'Tamper-Proof PDF Verification',
  description:
    'Why re-hashing a PDF catches silent edits, and how a sealed fingerprint stays checkable without trusting one server.',
  date: '2026-07-07',
  tags: ['guide', 'verify'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of a sealed document of light resisting a ghosted altered copy',
  relatedSlugs: [
    'blockchain-pdf-signature-verification',
    'secure-online-pdf-signing-for-agreements',
  ],
  body: [
    {
      type: 'p',
      text: 'Tamper-proof verification is re-runnable math. If two people claim they signed the same agreement, the bytes must still match.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Sealed document of light with a fading altered ghost copy',
      caption: 'Human eyes miss small edits. A hash does not.',
    },
    {
      type: 'h2',
      text: 'Seal once, check forever',
    },
    {
      type: 'p',
      text: 'When you seal on Nimiq, you anchor that fingerprint in a public transaction. Later, anyone can re-hash the file they hold and compare. A swapped PDF will not line up.',
    },
    {
      type: 'ul',
      items: [
        'Fingerprint locally in the browser.',
        'Seal the agreed hash when parties are ready.',
        'Re-hash any candidate file to detect changes.',
      ],
    },
    {
      type: 'note',
      text: 'Hashes detect change. They do not show which word changed. Keep your own sealed PDF copy.',
    },
    {
      type: 'p',
      text: 'Need a check now? Use the verifier path on verilock.online. No wallet required.',
    },
  ],
}
