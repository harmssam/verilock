import type { BlogPost } from '../types'

const cover = '/blog/chrome-extension-verify-pdf.jpg'

export const post: BlogPost = {
  slug: 'chrome-extension-verify-pdf',
  title: 'Verify Locked PDFs from Chrome: Right-Click, Done',
  description:
    'A free Chrome extension that hashes PDFs locally and checks VeriLock locks on Nimiq. No upload, no wallet required for a basic integrity check.',
  date: '2026-07-23',
  tags: ['feature', 'verify'],
  coverImage: cover,
  coverAlt:
    'White desk with an invoice PDF and teal glass check shield for private document verification',
  relatedSlugs: [
    'how-to-verify-signed-pdf-without-a-wallet',
    'tamper-proof-pdf-verification',
    'how-verilock-works',
    'private-signatures-public-proof',
  ],
  body: [
    {
      type: 'p',
      text: 'You already know the web app path: open Verify, drop a PDF, compare fingerprints. Now there is a faster path for links that show up in email, portals, and chat. The VeriLock Chrome extension turns right-click into a private integrity check.',
    },
    {
      type: 'p',
      text: 'The open-source extension is on GitHub as clevertech-os/verilock-chrome-extension. Load it unpacked in Chrome developer mode while the listing is prepared. Same privacy model as the site: the file is hashed on your machine, and only the SHA-256 fingerprint is sent to look up locks.',
    },
    {
      type: 'h2',
      text: 'What it does',
    },
    {
      type: 'ul',
      items: [
        'Right-click a PDF link and choose Verify with VeriLock. The extension fetches the file for local hashing, then checks VeriLock for a matching lock.',
        'Right-click a VeriLock verify or agreement link (/v/… or /d/…) for an instant lookup without downloading a PDF first.',
        'See lock details such as status, parties, timestamps, and the on-chain attestation transaction when a match is found.',
        'Open the toolbar popup anytime for the latest result. No account and no wallet are required for a basic integrity check.',
      ],
    },
    {
      type: 'h2',
      text: 'What never leaves your browser',
    },
    {
      type: 'p',
      text: 'PDF bytes are not uploaded to VeriLock. Hashing uses the Web Crypto API in the extension. The public API receives only the fingerprint (or a document id when you verify a VeriLock URL). There is no browsing history tracking and no analytics SDK in the extension.',
    },
    {
      type: 'note',
      text: 'Some sites block extension downloads of their PDFs. If a fetch fails, open the file in the browser or save it, then use Verify on the site with the same bytes. A hash match still requires the exact locked file.',
    },
    {
      type: 'h2',
      text: 'How to install (developer mode)',
    },
    {
      type: 'ul',
      items: [
        'Clone or download the repository from GitHub (clevertech-os/verilock-chrome-extension).',
        'Open chrome://extensions, enable Developer mode, then Load unpacked and select the extension folder.',
        'Pin VeriLock in the toolbar if you want one-click access to the last result.',
      ],
    },
    {
      type: 'p',
      text: 'Use the extension when a PDF link appears in the wild, and use Verify on the site when you already have the file. Locking a permanent fingerprint on Nimiq is still free to sign; through the end of July a permanent lock is 50 NIM (95% off the 1000 NIM list price). Promo ends August 1.',
    },
  ],
}
