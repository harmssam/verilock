import type { BlogPost } from '../types'

const cover = '/blog/how-to-verify-signed-pdf-without-a-wallet.jpg'
const browser = '/blog/how-to-verify-signed-pdf-without-a-wallet-browser.jpg'
const roles = '/blog/how-to-verify-signed-pdf-without-a-wallet-roles.jpg'

export const post: BlogPost = {
  slug: 'how-to-verify-signed-pdf-without-a-wallet',
  title: 'How to Verify a Signed PDF Without a Wallet',
  description:
    'Check a sealed VeriLock agreement by fingerprinting a PDF in the browser. Basic integrity needs no wallet.',
  date: '2026-07-09',
  tags: ['guide', 'verify'],
  coverImage: cover,
  coverAlt: 'Laptop showing verification complete next to a closed unused wallet',
  relatedSlugs: [
    'how-verilock-works',
    'tamper-proof-pdf-verification',
    'what-is-verilock',
    'private-signatures-public-proof',
  ],
  body: [
    {
      type: 'p',
      text: 'Not everyone who needs proof should need a crypto wallet. Counterparties, counsel, auditors, or a future you may only need one answer: is this PDF still the sealed version? VeriLock\'s verify path is built for that.',
    },
    {
      type: 'p',
      text: 'You open verify, provide the agreement reference, drop in the PDF, and let the browser compute the fingerprint. No wallet for a basic integrity check.',
    },
    {
      type: 'figure',
      src: browser,
      alt: 'Browser window with a document and a green check shield',
      caption: 'Integrity check: browser, PDF, sealed record. Nothing else required.',
    },
    {
      type: 'h2',
      text: 'What verification answers',
    },
    {
      type: 'p',
      text: 'Verification re-runs the hash math. It compares the fingerprint of the file you hold to the fingerprint that was sealed. A match means the bytes still align with the permanent record. A mismatch means the file is not the sealed document, even if the filename looks right.',
    },
    {
      type: 'p',
      text: 'It does not by itself prove who had legal authority to sign, and it does not show which clause changed when the hash fails. Those are separate questions. See Tamper-Proof PDF Verification for the integrity model, and What is VeriLock for product limits.',
    },
    {
      type: 'h2',
      text: 'What you need',
    },
    {
      type: 'ul',
      items: [
        'The PDF that was sealed, or a candidate copy someone claims matches.',
        'The VeriLock verify link or document reference for that agreement.',
        'A modern browser.',
      ],
    },
    {
      type: 'h2',
      text: 'How to run the check',
    },
    {
      type: 'ul',
      items: [
        'From Journey home, choose the verify path (or open the verify link you were given).',
        'Load the agreement reference if it is not already in the URL.',
        'Select the PDF from your device. Fingerprinting runs locally in the browser.',
        'Read the result: match means integrity holds against the sealed fingerprint; no match means the bytes differ.',
      ],
    },
    {
      type: 'p',
      text: 'Keep the sealed PDF somewhere durable. Verification is only as useful as the file you still possess.',
    },
    {
      type: 'h2',
      text: 'When a wallet still helps',
    },
    {
      type: 'figure',
      src: roles,
      alt: 'Left: person with wallet signing a document. Right: person checking a green browser match without a wallet',
      caption: 'Signers and sealers use wallets. Pure integrity checks do not.',
    },
    {
      type: 'ul',
      items: [
        'Connect a wallet when you need private signature details as a party.',
        'Creators sealing a new fingerprint or buying credits need a wallet.',
        'Co-signers signing an in-progress agreement need a wallet.',
        'Someone who only asks "is this still the sealed PDF?" does not.',
      ],
    },
    {
      type: 'h2',
      text: 'Common failure modes',
    },
    {
      type: 'ul',
      items: [
        'You are checking a re-exported or re-saved PDF that looks the same but has different bytes.',
        'You opened the wrong agreement reference.',
        'The file was edited after seal (even a tiny change).',
        'You never stored the sealed copy and only have an older draft.',
      ],
    },
    {
      type: 'note',
      text: 'A match is strong evidence of byte integrity against the sealed fingerprint. It is not a substitute for legal review, and it is not document forensics on files that were never sealed.',
    },
    {
      type: 'h2',
      text: 'Privacy angle',
    },
    {
      type: 'p',
      text: 'Public proof does not require public signatures. Private signing stays with the people who should see it. Integrity can still be checked openly. That split is intentional: signers use wallets; verifiers who only care about the file need a browser and the PDF.',
    },
    {
      type: 'p',
      text: 'When you are ready to lock a new fingerprint, seals are 50 NIM through the end of July (95% off the 1000 NIM list price). Promo ends August 1.',
    },
  ],
}
