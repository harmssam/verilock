import type { BlogPost } from '../types'

const cover = '/blog/what-is-verilock.jpg'
const privatePublic = '/blog/what-is-verilock-private-public.jpg'
const integrityIdentity = '/blog/what-is-verilock-integrity-identity.jpg'

export const post: BlogPost = {
  slug: 'what-is-verilock',
  title: 'What is VeriLock?',
  description:
    'VeriLock is private multi-party PDF signing with local fingerprints and a permanent Nimiq seal. What it is, how proof works, and what it does not claim.',
  date: '2026-07-13',
  tags: ['guide', 'privacy'],
  coverImage: cover,
  coverAlt: 'Open briefcase full of private contracts beside a tiny stamped index card',
  relatedSlugs: [
    'how-verilock-works',
    'is-this-the-same-file',
    'secure-online-pdf-signing-for-agreements',
    'tamper-proof-pdf-verification',
  ],
    body: [
    {
      type: 'p',
      text: 'VeriLock helps people sign the same PDF together, keep the file on their own devices, and lock a permanent fingerprint of that file on the Nimiq blockchain. Later, anyone with a copy can check whether the bytes still match what was sealed.',
    },
    {
      type: 'p',
      text: 'The product promise is simple: sign together, prove forever. The PDF is not uploaded for signing. The chain holds a compact record of the document hash, not the contract wording.',
    },
    {
      type: 'h2',
      text: 'The problem it solves',
    },
    {
      type: 'p',
      text: 'Agreements still travel as email attachments and shared drives. Months later someone asks a hard question: is this the same file we all signed? Filenames and memory are weak answers. Small edits are easy to miss by eye.',
    },
    {
      type: 'p',
      text: 'Cloud e-sign tools solve workflow by hosting the document. That is fine for many teams. It is less fine when you would rather the NDA, lease, or side letter never sit on a third-party file server. VeriLock is built for that privacy-minded loop: same fingerprint for every party, signatures against that fingerprint, then a seal you can re-check without trusting one vendor database alone.',
    },
    {
      type: 'h2',
      text: 'What VeriLock is',
    },
    {
      type: 'ul',
      items: [
        'A web app for multi-party PDF agreements on Nimiq wallets (Hub or Pay).',
        'Local SHA-256 fingerprinting in the browser so the file stays on your device.',
        'Wallet-backed signatures over the agreed fingerprint.',
        'An on-chain seal that anchors the hash when parties are ready.',
        'A verify path that re-hashes a candidate PDF and compares it to the sealed record. Integrity checks do not require a wallet.',
      ],
    },
    {
      type: 'p',
      text: 'Workflow metadata (title, fingerprints, parties, seal details) can live with the product so the agreement is reopenable. The full PDF is not the payload you publish to the world.',
    },
    {
      type: 'figure',
      src: privatePublic,
      alt: 'Private device holding a document on one side, public hash mark alone on the other',
      caption: 'The file stays with you. The proof can be public.',
    },
    {
      type: 'h2',
      text: 'What a seal actually proves',
    },
    {
      type: 'p',
      text: 'A cryptographic hash is a fingerprint of exact bytes. Change a fee, a date, or a name, and the hash changes. When you seal on Nimiq, you anchor that fingerprint in a public transaction with a timestamped permanent record.',
    },
    {
      type: 'p',
      text: 'Re-hashing later answers one question well: does this file still match what was sealed? That is document integrity. It is not the same as full legal authenticity, and it is not a substitute for knowing who had authority to sign under local law.',
    },
    {
      type: 'figure',
      src: integrityIdentity,
      alt: 'Two columns: hash match for file integrity versus person identity as a separate question',
      caption: 'Integrity says the bytes match. Identity and authority are separate checks.',
    },
    {
      type: 'h2',
      text: 'What VeriLock is not',
    },
    {
      type: 'ul',
      items: [
        'Not a document forensics suite (no Error Level Analysis, MRZ, or layout template scanners).',
        'Not a government eID or qualified electronic signature product by default.',
        'Not a claim that a hash alone makes a contract enforceable in your jurisdiction.',
        'Not a host for the PDF content on-chain. Only the fingerprint is sealed.',
      ],
    },
    {
      type: 'note',
      text: 'An intact or matching result means no byte change was detected against the sealed fingerprint. It does not prove a document was genuine if it was fabricated before sealing, and it does not show which clause changed when a hash mismatches. Keep your own sealed PDF copy.',
    },
    {
      type: 'h2',
      text: 'Who it is for',
    },
    {
      type: 'p',
      text: 'Teams and individuals who want multi-party signing with a clear integrity story: freelancers and clients, remote collaborators, anyone exchanging PDFs who cares that the sealed version stays checkable. If you need classic cloud e-sign features first and privacy of the file second, a hosted tool may fit better. If you want the opposite balance, VeriLock is aimed at you.',
    },
    {
      type: 'h2',
      text: 'How it fits the Journey app',
    },
    {
      type: 'p',
      text: 'Production UI is Journey Edition: pick a path to create and seal, join as a co-signer, or verify. The stages stay focused. Under the hood the loop is still fingerprint, sign, seal, and verify. For the step-by-step pipeline, read How VeriLock works.',
    },
    {
      type: 'p',
      text: 'Sign together. Prove forever. Through the end of July, a permanent Nimiq seal is 50 NIM (95% off the 1000 NIM list price). Promo ends August 1.',
    },
  ],
}
