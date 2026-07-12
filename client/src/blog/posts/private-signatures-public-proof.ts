import type { BlogPost } from '../types'

const cover = '/blog/private-signatures-public-proof.jpg'

export const post: BlogPost = {
  slug: 'private-signatures-public-proof',
  title: 'Private Signatures, Public Proof',
  description:
    'Public viewers see redacted party details. Parties unlock signature details by connecting their wallet.',
  date: '2026-07-09',
  tags: ['feature', 'privacy'],
  coverImage: cover,
  coverAlt: 'Abstract illustration of a private document half hidden while a public seal glows',
  relatedSlugs: [
    'secure-online-pdf-signing-for-agreements',
    'how-to-verify-signed-pdf-without-a-wallet',
  ],
  body: [
    {
      type: 'p',
      text: 'A share link should not dump every co-signer\'s name and signature image into the open web. Public views redact participant details while the sealed fingerprint stays usable.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Document half in fog with a bright public seal',
      caption: 'Prove the hash in public. Keep signature presentation for people who should see it.',
    },
    {
      type: 'p',
      text: 'Parties unlock private signature details by connecting the wallet on that agreement. Verifying the PDF fingerprint does not require that step.',
    },
    {
      type: 'p',
      text: 'Share carefully, seal when ready, verify on verilock.online.',
    },
  ],
}
