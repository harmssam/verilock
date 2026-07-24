import type { BlogPost } from '../types'

const cover = '/blog/is-this-the-same-file.jpg'

export const post: BlogPost = {
  slug: 'is-this-the-same-file',
  title: 'Is This the Same File?',
  description:
    'Why VeriLock exists: prove the PDF everyone signed is still the one you hold, without uploading it to someone else\'s servers.',
  date: '2026-07-06',
  tags: ['guide', 'privacy'],
  coverImage: cover,
  coverAlt: 'Two off-white printed contracts side by side on a charcoal desk, with a red pen between them and a red hand-drawn circle marking a small difference',
  relatedSlugs: [
    'what-is-verilock',
    'how-verilock-works',
    'secure-online-pdf-signing-for-agreements',
  ],
  body: [
    {
      type: 'p',
      text: 'The moment that stuck with me: someone asking "is this the same file?" and nobody being fully sure.',
    },
    {
      type: 'p',
      text: 'You email a rental agreement back and forth. Everyone signs. Months later, the question returns: is this the real version? Did anyone change it after we signed? You dig through inboxes, compare file names, and hope everyone still has the same copy.',
    },
    {
      type: 'figure',
      src: cover,
      alt: 'Two document copies coming into alignment',
      caption: 'Same PDF, same fingerprint. That is the whole question.',
    },
    {
      type: 'p',
      text: 'Most e-sign tools want the document uploaded to their servers. Fine for some workflows. Less fine for an NDA, or anything you would rather keep on your own device.',
    },
    {
      type: 'h2',
      text: 'A simpler promise',
    },
    {
      type: 'p',
      text: 'I wanted something more honest: your PDF never leaves your computer, and everyone can still prove what was agreed to later, without trusting me or any third party\'s database alone.',
    },
    {
      type: 'p',
      text: 'Nimiq fits that job. I needed a timestamped, tamper-evident record anyone can check independently. Mini apps and wallet integration meant a real flow inside Nimiq Pay: connect, sign, and lock on the blockchain without the usual web3 maze. Your wallet is your identity. The chain is the proof. No extra gatekeeper just to reach the network.',
    },
    {
      type: 'h2',
      text: 'That is VeriLock',
    },
    {
      type: 'ul',
      items: [
        'Fingerprint your PDF locally in the browser.',
        'Collect wallet-backed signatures from everyone involved.',
        'Lock the hash on-chain when you are ready.',
        'Anyone with a copy can verify later: no account, no upload, no "trust us."',
      ],
    },
    {
      type: 'p',
      text: 'Just your Nimiq wallet when you need to sign or lock on the blockchain. Verifiers can check integrity without one.',
    },
    {
      type: 'p',
      text: 'Sign today. Prove forever. Through the end of July, a permanent Nimiq on-chain lock is 50 NIM (95% off the 1000 NIM list price). Promo ends August 1.',
    },
  ],
}
