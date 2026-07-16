import type { BlogPost } from '../types'

const cover = '/blog/how-verilock-works.jpg'
const flow = '/blog/how-verilock-works-flow.jpg'
const match = '/blog/how-verilock-works-match.jpg'

export const post: BlogPost = {
  slug: 'how-verilock-works',
  title: 'How VeriLock Works',
  description:
    'Create a digital fingerprint for your PDF, gather signatures, and seal the record on the blockchain. Verify changes later without complex tools.',
  date: '2026-07-13',
  tags: ['guide', 'verify'],
  coverImage: cover,
  coverAlt: 'Contract on a gray linen desk with laptop showing fingerprint-to-verify steps and phone verification success',
  relatedSlugs: [
    'what-is-verilock',
    'how-to-sign-pdf-with-blockchain',
    'how-to-verify-signed-pdf-without-a-wallet',
    'blockchain-pdf-signature-verification',
  ],
  body: [
    {
      type: 'p',
      text: 'VeriLock follows a simple four-step loop. First, create a fingerprint of your PDF on your own device. Next, collect signatures from everyone who must agree. Then, seal that fingerprint on the Nimiq blockchain. Finally, verify any file later to ensure it has not changed.',
    },
    {
      type: 'quote',
      text: 'The blockchain stores only a permanent record of the fingerprint. You keep the actual document safe on your device.',
    },
    {
      type: 'p',
      text: 'This process never puts your full document on a public ledger. Sealing freezes an integrity claim. Verification is the same math run again on any copy you still hold.',
    },
    {
      type: 'figure',
      src: flow,
      layout: 'full',
      alt: 'Four stations on a linen desk: fingerprinted PDF, pens for signing, stamp and archive folder, laptop with a green check',
      caption: 'One clear path: local fingerprint, multi-party sign, on-chain seal, and easy verify.',
    },
    {
      type: 'h2',
      text: '1. Fingerprint (Local Digital ID)',
    },
    {
      type: 'p',
      text: 'Every PDF contains digital bytes. VeriLock runs a standard formula called SHA-256 on these bytes right in your browser. This creates a unique hash that acts as a digital fingerprint. If the file is identical, the fingerprint matches. If anyone edits even one letter, the fingerprint changes completely.',
    },
    {
      type: 'p',
      text: 'You do not need to upload your PDF to our servers. The math happens on your machine. This ensures your agreement text stays on your device at all times.',
    },
    {
      type: 'h2',
      text: '2. Sign (Everyone Agrees)',
    },
    {
      type: 'p',
      text: 'Each person connects their Nimiq wallet to sign the agreed fingerprint. Before signing, they check that their file matches the fingerprint exactly. This ensures everyone binds their signature to the same document version. Share the agreement link in the app and send the PDF file separately if needed.',
    },
    {
      type: 'ul',
      items: [
        'The creator starts the agreement and makes the first fingerprint.',
        'Co-signers open the link, match the same PDF, and sign with their wallet.',
        'Different file versions create different fingerprints. Do not mix files during this step.',
      ],
    },
    {
      type: 'p',
      text: 'Wallet signatures prove who signed the fingerprint. They do not automatically decide legal capacity or enforceability in your local laws.',
    },
    {
      type: 'h2',
      text: '3. Seal (Permanent Record)',
    },
    {
      type: 'p',
      text: 'When the group is ready, you seal the record. Sealing publishes the document fingerprint to the Nimiq blockchain. You pay a small fee in NIM or use a prepaid credit. Once sealed, the record is permanent. It is not owned by any single private database. Anyone can check the anchored hash independently.',
    },
    {
      type: 'quote',
      text: 'Only seal when the group stops changing the file. Sealing freezes the integrity claim.',
    },
    {
      type: 'p',
      text: 'If someone edits the PDF after this point, verification will fail. That is the point: a silent change is no longer invisible.',
    },
    {
      type: 'h2',
      text: '4. Verify (Check Integrity)',
    },
    {
      type: 'figure',
      src: match,
      layout: 'right',
      alt: 'Two near-identical contract pages on a linen desk; the right page has one number change circled in red pen',
      caption: 'Same bytes match. A silent edit breaks the fingerprint.',
    },
    {
      type: 'p',
      text: 'Verification is simple math that you can run again. Take a PDF, create its fingerprint locally, and compare it to the sealed record. A match means your bytes are identical to the sealed document. A mismatch means something changed, even if the filename looks familiar.',
    },
    {
      type: 'p',
      text: 'Basic verification does not require a wallet. Parties can connect if they need private signature details. Creators sealing or buying credits need a wallet. Pure checks to see if a file is still the sealed PDF do not.',
    },
    {
      type: 'h2',
      text: 'What lives where',
    },
    {
      type: 'ul',
      items: [
        'On your device: The full PDF bytes you sign and keep.',
        'In the workflow: Title, fingerprints, and party metadata needed to reopen the agreement.',
        'On Nimiq: The sealed fingerprint record and related on-chain proof.',
        'Not on-chain: The full contract text as a public file.',
      ],
    },
    {
      type: 'h2',
      text: 'Common mistakes',
    },
    {
      type: 'ul',
      items: [
        'Signing different exports of the same PDF. Export settings can change the bytes.',
        'Sealing too early, then editing the file and expecting the old seal to cover the new bytes.',
        'Treating a hash match as proof of legal authority or document origin.',
        'Assuming verification explains which word changed. Hashes detect change but do not show specific edits.',
      ],
    },
    {
      type: 'note',
      text: 'VeriLock helps you coordinate signatures and prove the sealed fingerprint later. It is not legal advice about enforceability, and it is not a scanner for unsealed files.',
    },
    {
      type: 'h2',
      text: 'Try the loop',
    },
    {
      type: 'p',
      text: 'In Journey, pick create to start, join to co-sign, or verify to check a sealed file. For a shorter walkthrough of signing only, see How to Sign a PDF with Blockchain. For the product definition and limits, see What is VeriLock.',
    },
    {
      type: 'p',
      text: 'Ready to lock a fingerprint? Through the end of July, a permanent Nimiq seal is 50 NIM. This is 95% off the 1000 NIM list price. The promo ends August 1.',
    },
    {
      type: 'p',
      text: '-Verilock team',
    },
  ],
}
