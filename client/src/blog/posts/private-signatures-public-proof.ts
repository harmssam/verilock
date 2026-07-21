import type { BlogPost } from '../types'

const cover = '/blog/private-signatures-public-proof.jpg'

export const post: BlogPost = {
  slug: 'private-signatures-public-proof',
  title: 'Private Signatures, Public Proof',
  description:
    'Share links can prove a locked fingerprint without dumping every co-signer\'s name and signature image on the open web. Parties unlock private presentation with their wallet.',
  date: '2026-07-09',
  tags: ['feature', 'privacy'],
  coverImage: cover,
  coverAlt:
    'Printed contract with redacted party details and visible matte navy verification stamp on warm gray paper',
  relatedSlugs: [
    'secure-online-pdf-signing-for-agreements',
    'how-to-verify-signed-pdf-without-a-wallet',
    'wallet-scoped-agreements-history',
  ],
  body: [
    {
      type: 'p',
      text: 'A share link is useful only if it does not overshare. VeriLock separates two jobs: prove that a locked fingerprint exists and still matches a PDF, and present who signed with which wallet and optional signature image. Public viewers get the integrity story. Parties who belong on the agreement can unlock richer signature presentation after they connect.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Document half in fog with a bright public on-chain lock',
      caption: 'Prove the hash in public. Keep signature presentation for people who should see it.',
    },
    {
      type: 'h2',
      text: 'What stays public',
    },
    {
      type: 'ul',
      items: [
        'That an agreement record exists for a fingerprint.',
        'Whether a lock on Nimiq is present for that hash.',
        'Enough structure to run verify: drop the PDF, re-hash locally, compare.',
      ],
    },
    {
      type: 'p',
      text: 'The chain still stores only the hash string when you lock it on the blockchain, not the file. Verification never needs a wallet. Anyone with the locked PDF and a way to look up the agreement can check integrity.',
    },
    {
      type: 'h2',
      text: 'What stays party-scoped',
    },
    {
      type: 'ul',
      items: [
        'Names and signature presentation tied to participants.',
        'Optional signature images captured on the pad.',
        'Other agreement metadata that is not required for a pure hash match.',
      ],
    },
    {
      type: 'p',
      text: 'A party unlocks those details by connecting the wallet that is on the agreement. If you are not a participant, connecting a random wallet does not magically reveal everyone\'s signature art.',
    },
    {
      type: 'note',
      text: 'Redaction is about presentation in the product UI, not about hiding the on-chain hash. Anyone who already has the locked PDF can still re-hash it and compare to the public blockchain record. Do not put secrets in a PDF if you plan to share that same file widely.',
    },
    {
      type: 'h2',
      text: 'How to use the split',
    },
    {
      type: 'p',
      text: 'Share invite links with co-signers and send them the exact PDF. After you lock the proof on the blockchain, you can point someone at verify without giving them a full roster of private presentation. For your own history of created and signed work, open Agreements after login. The list is scoped to your wallet, not the public internet.',
    },
    {
      type: 'p',
      text: 'Share carefully, lock when ready, verify anytime. Through the end of July, a permanent Nimiq on-chain lock is 50 NIM (95% off the 1000 NIM list price). Promo ends August 1.',
    },
  ],
}
