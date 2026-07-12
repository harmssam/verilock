import type { BlogPost } from '../types'

const cover = '/blog/how-to-sign-pdf-with-blockchain.jpg'

export const post: BlogPost = {
  slug: 'how-to-sign-pdf-with-blockchain',
  title: 'How to Sign a PDF with Blockchain',
  description:
    'Fingerprint a PDF, collect multi-party wallet signatures, and seal a permanent hash on Nimiq.',
  date: '2026-07-06',
  tags: ['guide'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of a document fingerprint linked to a glowing chain',
  relatedSlugs: [
    'blockchain-pdf-signature-verification',
    'prepaid-credits-for-seals',
  ],
  body: [
    {
      type: 'p',
      text: 'Blockchain PDF signing does not put your whole contract on a public ledger. VeriLock seals a permanent fingerprint. Your PDF stays with you.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Document fingerprint connected to a blockchain path',
      caption: 'The chain stores the hash and timestamp. You keep the file.',
    },
    {
      type: 'h2',
      text: 'The flow',
    },
    {
      type: 'ul',
      items: [
        'Connect a Nimiq wallet (Hub or Pay).',
        'Fingerprint the PDF on your device (SHA-256 in the browser).',
        'Share the agreement link and the same PDF out of band if others must sign.',
        'Each party matches the file and signs with their wallet.',
        'Seal the fingerprint on-chain with NIM or a prepaid credit.',
        'Anyone can re-hash later to verify. Verifiers need no wallet.',
      ],
    },
    {
      type: 'note',
      text: 'Same PDF for every signer. Different bytes mean a different fingerprint.',
    },
    {
      type: 'p',
      text: 'That is the full loop. Try it at verilock.online.',
    },
  ],
}
