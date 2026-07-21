import type { BlogPost } from '../types'

const cover = '/blog/tamper-proof-pdf-verification.jpg'
const edit = '/blog/tamper-proof-pdf-verification-edit.jpg'
const permanent = '/blog/tamper-proof-pdf-verification-permanent.jpg'

export const post: BlogPost = {
  slug: 'tamper-proof-pdf-verification',
  title: 'Tamper-Proof PDF Verification',
  description:
    'Why re-hashing a locked PDF catches silent edits, what hashes cannot show, and how a Nimiq on-chain lock stays checkable without trusting one server.',
  date: '2026-07-07',
  tags: ['guide', 'verify'],
  coverImage: cover,
  coverAlt: 'Printed service agreement on a warm gray desk showing a document hash strip, fingerprint mark, and offline verified stamp',
  relatedSlugs: [
    'how-verilock-works',
    'how-to-verify-signed-pdf-without-a-wallet',
    'what-is-verilock',
    'blockchain-pdf-signature-verification',
  ],
    body: [
    {
      type: 'p',
      text: 'Tamper-proof verification is re-runnable math. If two parties claim to hold the same locked agreement, the bytes must match the locked fingerprint. Human eyes miss small edits. A hash does not.',
    },
    {
      type: 'p',
      text: 'This is not a forensic lab. VeriLock does not run error level analysis or AI noise scanners on arbitrary files. It locks a fingerprint at agreement time and lets anyone re-check that fingerprint later. Prevention comes first. Detection is a simple comparison.',
    },
    {
      type: 'h2',
      text: 'Why silent edits are hard to spot',
    },
    {
      type: 'p',
      text: 'A fee change, date shift, or swapped name can look trivial on the page yet cause issues in a dispute. Filenames and email threads are weak evidence. Metadata can be rewritten. Exact-byte hashing sidesteps this uncertainty. Either the fingerprint matches or it does not.',
    },
    {
      type: 'figure',
      src: edit,
      alt: 'Document with a solid wax stamp and a translucent altered layer peeling away',
      caption: 'A tiny after locking change breaks the integrity claim.',
    },
    {
      type: 'h2',
      text: 'Lock once, verify forever',
    },
    {
      type: 'p',
      text: 'When you lock it on Nimiq, you anchor the agreed SHA-256 fingerprint in a public transaction. Later, anyone can re-hash the file they hold and compare. A swapped or edited PDF will not align. You do not need to trust a single vendor database as the only place the permanent record lives.',
    },
    {
      type: 'figure',
      src: permanent,
      alt: 'Stone tablet mark beside a luminous golden lock stamp',
      caption: 'The on-chain lock is a permanent reference. Re-hash anytime against the file you still have.',
    },
    {
      type: 'ul',
      items: [
        'Fingerprint locally in the browser when you create or join.',
        'Collect signatures on that fingerprint from every required party.',
        'Lock the agreed hash when the group is ready.',
        'Re-hash any candidate file later to detect changes.',
      ],
    },
    {
      type: 'h2',
      text: 'Lock vs post-hoc forensics',
    },
    {
      type: 'p',
      text: 'Industry document tampering detection tries to reverse-engineer whether a file was edited after the fact using metadata and compression artifacts. That helps for documents received without a prior on-chain lock. It is also probabilistic and tool-dependent.',
    },
    {
      type: 'p',
      text: 'A cryptographic lock flips the problem. You decide the moment of truth when everyone agrees and lock the fingerprint. Treat later mismatches as definitive for that locked version. You keep the PDF. The chain keeps the hash.',
    },
    {
      type: 'h2',
      text: 'What a match means',
    },
    {
      type: 'ul',
      items: [
        'Match: the candidate file bytes match the locked fingerprint.',
        'Mismatch: the candidate is not the locked document.',
        'Not shown: which specific word or field changed.',
        'Not proven by hash alone: legal authority of signers or before locking authenticity.',
      ],
    },
    {
      type: 'note',
      text: 'Hashes detect change but do not localize edits. Keep your own locked PDF copy. An unlocked file fabricated from scratch may have no edit history to find. Locking makes later comparison meaningful.',
    },
    {
      type: 'h2',
      text: 'How to check a locked PDF',
    },
    {
      type: 'p',
      text: 'Click the Verify a PDF link on the homepage or use the verify link for a specific agreement. Drop in the PDF to check integrity. No wallet is required for basic verification. See How to Verify a Signed PDF Without a Wallet for details.',
    },
    {
      type: 'h2',
      text: 'Practical habits',
    },
    {
      type: 'ul',
      items: [
        'Lock only after the final version is agreed.',
        'Do not re-export the locked PDF through tools that rewrite bytes.',
        'Store the locked file with every party who may need to verify it later.',
        'Treat filename similarity as a hint, never as proof.',
      ],
    },
    {
      type: 'p',
      text: 'Need a check now? Click the Verify a PDF link on the homepage. No wallet is required. When you are ready to lock a new fingerprint, locks are 50 NIM through July. This is 95% off the 1000 NIM list price. The promo ends August 1.',
    },
  ],
}
